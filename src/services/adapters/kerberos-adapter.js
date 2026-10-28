// Kerberos / SPNEGO upstream authentication adapter.
//
// Deployment model: a SPNEGO-terminating reverse proxy (IIS, Apache
// mod_auth_gssapi, nginx auth_gss) negotiates with the browser against Active
// Directory using a keytab, then forwards the authenticated principal to Aegis
// in a request header. This is the dominant, well-supported pattern for Kerberos
// SSO behind a Node app — Node does not natively terminate SPNEGO reliably.
//
// Because a header is only as trustworthy as who can set it, this adapter is
// deny-by-default: it refuses to activate unless a trusted-proxy allowlist is
// configured, and at runtime it rejects any request whose source address is not
// in that allowlist. (A future "native" mode can terminate SPNEGO in-process
// with a keytab; it would plug in at completeAuthorization.)

const {
  normalizeText,
  buildClaims,
  adapterError
} = require('./adapter-interface');

const PROTOCOL = 'kerberos';

function describe() {
  return {
    kind: PROTOCOL,
    name: 'Kerberos / SPNEGO',
    protocol: 'Kerberos (SPNEGO)',
    family: 'Enterprise · Upstream',
    direction: 'upstream',
    icon: 'KRB',
    phishingResistant: false,
    mandatory: true, // SSC ITC M4 — Active Directory / Kerberos baseline
    summary: 'Windows-integrated SSO via a SPNEGO-terminating proxy that forwards the authenticated principal.'
  };
}

function configSchema() {
  return [
    { key: 'headerName', label: 'Principal header', type: 'text', required: true,
      help: 'Header the proxy sets with the authenticated principal, e.g. X-Forwarded-User or REMOTE_USER.' },
    { key: 'trustedProxyCidrs', label: 'Trusted proxy addresses', type: 'textarea', required: true,
      help: 'IPv4 CIDRs or exact addresses allowed to assert the principal header, one per line. Required — an untrusted header is an auth bypass.' },
    { key: 'realm', label: 'Kerberos realm', type: 'text', required: false,
      help: 'The AD realm, e.g. CLOUDSTRUCC.CA. Used to validate and strip the principal suffix.' },
    { key: 'stripRealm', label: 'Strip realm from username', type: 'boolean', required: false },
    { key: 'emailDomain', label: 'Email domain', type: 'text', required: false,
      help: 'If the principal is a bare username, build the email as username@domain.' },
    { key: 'groupsHeader', label: 'Groups header', type: 'text', required: false,
      help: 'Optional header the proxy sets with group memberships, comma or semicolon separated. Becomes roles.' }
  ];
}

function normalizeConfig(input = {}) {
  return {
    headerName: normalizeText(input.headerName, 120) || 'x-forwarded-user',
    trustedProxyCidrs: normalizeText(input.trustedProxyCidrs, 4000),
    realm: normalizeText(input.realm, 200).toUpperCase(),
    stripRealm: input.stripRealm === undefined ? true : Boolean(input.stripRealm),
    emailDomain: normalizeText(input.emailDomain, 200).toLowerCase(),
    groupsHeader: normalizeText(input.groupsHeader, 120).toLowerCase()
  };
}

function validateConfig(config = {}) {
  const problems = [];
  if (!config.headerName) problems.push('A principal header name is required.');
  if (!parseCidrs(config.trustedProxyCidrs).length) {
    problems.push('At least one trusted proxy address or CIDR is required — Aegis will not trust the principal header from any source.');
  }
  return problems;
}

/** Split "a.b.c.d" / "a.b.c.d/nn" lines into checkable entries. */
function parseCidrs(text = '') {
  return String(text || '')
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = (value << 8) + n;
  }
  return value >>> 0;
}

/** True when remoteAddr matches any trusted CIDR/exact entry. IPv6 is exact-match only. */
function isTrustedProxy(remoteAddr, cidrs) {
  const addr = String(remoteAddr || '').replace(/^::ffff:/, '');
  const addrInt = ipv4ToInt(addr);
  for (const entry of cidrs) {
    if (entry === addr) return true;
    const [net, bitsRaw] = entry.split('/');
    const bits = Number(bitsRaw);
    const netInt = ipv4ToInt(net);
    if (addrInt === null || netInt === null) continue;
    if (!Number.isInteger(bits)) {
      if (netInt === addrInt) return true;
      continue;
    }
    if (bits < 0 || bits > 32) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((addrInt & mask) === (netInt & mask)) return true;
  }
  return false;
}

/** Split a principal (user@REALM, DOMAIN\\user, or user) into { username, realm }. */
function parsePrincipal(raw) {
  const value = normalizeText(raw, 400);
  if (value.includes('@')) {
    const [username, realm] = value.split('@');
    return { username, realm: (realm || '').toUpperCase() };
  }
  if (value.includes('\\')) {
    const [realm, username] = value.split('\\');
    return { username, realm: (realm || '').toUpperCase() };
  }
  return { username: value, realm: '' };
}

async function startAuthorization({ instance }) {
  // Nothing for Aegis to redirect to: the proxy in front performs the Negotiate
  // handshake. We return the challenge hint so a caller can surface it.
  return { negotiate: true, header: 'WWW-Authenticate: Negotiate', note: 'Handled by the SPNEGO-terminating proxy.' };
}

/**
 * ctx: { instance, principal, groups, remoteAddr }. The route extracts the
 * header value and the socket address; this enforces the trust boundary.
 */
function completeAuthorization({ instance, principal, groups, remoteAddr }) {
  const config = instance.config || {};
  const cidrs = parseCidrs(config.trustedProxyCidrs);
  if (!isTrustedProxy(remoteAddr, cidrs)) {
    throw adapterError('The Kerberos principal header came from an address that is not a trusted proxy.', 403);
  }
  if (!principal) {
    throw adapterError('No principal was present in the configured header.', 401);
  }
  const parsed = parsePrincipal(principal);
  if (config.realm && parsed.realm && parsed.realm !== config.realm) {
    throw adapterError(`Principal realm ${parsed.realm} does not match the configured realm ${config.realm}.`, 401);
  }
  const roleList = String(groups || '').split(/[,;]+/).map((g) => g.trim()).filter(Boolean);
  return { username: parsed.username, realm: parsed.realm || config.realm, groups: roleList };
}

function mapClaims(raw = {}, instance = {}) {
  const config = instance.config || {};
  const username = config.stripRealm === false && raw.realm ? `${raw.username}@${raw.realm}` : raw.username;
  const email = config.emailDomain && raw.username ? `${raw.username}@${config.emailDomain}` : raw.username;
  return buildClaims({
    protocol: PROTOCOL,
    instanceId: instance.id,
    issuer: raw.realm || config.realm || 'kerberos',
    rawSubject: `${raw.username}@${raw.realm || config.realm || ''}`,
    email,
    name: username,
    roles: raw.groups,
    acr: 'urn:aegis-id:auth:upstream-kerberos'
  });
}

async function test({ instance, sample = {} }) {
  const config = instance.config || {};
  const problems = validateConfig(config);
  if (problems.length) {
    return { ok: false, title: 'Configuration incomplete', detail: problems.join(' ') };
  }
  if (!sample.principal) {
    return { ok: true, title: 'Configuration valid', detail: `Header ${config.headerName}, ${parseCidrs(config.trustedProxyCidrs).length} trusted proxy entr${parseCidrs(config.trustedProxyCidrs).length === 1 ? 'y' : 'ies'}. Provide a sample principal to see the mapped claims.` };
  }
  // Simulate the proxy handing us a principal from a trusted address.
  const remoteAddr = sample.remoteAddr || parseCidrs(config.trustedProxyCidrs)[0].split('/')[0];
  const raw = completeAuthorization({ instance, principal: sample.principal, groups: sample.groups, remoteAddr });
  const claims = mapClaims(raw, instance);
  return { ok: true, title: 'Principal mapped', detail: `${sample.principal} → ${claims.email}`, claims };
}

module.exports = {
  describe,
  configSchema,
  normalizeConfig,
  validateConfig,
  startAuthorization,
  completeAuthorization,
  mapClaims,
  isTrustedProxy,
  parsePrincipal,
  test
};
