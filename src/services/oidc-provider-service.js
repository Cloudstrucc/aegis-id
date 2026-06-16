const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');

const store = new FileJsonStore(config.paths.oidcCodes, []);

function createToken(byteLength = 24) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

function nowIso() {
  return new Date().toISOString();
}

async function createAuthorizationCode(input = {}) {
  const code = `aegis-code-${createToken(18)}`;
  const claims = {
    iss: `${config.app.publicBaseUrl}/oidc`,
    sub: normalizeSubject(input.email),
    aud: normalizeText(input.clientId, 160),
    email: normalizeEmail(input.email),
    name: normalizeText(input.name, 160) || 'Aegis ID User',
    organization_id: normalizeText(input.organizationId, 120),
    acr: 'urn:vanguard:aegis-id:auth:oidc-wallet-required',
    nonce: normalizeText(input.nonce, 180),
    auth_time: Math.floor(Date.now() / 1000)
  };

  const record = {
    code,
    clientId: claims.aud,
    redirectUri: normalizeText(input.redirectUri, 500),
    nonce: claims.nonce,
    claims,
    status: 'issued',
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
  };
  await store.append(record);
  return record;
}

async function exchangeAuthorizationCode(input = {}) {
  const records = await store.read();
  const index = records.findIndex((record) => record.code === input.code);
  if (index === -1) {
    throw invalidGrant('Authorization code was not found.');
  }

  const record = records[index];
  if (record.status !== 'issued') {
    throw invalidGrant('Authorization code has already been used.');
  }
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    throw invalidGrant('Authorization code has expired.');
  }
  if (record.clientId !== input.clientId) {
    throw invalidGrant('Client ID does not match the authorization request.');
  }
  if (record.redirectUri !== input.redirectUri) {
    throw invalidGrant('Redirect URI does not match the authorization request.');
  }

  records[index] = {
    ...record,
    status: 'redeemed',
    redeemedAt: nowIso()
  };
  await store.write(records);

  return {
    token_type: 'Bearer',
    expires_in: 900,
    access_token: `aegis-access-${createToken(24)}`,
    id_token: createUnsignedIdToken(record.claims),
    claims: record.claims
  };
}

function createUnsignedIdToken(claims) {
  const header = { alg: 'none', typ: 'JWT' };
  return `${base64url(header)}.${base64url({
    ...claims,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900
  })}.`;
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function normalizeSubject(email = '') {
  return normalizeEmail(email).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'aegis-user';
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeText(value = '', max = 400) {
  return String(value || '').trim().slice(0, max);
}

function invalidGrant(message) {
  const error = new Error(message);
  error.status = 400;
  error.error = 'invalid_grant';
  return error;
}

module.exports = {
  createAuthorizationCode,
  exchangeAuthorizationCode
};
