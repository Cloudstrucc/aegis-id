const express = require('express');

const { requireAuthenticated } = require('../middleware/auth');
const { authorize } = require('../middleware/authorization');
const { getDocsWorkspace, isKnownCategory } = require('../services/docs-service');

const router = express.Router();

router.use('/developer', requireAuthenticated);

router.get('/developer/api', authorize('developerApiDocs.view'), renderDocsWorkspace);
router.get('/developer/docs', authorize('developerApiDocs.view'), renderDocsWorkspace);

router.get('/developer/docs/:categoryId/:slug', authorize('developerApiDocs.view'), (req, res, next) => {
  if (!isKnownCategory(req.params.categoryId)) {
    return next();
  }

  return renderDocsWorkspace(req, res);
});

router.get('/developer/openapi.json', authorize('developerApiDocs.view'), (req, res) => {
  const baseUrl = getRequestBaseUrl(req);
  res.json(buildOpenApiSpec(baseUrl));
});

function buildOpenApiSpec(baseUrl) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Vanguard Aegis ID Connected Apps API',
      version: '0.1.0',
      summary: 'OAuth, OIDC, and wallet challenge APIs for relying-party applications.'
    },
    servers: [{ url: baseUrl }],
    tags: [
      { name: 'OAuth', description: 'OIDC discovery, authorization, token, userinfo, introspection, and revocation.' },
      { name: 'Connected Apps', description: 'Client-authenticated APIs for wallet challenges and app telemetry.' }
    ],
    paths: {
      '/oauth2/.well-known/openid-configuration': {
        get: {
          tags: ['OAuth'],
          summary: 'OIDC discovery document',
          responses: { 200: { description: 'Discovery metadata.' } }
        }
      },
      '/oauth2/authorize': {
        get: {
          tags: ['OAuth'],
          summary: 'Start authorization-code sign-in',
          parameters: [
            { name: 'client_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'redirect_uri', in: 'query', required: true, schema: { type: 'string', format: 'uri' } },
            { name: 'response_type', in: 'query', required: true, schema: { type: 'string', enum: ['code'] } },
            { name: 'scope', in: 'query', required: false, schema: { type: 'string', example: 'openid profile email' } },
            { name: 'state', in: 'query', required: false, schema: { type: 'string' } },
            { name: 'nonce', in: 'query', required: false, schema: { type: 'string' } }
          ],
          responses: {
            302: { description: 'Redirects to the relying-party callback with an authorization code.' },
            400: { description: 'Invalid authorization request.' }
          }
        }
      },
      '/oauth2/token': {
        post: {
          tags: ['OAuth'],
          summary: 'Exchange authorization code or client credentials for tokens',
          requestBody: {
            required: true,
            content: {
              'application/x-www-form-urlencoded': {
                schema: {
                  type: 'object',
                  properties: {
                    grant_type: { type: 'string', enum: ['authorization_code', 'client_credentials'] },
                    client_id: { type: 'string' },
                    client_secret: { type: 'string' },
                    code: { type: 'string' },
                    redirect_uri: { type: 'string', format: 'uri' },
                    scope: { type: 'string' }
                  },
                  required: ['grant_type', 'client_id']
                }
              }
            }
          },
          responses: {
            200: { description: 'Token response with access_token and id_token.' },
            400: { description: 'Invalid grant or unsupported grant type.' },
            401: { description: 'Invalid client credential.' }
          }
        }
      },
      '/oauth2/userinfo': {
        get: {
          tags: ['OAuth'],
          summary: 'Return claims for the access token subject',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'User claims.' },
            401: { description: 'Invalid or missing bearer token.' }
          }
        }
      },
      '/api/connected-apps/wallet-challenges': {
        post: {
          tags: ['Connected Apps'],
          summary: 'Send a wallet challenge for a high-assurance business action',
          security: [{ clientSecret: [] }, { certificateFingerprint: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    subject: { type: 'string', format: 'email' },
                    action: { type: 'string', example: 'approve-expense' },
                    resourceType: { type: 'string', example: 'expense' },
                    resourceId: { type: 'string', example: 'EXP-2026-1048' },
                    payload: { type: 'object' },
                    requiredAssurance: { type: 'string', enum: ['wallet', 'passkey', 'verified-id'] }
                  },
                  required: ['subject', 'action']
                }
              }
            }
          },
          responses: {
            201: { description: 'Wallet challenge created.' },
            401: { description: 'Invalid connected app credential.' }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        clientSecret: {
          type: 'apiKey',
          in: 'header',
          name: 'x-aegis-client-secret',
          description: 'Use with x-aegis-client-id.'
        },
        certificateFingerprint: {
          type: 'apiKey',
          in: 'header',
          name: 'x-aegis-certificate-sha256',
          description: 'SHA-256 fingerprint for an imported connected-app certificate. Use with x-aegis-client-id.'
        }
      }
    }
  };
}

function getRequestBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
}

function renderDocsWorkspace(req, res) {
  const workspace = getDocsWorkspace({
    categoryId: req.params.categoryId,
    slug: req.params.slug,
    query: req.query.q
  });

  res.render('pages/docs-workspace', {
    title: 'Aegis ID Docs',
    description: 'Technical documentation for Aegis ID integrations, policy, RBAC, wallet, and platform APIs.',
    bodyClass: 'docs-workspace-body',
    openApiUrl: '/developer/openapi.json',
    publicBaseUrl: getRequestBaseUrl(req),
    pageScripts: [
      { src: '/vendor/mermaid/mermaid.min.js' },
      { src: '/scripts/docs-workspace.js' }
    ],
    ...workspace
  });
}

module.exports = router;
