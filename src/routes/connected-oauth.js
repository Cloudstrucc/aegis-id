const express = require('express');

const { authorize } = require('../middleware/authorization');
const {
  authenticateConnectedClient,
  createClientCredentialsToken,
  createConnectedAppWalletChallenge,
  createConnectedAuthorizationCode,
  exchangeConnectedAuthorizationCode,
  getConnectedAppByClientId,
  getDiscovery,
  getJwks,
  logConnectedAppEvent,
  verifyAccessToken
} = require('../services/connected-app-service');

const router = express.Router();

router.get('/oauth2/.well-known/openid-configuration', authorize('api.connectedApps.oauth'), async (req, res, next) => {
  try {
    res.json(await getDiscovery(getRequestBaseUrl(req)));
  } catch (error) {
    next(error);
  }
});

router.get('/oauth2/jwks', authorize('api.connectedApps.oauth'), async (req, res, next) => {
  try {
    res.json(await getJwks());
  } catch (error) {
    next(error);
  }
});

router.get('/oauth2/authorize', authorize('api.connectedApps.oauth'), async (req, res, next) => {
  try {
    if (!req.isAuthenticated?.() || !req.user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect(303, `/auth/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }
    const request = normalizeAuthorizeRequest(req.query);
    if (request.responseType !== 'code') {
      return redirectOAuthError(res, request.redirectUri, 'unsupported_response_type', request.state);
    }
    const app = await getConnectedAppByClientId(request.clientId);
    if (!app.redirectUris.includes(request.redirectUri)) {
      return redirectOAuthError(res, request.redirectUri, 'invalid_request', request.state);
    }
    res.render('pages/connected-app-authorize', {
      title: `Authorize ${app.name}`,
      description: 'Authorize a connected app to use Vanguard Aegis ID.',
      app,
      request,
      scopes: request.scope.split(/\s+/).filter(Boolean),
      registerUrl: `/auth/register?returnTo=${encodeURIComponent(req.originalUrl)}`
    });
  } catch (error) {
    next(error);
  }
});

router.post('/oauth2/authorize', authorize('api.connectedApps.oauth'), async (req, res, next) => {
  try {
    if (!req.isAuthenticated?.() || !req.user) {
      req.session.returnTo = req.originalUrl;
      return res.redirect(303, `/auth/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }
    const request = normalizeAuthorizeRequest(req.body);
    const authorization = await createConnectedAuthorizationCode({
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      scope: request.scope,
      state: request.state,
      nonce: request.nonce,
      email: req.user.email,
      name: req.user.displayName || req.user.email,
      user: req.user
    });
    const redirect = new URL(authorization.code.redirectUri);
    redirect.searchParams.set('code', authorization.code.code);
    if (authorization.code.state) {
      redirect.searchParams.set('state', authorization.code.state);
    }
    return res.redirect(303, redirect.toString());
  } catch (error) {
    next(error);
  }
});

router.post('/oauth2/token', authorize('api.connectedApps.oauth'), async (req, res, next) => {
  try {
    const clientCredentials = getClientCredentials(req);
    const baseUrl = getRequestBaseUrl(req);
    if (req.body.grant_type === 'authorization_code') {
      const token = await exchangeConnectedAuthorizationCode({
        ...clientCredentials,
        code: req.body.code,
        redirectUri: req.body.redirect_uri
      }, baseUrl);
      return res.json(token);
    }
    if (req.body.grant_type === 'client_credentials') {
      const token = await createClientCredentialsToken({
        ...clientCredentials,
        scope: req.body.scope
      }, baseUrl);
      return res.json(token);
    }
    return sendOAuthError(res, { status: 400, oauthError: 'unsupported_grant_type', message: 'Unsupported grant_type.' });
  } catch (error) {
    return sendOAuthError(res, error);
  }
});

router.get('/oauth2/userinfo', authorize('api.connectedApps.oauth'), async (req, res) => {
  try {
    const payload = await verifyAccessToken(getBearerToken(req), getRequestBaseUrl(req));
    res.json({
      sub: payload.sub,
      email: payload.email,
      name: payload.name,
      organization_id: payload.organization_id,
      roles: payload.roles,
      acr: payload.acr,
      auth_time: payload.auth_time
    });
  } catch (error) {
    sendOAuthError(res, error);
  }
});

router.post('/oauth2/introspect', authorize('api.connectedApps.oauth'), async (req, res) => {
  try {
    await authenticateConnectedClient(getClientCredentials(req));
    const payload = await verifyAccessToken(req.body.token, getRequestBaseUrl(req));
    res.json({ active: true, ...payload });
  } catch (error) {
    res.json({ active: false, error: error.oauthError || 'invalid_token' });
  }
});

router.post('/oauth2/revoke', authorize('api.connectedApps.oauth'), async (req, res) => {
  try {
    await authenticateConnectedClient(getClientCredentials(req));
    res.status(200).send('');
  } catch (error) {
    sendOAuthError(res, error);
  }
});

router.post('/api/connected-apps/wallet-challenges', authorize('api.connectedApps.client'), async (req, res) => {
  try {
    const authenticated = await authenticateConnectedClient(getClientCredentials(req));
    const challenge = await createConnectedAppWalletChallenge(authenticated.app, req.body);
    res.status(201).json({ challenge });
  } catch (error) {
    sendOAuthError(res, error);
  }
});

router.get('/api/connected-apps/log-test', authorize('api.connectedApps.client'), async (req, res) => {
  try {
    const authenticated = await authenticateConnectedClient(getClientCredentials(req));
    await logConnectedAppEvent({
      workspaceId: authenticated.app.workspaceId,
      appId: authenticated.app.id,
      clientId: authenticated.app.clientId,
      category: 'api',
      eventType: 'connected_app.api.probe',
      method: req.method,
      path: req.path,
      statusCode: 200,
      payload: { ok: true }
    });
    res.json({ ok: true, clientId: authenticated.app.clientId });
  } catch (error) {
    sendOAuthError(res, error);
  }
});

function normalizeAuthorizeRequest(input = {}) {
  return {
    clientId: normalizeText(input.client_id || input.clientId, 180),
    redirectUri: normalizeText(input.redirect_uri || input.redirectUri, 800),
    responseType: normalizeText(input.response_type || input.responseType, 40),
    scope: normalizeText(input.scope, 500) || 'openid profile email',
    state: normalizeText(input.state, 500),
    nonce: normalizeText(input.nonce, 500)
  };
}

function getClientCredentials(req) {
  const basicHeader = req.get('authorization') || '';
  if (basicHeader.toLowerCase().startsWith('basic ')) {
    const decoded = Buffer.from(basicHeader.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    return {
      clientId: separator >= 0 ? decoded.slice(0, separator) : decoded,
      clientSecret: separator >= 0 ? decoded.slice(separator + 1) : '',
      certificateFingerprint: req.get('x-aegis-certificate-sha256')
    };
  }
  return {
    clientId: req.body.client_id || req.body.clientId || req.get('x-aegis-client-id'),
    clientSecret: req.body.client_secret || req.body.clientSecret || req.get('x-aegis-client-secret'),
    certificateFingerprint: req.body.certificateFingerprint || req.get('x-aegis-certificate-sha256')
  };
}

function getBearerToken(req) {
  const authorization = req.get('authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    const error = new Error('Bearer token is required.');
    error.status = 401;
    error.oauthError = 'invalid_token';
    throw error;
  }
  return authorization.slice(7).trim();
}

function redirectOAuthError(res, redirectUri, error, state) {
  if (!redirectUri) {
    return res.status(400).json({ error });
  }
  const redirect = new URL(redirectUri);
  redirect.searchParams.set('error', error);
  if (state) {
    redirect.searchParams.set('state', state);
  }
  return res.redirect(303, redirect.toString());
}

function sendOAuthError(res, error) {
  const status = error.status || 400;
  res.status(status).json({
    error: error.oauthError || 'server_error',
    error_description: error.message || 'Connected app request failed.'
  });
}

function getRequestBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
}

function normalizeText(value = '', max = 400) {
  return String(value || '').trim().slice(0, max);
}

module.exports = router;
