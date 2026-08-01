const express = require('express');

const config = require('../config');
const { createAuthorizationCode, exchangeAuthorizationCode } = require('../services/oidc-provider-service');
const { listCredentialMembershipsForEmail } = require('../services/org-admin-service');
const { writeAuditEvent } = require('../services/audit-service');
const { authorize } = require('../middleware/authorization');

const router = express.Router();

router.get('/oidc/.well-known/openid-configuration', (req, res) => {
  const issuer = `${getRequestBaseUrl(req)}/oidc`;
  res.json({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['none'],
    scopes_supported: ['openid', 'profile', 'email'],
    claims_supported: ['sub', 'email', 'name', 'organization_id', 'acr', 'nonce', 'auth_time']
  });
});

router.get('/oidc/authorize', (req, res) => {
  res.render('pages/aegis-oidc-authorize', {
    title: 'Aegis ID Authorization',
    description: 'Mock Aegis ID OIDC authorization screen for lab applications.',
    clientId: req.query.client_id,
    redirectUri: req.query.redirect_uri,
    responseType: req.query.response_type || 'code',
    scope: req.query.scope || 'openid profile email',
    state: req.query.state,
    nonce: req.query.nonce,
    organizationId: req.query.organization_id,
    appName: req.query.app_name || req.query.client_id || 'Connected application'
  });
});

router.post('/oidc/authorize', authorize('api.oidcProvider.external'), async (req, res, next) => {
  try {
    if (req.body.responseType && req.body.responseType !== 'code') {
      const error = new Error('Only authorization code flow is supported in this lab provider.');
      error.status = 400;
      throw error;
    }

    // Relying parties let the holder choose which of their organizations to act
    // in, so the token carries every organization they hold a live credential in
    // rather than a single configured one.
    const memberships = await listCredentialMembershipsForEmail(req.body.email);
    const organizations = dedupeOrganizations(memberships);

    const authorization = await createAuthorizationCode({
      clientId: req.body.clientId,
      redirectUri: req.body.redirectUri,
      nonce: req.body.nonce,
      email: req.body.email,
      name: req.body.name,
      organizationId: req.body.organizationId,
      organizations
    });
    await writeAuditEvent('oidc-provider.authorization.issued', {
      clientId: req.body.clientId,
      subject: authorization.claims.email,
      organizationId: authorization.claims.organization_id
    });

    const redirect = new URL(req.body.redirectUri);
    redirect.searchParams.set('code', authorization.code);
    redirect.searchParams.set('state', req.body.state || '');
    res.redirect(303, redirect.toString());
  } catch (error) {
    next(error);
  }
});

router.post('/oidc/token', authorize('api.oidcProvider.external'), async (req, res, next) => {
  try {
    if (req.body.grant_type !== 'authorization_code') {
      const error = new Error('Only authorization_code grant_type is supported.');
      error.status = 400;
      throw error;
    }

    const token = await exchangeAuthorizationCode({
      code: req.body.code,
      clientId: req.body.client_id,
      redirectUri: req.body.redirect_uri
    });
    await writeAuditEvent('oidc-provider.token.redeemed', {
      clientId: req.body.client_id,
      subject: token.claims.email
    });
    res.json(token);
  } catch (error) {
    next(error);
  }
});

function getRequestBaseUrl(req) {
  if (config.app.publicBaseUrl) {
    return config.app.publicBaseUrl.replace(/\/$/, '');
  }
  return `${req.protocol}://${req.get('host')}`;
}

module.exports = router;

// One entry per organization, carrying only what a relying party needs to render
// a chooser.
function dedupeOrganizations(memberships = []) {
  const byId = new Map();
  for (const membership of memberships) {
    if (!membership.workspaceId || byId.has(membership.workspaceId)) {
      continue;
    }
    byId.set(membership.workspaceId, {
      id: membership.workspaceId,
      name: membership.organizationName || membership.organization || 'Organization',
      roles: membership.roleLabels || []
    });
  }
  return [...byId.values()];
}
