// Shared contract and helpers for authentication adapters.
//
// An adapter is an inbound ("upstream") authentication plugin: it authenticates
// a person through some external protocol and hands Aegis ID a normalized set of
// claims. SAML 2.0, Kerberos/SPNEGO and certificate-based auth (CBA) are the
// first three; provider presets (Entra, Okta, …) are thin wrappers over them.
//
// Every adapter module exports the same shape so the registry can treat them
// uniformly. This mirrors the shape already proven in upstream-idp-service.js
// (startUpstreamAuthorization / completeUpstreamAuthorization / mapUpstreamClaims),
// generalized to many protocols and many configured instances.
//
//   describe()                      -> static metadata for the catalogue
//   configSchema()                  -> field descriptors for the config UI
//   normalizeConfig(input)          -> cleaned, persistable config (secrets by reference only)
//   validateConfig(config)          -> [] or a list of human-readable problems
//   async startAuthorization(ctx)   -> { redirectUrl } | { negotiate } | { prompt }  (begin a sign-in)
//   async completeAuthorization(ctx)-> raw provider assertion/identity               (finish a sign-in)
//   mapClaims(raw, instance)        -> normalized Aegis claims
//   async test({ instance, sample })-> { ok, title, detail, claims? }                (self-test)
//
// The registry calls normalizeConfig + validateConfig on save (deny-by-default:
// an instance that does not validate is not activated), and mapClaims/test for
// the admin self-test surface.

const crypto = require('node:crypto');

/** Trim and bound a free-text value; the single normalizer used everywhere. */
function normalizeText(value = '', max = 2000) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}

function normalizeEmail(value = '') {
  return normalizeText(value, 320).toLowerCase();
}

/** A stable, opaque subject prefix per protocol, e.g. "saml:…". */
function subjectFor(protocol, issuer, rawSubject) {
  return `${protocol}:${normalizeText(issuer, 240)}:${normalizeText(rawSubject, 240)}`;
}

/**
 * Apply a "source -> target" attribute map (one mapping per line or comma) to a
 * flat attributes object, returning a normalized subset. Unmapped attributes are
 * dropped so an adapter never leaks arbitrary provider attributes into claims.
 */
function applyAttributeMap(attributes = {}, mappingText = '') {
  const lower = {};
  for (const [key, value] of Object.entries(attributes || {})) {
    lower[String(key).toLowerCase()] = value;
  }
  const out = {};
  for (const pair of String(mappingText || '').split(/[\n,]+/)) {
    const [fromRaw, toRaw] = pair.split(/[:=]|->|→/).map((part) => (part || '').trim());
    if (!fromRaw || !toRaw) {
      continue;
    }
    const value = lower[fromRaw.toLowerCase()];
    if (value !== undefined) {
      out[toRaw] = Array.isArray(value) ? value : value;
    }
  }
  return out;
}

/** Coerce a claim value that may be a single string or an array into a role list. */
function toRoleList(value) {
  if (value === undefined || value === null) {
    return [];
  }
  const items = Array.isArray(value) ? value : String(value).split(/[,;]+/);
  return items.map((item) => normalizeText(item, 160)).filter(Boolean);
}

/**
 * Shape the normalized claim object every adapter returns, so connected-app code
 * downstream sees a single contract regardless of protocol. Keeps the same field
 * names mapUpstreamClaims already emits (subject, email, name, roles, acr, …).
 */
function buildClaims({
  protocol,
  instanceId,
  issuer,
  rawSubject,
  email,
  name,
  roles = [],
  acr,
  extra = {}
}) {
  const normalizedEmail = normalizeEmail(email);
  return {
    subject: subjectFor(protocol, issuer, rawSubject || normalizedEmail),
    email: normalizedEmail,
    name: normalizeText(name || normalizedEmail, 160),
    roles: ['connected_app_user', `upstream_${protocol}`, ...toRoleList(roles)],
    acr: acr || `urn:aegis-id:auth:upstream-${protocol}`,
    identityProvider: protocol,
    adapterInstanceId: normalizeText(instanceId, 120),
    upstreamSubject: normalizeText(rawSubject || normalizedEmail, 240),
    ...extra
  };
}

/** An error that routes/registry can surface to the operator verbatim. */
function adapterError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function createToken(byteLength = 24) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

/**
 * A config value that names a secret store entry rather than the secret itself.
 * We keep the *reference* and refuse anything that looks like raw key material,
 * matching the clientSecretReference discipline in platform-service.js.
 */
function normalizeSecretRef(value = '') {
  const ref = normalizeText(value, 400);
  if (/-----BEGIN (RSA |EC )?PRIVATE KEY-----/.test(ref)) {
    throw adapterError('Store the secret in Key Vault or an app setting and enter its reference here — not the key material.');
  }
  return ref;
}

module.exports = {
  normalizeText,
  normalizeEmail,
  normalizeSecretRef,
  subjectFor,
  applyAttributeMap,
  toRoleList,
  buildClaims,
  adapterError,
  createToken
};
