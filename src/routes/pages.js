const express = require('express');
const QRCode = require('qrcode');

const config = require('../config');
const { requireAuthenticated } = require('../middleware/auth');
const { getPresentationPolicy } = require('../services/credential-policy-service');
const { getHealthDashboard } = require('../services/health-service');
const { getHomeContent } = require('../services/home-content');
const { getCredentialInvitationView } = require('../services/org-admin-service');
const { authorize } = require('../middleware/authorization');

const router = express.Router();

router.get('/', authorize('public.home'), (req, res) => {
  res.render('pages/home', getHomeContent());
});

router.get('/architecture', requireAuthenticated, authorize('account.view'), (req, res) => {
  res.render('pages/architecture', {
    title: 'Architecture',
    description: 'Vanguard Cloud Services - Aegis ID reference architecture.',
    policy: getPresentationPolicy(),
    microsoftMode: config.verifiedId.mode
  });
});

router.get('/health', authorize('admin.health.view'), async (req, res, next) => {
  try {
    const health = await getHealthDashboard();
    res.render('pages/health', {
      title: 'Health',
      description: 'Vanguard Aegis ID service health and recent operational logs.',
      health
    });
  } catch (error) {
    next(error);
  }
});

router.get('/lab/mock-wallet/:kind/:state', requireAuthenticated, authorize('api.verifiedId.present'), async (req, res, next) => {
  try {
    const publicBaseUrl = config.app.publicBaseUrl.replace(/\/$/, '');
    const requestUrl = `${publicBaseUrl}${req.originalUrl}`;
    const qrCodeDataUrl = await QRCode.toDataURL(requestUrl, { margin: 1, width: 460 });

    res.render('pages/mock-wallet', {
      title: 'Mock wallet handoff',
      description: 'Local mock wallet handoff for demo requests.',
      kind: req.params.kind,
      state: req.params.state,
      requestUrl,
      qrCodeDataUrl
    });
  } catch (error) {
    next(error);
  }
});

router.get('/wallet/credential-invitations/:credentialId', authorize('api.wallet.mobile'), async (req, res, next) => {
  try {
    const invite = await getCredentialInvitationView(req.query.organizationId, req.params.credentialId, {
      publicBaseUrl: getRequestBaseUrl(req)
    });
    res.render('pages/credential-invitation', {
      title: 'Credential invitation',
      description: 'Vanguard Aegis ID wallet credential invitation.',
      invite
    });
  } catch (error) {
    next(error);
  }
});

router.get('/demo/metadata/keycloak/realms/:realm/.well-known/openid-configuration', (req, res) => {
  const issuer = `${getRequestBaseUrl(req)}/demo/metadata/keycloak/realms/${req.params.realm}`;
  res.json(buildOidcDiscovery(issuer, 'keycloak'));
});

router.get('/demo/metadata/okta/oauth2/:authorizationServer/.well-known/openid-configuration', (req, res) => {
  const issuer = `${getRequestBaseUrl(req)}/demo/metadata/okta/oauth2/${req.params.authorizationServer}`;
  res.json(buildOidcDiscovery(issuer, 'okta'));
});

router.get('/demo/metadata/generic/oidc', (req, res) => {
  const issuer = `${getRequestBaseUrl(req)}/demo/metadata/generic`;
  res.json(buildOidcDiscovery(issuer, 'generic'));
});

router.get('/demo/metadata/generic/saml', (req, res) => {
  const baseUrl = getRequestBaseUrl(req);
  res.type('application/samlmetadata+xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${baseUrl}/demo/metadata/generic/saml">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${baseUrl}/demo/metadata/generic/saml/sso"/>
  </IDPSSODescriptor>
</EntityDescriptor>`);
});

function buildOidcDiscovery(issuer, provider) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    userinfo_endpoint: `${issuer}/userinfo`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'email', 'groups'],
    claims_supported: ['sub', 'email', 'name', 'groups', 'department', 'roles'],
    vanguard_demo_provider: provider
  };
}

function getRequestBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
}

module.exports = router;
