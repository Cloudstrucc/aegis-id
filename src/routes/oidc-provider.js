const express = require('express');
const QRCode = require('qrcode');

const config = require('../config');
const { createAuthorizationCode, exchangeAuthorizationCode } = require('../services/oidc-provider-service');
const { listCredentialMembershipsForEmail } = require('../services/org-admin-service');
const {
  approveWalletSignIn,
  claimWalletSignIn,
  declineWalletSignIn,
  readSignInStatus,
  startWalletSignIn,
  walletDeepLink
} = require('../services/oidc-wallet-signin-service');
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

// The sign-in screen a connected application sends people to.
//
// It asks for nothing. The browser starts a wallet challenge and watches it;
// the wallet answers with its own Wallet ID. Wallet is the only method offered
// for now — passkey, Verified ID and YubiKey are real sign-in methods elsewhere
// in the platform but are not wired into this endpoint, and a button that
// cannot complete is worse than no button.
router.get('/oidc/authorize', async (req, res, next) => {
  try {
    const challenge = await startWalletSignIn({
      clientId: req.query.client_id,
      redirectUri: req.query.redirect_uri,
      responseType: req.query.response_type || 'code',
      scope: req.query.scope || 'openid profile email',
      state: req.query.state,
      nonce: req.query.nonce,
      organizationId: req.query.organization_id,
      appName: req.query.app_name || req.query.client_id
    });

    const deepLink = walletDeepLink(challenge.id);
    res.render('pages/aegis-oidc-authorize', {
      title: 'Sign in with your wallet',
      description: 'Approve this sign-in from the Aegis ID wallet on your phone.',
      appName: challenge.appName,
      challengeId: challenge.id,
      deepLink,
      // Rendered here rather than fetched, matching the other wallet QR screens
      // — the page then carries no request that could fail separately.
      qrCodeDataUrl: await QRCode.toDataURL(deepLink, { margin: 1, width: 360 }),
      expiresInMinutes: Math.max(1, Math.round(
        (Date.parse(challenge.expiresAt) - Date.now()) / 60000
      )),
      clientId: challenge.clientId,
      redirectUri: challenge.redirectUri,
      responseType: challenge.responseType,
      scope: challenge.scope,
      state: challenge.state,
      nonce: challenge.nonce,
      organizationId: challenge.requestedOrganizationId
    });
  } catch (error) {
    next(error);
  }
});

// What the waiting browser is told. Thin while pending, so watching a challenge
// reveals nothing about who might answer it.
router.get('/oidc/authorize/wallet/:challengeId/status', async (req, res, next) => {
  try {
    res.json(await readSignInStatus(req.params.challengeId));
  } catch (error) {
    next(error);
  }
});

// The wallet answering. Content-negotiated like every other wallet endpoint:
// a browser gets a page, a wallet gets JSON.
router.post('/api/wallet-signin/:challengeId/approve', authorize('api.oidcProvider.walletSignIn'), async (req, res, next) => {
  try {
    const record = await approveWalletSignIn(req.params.challengeId, req.body.walletId);
    const view = {
      title: 'Sign-in approved',
      description: 'This sign-in has been approved from your wallet.',
      appName: record.appName,
      walletId: record.walletId
    };
    if (req.accepts(['html', 'json']) === 'json') {
      return res.json({ status: 'approved', appName: record.appName, walletId: record.walletId });
    }
    return res.render('pages/wallet-signin-approved', view);
  } catch (error) {
    next(error);
  }
});

router.post('/api/wallet-signin/:challengeId/decline', authorize('api.oidcProvider.walletSignIn'), async (req, res, next) => {
  try {
    const record = await declineWalletSignIn(req.params.challengeId, req.body.walletId);
    if (req.accepts(['html', 'json']) === 'json') {
      return res.json({ status: 'declined', appName: record.appName });
    }
    return res.render('pages/wallet-signin-approved', {
      title: 'Sign-in declined',
      description: 'This sign-in was declined.',
      appName: record.appName,
      declined: true
    });
  } catch (error) {
    next(error);
  }
});

// Completing the authorization, using an approval a wallet gave.
//
// Identity is taken from the claimed challenge and never from the request body.
// The previous version read req.body.email and looked up that person's
// organizations, which meant typing a colleague's address returned a token
// carrying their memberships. Nothing posted here names a subject any more.
router.post('/oidc/authorize', authorize('api.oidcProvider.external'), async (req, res, next) => {
  try {
    if (req.body.responseType && req.body.responseType !== 'code') {
      throw Object.assign(new Error('Only authorization code flow is supported in this lab provider.'), {
        status: 400
      });
    }

    const { record, memberships } = await claimWalletSignIn(req.body.challengeId, {
      clientId: req.body.clientId,
      redirectUri: req.body.redirectUri
    });

    const organizations = dedupeOrganizations(memberships);
    // The holder's choice wins; the application's requested organization is a
    // preference, and is only honoured when they actually hold a credential in
    // it. Otherwise a relying party could pin somebody into an organization
    // they do not belong to.
    const chosen = String(req.body.organizationId || '').trim();
    const organizationId = organizations.some((entry) => entry.id === chosen)
      ? chosen
      : (organizations.length === 1 ? organizations[0].id : '');

    const authorization = await createAuthorizationCode({
      clientId: record.clientId,
      redirectUri: record.redirectUri,
      nonce: record.nonce,
      email: record.email,
      name: record.email,
      walletId: record.walletId,
      organizationId,
      organizations
    });
    await writeAuditEvent('oidc-provider.authorization.issued', {
      clientId: record.clientId,
      subject: authorization.claims.email,
      walletId: record.walletId,
      organizationId: authorization.claims.organization_id
    });

    const redirect = new URL(record.redirectUri);
    redirect.searchParams.set('code', authorization.code);
    redirect.searchParams.set('state', record.state || '');

    // The waiting page asks for JSON and navigates itself. A form post cannot
    // finish this journey: the redirect leaves this origin for the relying
    // party, and `form-action 'self'` blocks the whole chain. Widening that
    // directive for every registered redirect URI would trade a real protection
    // for a convenience, so the page navigates instead — which the directive
    // does not govern.
    if (req.accepts(['html', 'json']) === 'json') {
      return res.json({ redirectTo: redirect.toString() });
    }
    return res.redirect(303, redirect.toString());
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
