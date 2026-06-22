const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');

const upstreamStateStore = new FileJsonStore(config.paths.connectedAppUpstreamStates, []);
const STATE_TTL_MS = 10 * 60 * 1000;

function isUpstreamFederationEnabled() {
  const provider = getConfiguredProvider(config.app.publicBaseUrl);
  return provider.enabled;
}

async function startUpstreamAuthorization(input = {}) {
  const provider = getConfiguredProvider(input.baseUrl);
  if (!provider.enabled) {
    throw oauthError('temporarily_unavailable', 'Upstream identity provider is not configured.', 503);
  }

  const request = normalizeAuthorizationRequest(input.request);
  const app = input.app || {};
  const state = `up_${crypto.randomUUID()}`;
  const nonce = createToken(24);
  const codeVerifier = createToken(48);
  const codeChallenge = hashVerifier(codeVerifier);
  const now = new Date();
  const record = {
    id: state,
    provider: provider.id,
    appId: normalizeText(app.id, 120),
    workspaceId: normalizeText(app.workspaceId, 120),
    clientId: normalizeText(app.clientId || request.clientId, 180),
    request,
    redirectUri: provider.redirectUri,
    codeVerifier,
    nonce,
    status: 'issued',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + STATE_TTL_MS).toISOString()
  };

  await pruneExpiredStates();
  await upstreamStateStore.append(record);

  const redirect = new URL(provider.authorizationEndpoint);
  redirect.searchParams.set('client_id', provider.clientId);
  redirect.searchParams.set('response_type', 'code');
  redirect.searchParams.set('redirect_uri', provider.redirectUri);
  redirect.searchParams.set('response_mode', 'query');
  redirect.searchParams.set('scope', provider.scopes.join(' '));
  redirect.searchParams.set('state', state);
  redirect.searchParams.set('nonce', nonce);
  redirect.searchParams.set('code_challenge', codeChallenge);
  redirect.searchParams.set('code_challenge_method', 'S256');
  if (request.loginHint) {
    redirect.searchParams.set('login_hint', request.loginHint);
  }

  return {
    provider,
    state,
    redirectUrl: redirect.toString()
  };
}

async function completeUpstreamAuthorization(input = {}) {
  const record = await getIssuedState(input.state);
  const provider = getConfiguredProvider(input.baseUrl);
  if (!provider.enabled || provider.id !== record.provider) {
    throw oauthError('temporarily_unavailable', 'Upstream identity provider is not configured.', 503);
  }
  if (!input.code) {
    throw oauthError('invalid_request', 'Upstream authorization code is required.', 400);
  }

  const tokenResponse = await exchangeCodeForTokens(provider, record, input.code, input.fetchImpl || fetch);
  const payload = await verifyIdToken(tokenResponse.id_token, provider, record.nonce);
  await markState(record.id, 'redeemed', {
    redeemedAt: new Date().toISOString(),
    upstreamSubject: payload.sub
  });

  return {
    provider,
    record,
    claims: mapUpstreamClaims(payload, provider)
  };
}

async function failUpstreamAuthorization(input = {}) {
  const record = await getState(input.state);
  if (!record) {
    throw oauthError('invalid_request', 'Upstream authorization state was not found.', 400);
  }
  await markState(record.id, 'failed', {
    failedAt: new Date().toISOString(),
    error: normalizeText(input.error, 120),
    errorDescription: normalizeText(input.errorDescription, 500)
  });
  return record;
}

function getConfiguredProvider(baseUrl = '') {
  const upstream = config.connectedApps?.upstreamIdp || {};
  const mode = normalizeText(upstream.mode || 'local', 40).toLowerCase();
  if (mode !== 'entra') {
    return { id: 'local', enabled: false };
  }

  const entra = upstream.entra || {};
  const tenantId = normalizeText(entra.tenantId, 160);
  const issuer = normalizeText(entra.issuer, 500) || `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const normalizedBaseUrl = normalizeText(baseUrl || config.app.publicBaseUrl, 500).replace(/\/$/, '');
  const provider = {
    id: 'entra',
    tenantId,
    clientId: normalizeText(entra.clientId, 180),
    clientSecret: normalizeText(entra.clientSecret, 2000),
    redirectUri:
      normalizeText(entra.redirectUri, 800) ||
      `${normalizedBaseUrl}/oauth2/upstream/entra/callback`,
    scopes: Array.isArray(entra.scopes) && entra.scopes.length ? entra.scopes : ['openid', 'profile', 'email'],
    issuer,
    authorizationEndpoint:
      normalizeText(entra.authorizationEndpoint, 800) ||
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
    tokenEndpoint:
      normalizeText(entra.tokenEndpoint, 800) ||
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    jwksUri:
      normalizeText(entra.jwksUri, 800) ||
      `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`
  };
  return {
    ...provider,
    enabled: Boolean(provider.tenantId && provider.clientId && provider.clientSecret && provider.redirectUri)
  };
}

async function exchangeCodeForTokens(provider, record, code, fetchImpl) {
  const body = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: provider.redirectUri,
    code_verifier: record.codeVerifier
  });

  const response = await fetchImpl(provider.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body
  });
  const payload = await safeJson(response);
  if (!response.ok) {
    throw oauthError(
      payload.error || 'invalid_grant',
      payload.error_description || payload.message || 'Upstream token exchange failed.',
      response.status
    );
  }
  if (!payload.id_token) {
    throw oauthError('invalid_grant', 'Upstream token response did not include an id_token.', 502);
  }
  return payload;
}

async function verifyIdToken(idToken, provider, expectedNonce) {
  const { createRemoteJWKSet, jwtVerify } = await import('jose');
  const jwks = createRemoteJWKSet(new URL(provider.jwksUri));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: provider.issuer,
    audience: provider.clientId
  });
  if (payload.nonce !== expectedNonce) {
    throw oauthError('invalid_grant', 'Upstream id_token nonce did not match the authorization request.', 400);
  }
  return payload;
}

function mapUpstreamClaims(payload, provider) {
  const email = normalizeEmail(payload.email || payload.preferred_username || payload.upn);
  const name = normalizeText(payload.name || email, 160);
  const upstreamSubject = normalizeText(payload.oid || payload.sub || email, 240);
  const tenantId = normalizeText(payload.tid || provider.tenantId, 160);
  return {
    subject: `entra:${tenantId}:${upstreamSubject}`,
    email,
    name,
    roles: ['connected_app_user', 'upstream_entra'],
    acr: 'urn:vanguard:aegis-id:auth:upstream-entra',
    identityProvider: 'entra',
    upstreamSubject,
    upstreamTenantId: tenantId
  };
}

async function getIssuedState(state) {
  const record = await getState(state);
  if (!record) {
    throw oauthError('invalid_request', 'Upstream authorization state was not found.', 400);
  }
  if (record.status !== 'issued') {
    throw oauthError('invalid_request', 'Upstream authorization state has already been used.', 400);
  }
  if (Date.parse(record.expiresAt) < Date.now()) {
    throw oauthError('invalid_request', 'Upstream authorization state has expired.', 400);
  }
  return record;
}

async function getState(state) {
  const id = normalizeText(state, 120);
  if (!id) {
    return null;
  }
  const records = await upstreamStateStore.read();
  return records.find((record) => record.id === id) || null;
}

async function markState(state, status, patch = {}) {
  const records = await upstreamStateStore.read();
  const index = records.findIndex((record) => record.id === state);
  if (index === -1) {
    return null;
  }
  records[index] = {
    ...records[index],
    ...patch,
    status
  };
  await upstreamStateStore.write(records);
  return records[index];
}

async function pruneExpiredStates() {
  const records = await upstreamStateStore.read();
  const cutoff = Date.now() - STATE_TTL_MS;
  const retained = records.filter((record) => {
    const expiresAt = Date.parse(record.expiresAt || record.createdAt || '');
    return Number.isFinite(expiresAt) && expiresAt >= cutoff;
  });
  if (retained.length !== records.length) {
    await upstreamStateStore.write(retained);
  }
}

function normalizeAuthorizationRequest(input = {}) {
  return {
    clientId: normalizeText(input.clientId || input.client_id, 180),
    redirectUri: normalizeText(input.redirectUri || input.redirect_uri, 800),
    responseType: normalizeText(input.responseType || input.response_type, 40),
    scope: normalizeText(input.scope, 500) || 'openid profile email',
    state: normalizeText(input.state, 500),
    nonce: normalizeText(input.nonce, 500),
    loginHint: normalizeText(input.loginHint || input.login_hint, 320)
  };
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    return { error: 'invalid_response', message: text.slice(0, 500) };
  }
}

function hashVerifier(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function createToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

function normalizeEmail(value = '') {
  return normalizeText(value, 320).toLowerCase();
}

function normalizeText(value = '', max = 400) {
  return String(value || '').trim().slice(0, max);
}

function oauthError(code, message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.oauthError = code;
  return error;
}

module.exports = {
  completeUpstreamAuthorization,
  failUpstreamAuthorization,
  getConfiguredProvider,
  isUpstreamFederationEnabled,
  mapUpstreamClaims,
  startUpstreamAuthorization
};
