// Bridges an authentication adapter into the connected-app OAuth authorize flow.
//
// When the framework is enabled and an adapter is designated as the sign-in
// default, /oauth2/authorize begins the adapter flow here instead of the local
// login or the Entra upstream. The shape mirrors upstream-idp-service.js: a
// short-lived state record carries the pending OAuth request across the round
// trip, and on completion we mint a connected authorization code with the mapped
// claims exactly as the Entra callback does.

const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const {
  getDefaultSignInAdapter,
  getInstance,
  getAdapter
} = require('./adapter-registry-service');
const { createConnectedAuthorizationCode } = require('./connected-app-service');
const { adapterError, normalizeText } = require('./adapters/adapter-interface');

const stateStore = new FileJsonStore(config.paths.authAdapterStates, []);
const STATE_TTL_MS = 10 * 60 * 1000;

/** Is adapter-fronted connected-app sign-in active for this deployment? */
async function isAdapterSignInActive() {
  return Boolean(await getDefaultSignInAdapter());
}

/**
 * Begin an adapter sign-in for a connected-app authorize request. Returns a
 * redirect target: for SAML, the IdP SSO URL; for the header-based adapters
 * (Kerberos, CBA), our own completion endpoint, which the fronting proxy / mTLS
 * will have populated with the principal or client certificate.
 */
async function beginAuthorization({ app = {}, request = {}, baseUrl = '' }) {
  const instance = await getDefaultSignInAdapter();
  if (!instance) {
    throw adapterError('No sign-in adapter is configured.', 503);
  }
  const adapter = getAdapter(instance.kind);
  const state = await issueState(instance, request, app);

  if (instance.kind === 'saml') {
    const { redirectUrl } = await adapter.startAuthorization({ instance, relayState: state.id });
    return { kind: instance.kind, instanceId: instance.id, redirectUrl };
  }

  // Header / certificate adapters complete at our own endpoint.
  const base = normalizeText(baseUrl, 500).replace(/\/$/, '');
  return {
    kind: instance.kind,
    instanceId: instance.id,
    redirectUrl: `${base}/auth/adapters/${instance.kind}/${instance.id}/sso?state=${encodeURIComponent(state.id)}`
  };
}

/** Complete a SAML sign-in at the ACS. RelayState carries our state id. */
async function completeSaml({ instanceId, body = {} }) {
  const state = await consumeState(body.RelayState || body.relayState);
  assertStateAdapter(state, instanceId, 'saml');
  const instance = await getInstance(instanceId);
  const adapter = getAdapter('saml');
  const profile = await adapter.completeAuthorization({ instance, body });
  const claims = adapter.mapClaims(profile, instance);
  return finish(state, claims);
}

/** Complete a header/certificate sign-in (Kerberos, CBA). */
async function completeHeaderFlow({ kind, instanceId, stateId, req }) {
  const state = await consumeState(stateId);
  assertStateAdapter(state, instanceId, kind);
  const instance = await getInstance(instanceId);
  const adapter = getAdapter(kind);
  const remoteAddr = remoteAddressOf(req);

  let raw;
  if (kind === 'kerberos') {
    const principal = req.get(instance.config.headerName);
    const groups = instance.config.groupsHeader ? req.get(instance.config.groupsHeader) : '';
    raw = adapter.completeAuthorization({ instance, principal, groups, remoteAddr });
  } else if (kind === 'cba') {
    const pem = clientCertificateFrom(req, instance.config);
    raw = adapter.completeAuthorization({ instance, pem, remoteAddr });
  } else {
    throw adapterError(`Adapter kind ${kind} cannot complete at this endpoint.`, 400);
  }
  const claims = adapter.mapClaims(raw, instance);
  return finish(state, claims);
}

/** Mint the connected authorization code and build the redirect back to the RP. */
async function finish(state, claims) {
  const request = state.request;
  const authorization = await createConnectedAuthorizationCode({
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    scope: request.scope,
    state: request.state,
    nonce: request.nonce,
    ...claims
  });
  const redirect = new URL(authorization.code.redirectUri);
  redirect.searchParams.set('code', authorization.code.code);
  if (authorization.code.state) {
    redirect.searchParams.set('state', authorization.code.state);
  }
  return { redirectUrl: redirect.toString(), app: authorization.app, claims };
}

// --- state store ----------------------------------------------------------

async function issueState(instance, request, app) {
  await pruneExpired();
  const now = new Date();
  const record = {
    id: `ads_${crypto.randomUUID()}`,
    adapterId: instance.id,
    kind: instance.kind,
    appId: normalizeText(app.id, 120),
    request: {
      clientId: normalizeText(request.clientId, 180),
      redirectUri: normalizeText(request.redirectUri, 800),
      scope: normalizeText(request.scope, 500) || 'openid profile email',
      state: normalizeText(request.state, 500),
      nonce: normalizeText(request.nonce, 500)
    },
    status: 'issued',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + STATE_TTL_MS).toISOString()
  };
  await stateStore.append(record);
  return record;
}

async function consumeState(id) {
  const stateId = normalizeText(id, 120);
  if (!stateId) {
    throw adapterError('Missing or invalid sign-in state.', 400);
  }
  const records = await stateStore.read();
  const index = records.findIndex((entry) => entry.id === stateId);
  if (index === -1 || records[index].status !== 'issued') {
    throw adapterError('Sign-in state was not found or has already been used.', 400);
  }
  if (Date.parse(records[index].expiresAt) < Date.now()) {
    throw adapterError('Sign-in state has expired.', 400);
  }
  const record = records[index];
  records[index] = { ...record, status: 'redeemed', redeemedAt: new Date().toISOString() };
  await stateStore.write(records);
  return record;
}

function assertStateAdapter(state, instanceId, kind) {
  if (state.adapterId !== normalizeText(instanceId, 120) || state.kind !== kind) {
    throw adapterError('Sign-in state does not match this adapter.', 400);
  }
}

async function pruneExpired() {
  const records = await stateStore.read();
  const cutoff = Date.now() - STATE_TTL_MS;
  const retained = records.filter((entry) => {
    const expiresAt = Date.parse(entry.expiresAt || entry.createdAt || '');
    return Number.isFinite(expiresAt) && expiresAt >= cutoff;
  });
  if (retained.length !== records.length) {
    await stateStore.write(retained);
  }
}

// --- request helpers ------------------------------------------------------

function remoteAddressOf(req) {
  return (req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '').toString();
}

/** A forwarded PEM header, or the TLS peer certificate under direct mutual TLS. */
function clientCertificateFrom(req, config) {
  if (config.clientCertHeader) {
    return req.get(config.clientCertHeader) || '';
  }
  const peer = req.socket?.getPeerCertificate?.(true);
  if (peer && peer.raw) {
    return `-----BEGIN CERTIFICATE-----\n${peer.raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----`;
  }
  return '';
}

module.exports = {
  isAdapterSignInActive,
  beginAuthorization,
  completeSaml,
  completeHeaderFlow
};
