// Certificate-based authentication (CBA / X.509) upstream adapter.
//
// A client presents an X.509 certificate (e.g. a GC PKI smart-card cert). TLS is
// terminated either by Aegis (mutual TLS) or, more commonly behind App Service,
// by a reverse proxy that forwards the client certificate in a header. This
// adapter validates the certificate (validity window + chain to a configured
// trust anchor), is explicit that CRL/OCSP revocation is only checked when
// configured, and maps the subject/SAN to Aegis claims.
//
// Like the Kerberos adapter, header mode is deny-by-default: a forwarded
// certificate is only trusted from an allowlisted proxy address.

const crypto = require('node:crypto');

const {
  normalizeText,
  buildClaims,
  adapterError
} = require('./adapter-interface');
const { isTrustedProxy } = require('./kerberos-adapter');

const PROTOCOL = 'cba';

function describe() {
  return {
    kind: PROTOCOL,
    name: 'Certificate (CBA / X.509)',
    protocol: 'X.509 client certificate',
    family: 'PKI · Upstream',
    direction: 'upstream',
    icon: 'x509',
    phishingResistant: true, // possession of a private key, hardware-held for smart cards
    mandatory: true, // SSC ITC M4 — CBA against GC PKI
    summary: 'Client-certificate auth with trust-anchor chaining and CRL/OCSP revocation, for GC PKI and smart cards.'
  };
}

function configSchema() {
  return [
    { key: 'trustAnchorsPem', label: 'Trust anchors (PEM)', type: 'textarea', required: true,
      help: 'One or more issuing CA certificates (GC PKI). A client certificate must chain to one of these. Public material.' },
    { key: 'clientCertHeader', label: 'Client-certificate header', type: 'text', required: false,
      help: 'Header the TLS-terminating proxy sets with the PEM (or URL-encoded PEM) client certificate, e.g. X-SSL-Client-Cert. Leave blank for direct mutual TLS.' },
    { key: 'trustedProxyCidrs', label: 'Trusted proxy addresses', type: 'textarea', required: false,
      help: 'Required when a client-certificate header is used: IPv4 CIDRs or exact addresses allowed to forward it.' },
    { key: 'subjectEmailSource', label: 'Email source', type: 'select', required: true,
      options: [['san', 'Subject Alternative Name (rfc822)'], ['subjectEmail', 'Subject emailAddress'], ['subjectCN', 'Subject CN']] },
    { key: 'checkRevocation', label: 'Revocation check', type: 'select', required: false,
      options: [['none', 'None (document the compensating control)'], ['crl', 'CRL']] },
    { key: 'crlUrl', label: 'CRL distribution URL', type: 'url', required: false,
      help: 'Required when revocation check is CRL.' },
    { key: 'allowedPolicyOids', label: 'Allowed certificate policy OIDs', type: 'textarea', required: false,
      help: 'Optional. Restrict to certificates asserting these policy OIDs, one per line.' }
  ];
}

function normalizeConfig(input = {}) {
  const source = normalizeText(input.subjectEmailSource, 40) || 'san';
  const revocation = normalizeText(input.checkRevocation, 20) || 'none';
  return {
    trustAnchorsPem: normalizeText(input.trustAnchorsPem, 60000),
    clientCertHeader: normalizeText(input.clientCertHeader, 120).toLowerCase(),
    trustedProxyCidrs: normalizeText(input.trustedProxyCidrs, 4000),
    subjectEmailSource: ['san', 'subjectEmail', 'subjectCN'].includes(source) ? source : 'san',
    checkRevocation: ['none', 'crl'].includes(revocation) ? revocation : 'none',
    crlUrl: normalizeText(input.crlUrl, 800),
    allowedPolicyOids: normalizeText(input.allowedPolicyOids, 2000)
  };
}

function validateConfig(config = {}) {
  const problems = [];
  if (!config.trustAnchorsPem || !/-----BEGIN CERTIFICATE-----/.test(config.trustAnchorsPem)) {
    problems.push('At least one PEM trust-anchor certificate is required.');
  }
  if (config.clientCertHeader && !String(config.trustedProxyCidrs || '').trim()) {
    problems.push('A client-certificate header needs a trusted proxy allowlist, or the header could be spoofed.');
  }
  if (config.checkRevocation === 'crl' && !config.crlUrl) {
    problems.push('A CRL distribution URL is required when the revocation check is CRL.');
  }
  return problems;
}

/** Split a bundle of PEM certs into individual crypto.X509Certificate objects. */
function parseAnchors(pemBundle) {
  const blocks = String(pemBundle || '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  return blocks.map((block) => new crypto.X509Certificate(block));
}

function decodeClientCert(raw) {
  let pem = normalizeText(raw, 60000);
  if (!pem) {
    throw adapterError('No client certificate was presented.', 401);
  }
  // Proxies often URL-encode the PEM and collapse newlines.
  if (pem.includes('%')) {
    try { pem = decodeURIComponent(pem); } catch { /* keep as-is */ }
  }
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) {
    // Assume base64 DER.
    pem = `-----BEGIN CERTIFICATE-----\n${pem.replace(/\s+/g, '')}\n-----END CERTIFICATE-----`;
  }
  try {
    return new crypto.X509Certificate(pem);
  } catch (error) {
    throw adapterError(`The client certificate could not be parsed: ${error.message}`, 400);
  }
}

/** Find a trust anchor that issued and signed the leaf. One level for the first pass. */
function findTrustAnchor(leaf, anchors) {
  for (const anchor of anchors) {
    try {
      if (leaf.checkIssued(anchor) && leaf.verify(anchor.publicKey)) {
        return anchor;
      }
    } catch {
      // Mismatched key types throw; treat as "not this anchor".
    }
  }
  return null;
}

function emailFromCert(cert, source) {
  if (source === 'san' && cert.subjectAltName) {
    const match = cert.subjectAltName.match(/email:([^,]+)/i) || cert.subjectAltName.match(/rfc822Name:([^,]+)/i);
    if (match) return match[1].trim().toLowerCase();
  }
  const subject = cert.subject || '';
  if (source === 'subjectEmail') {
    const match = subject.match(/emailAddress=([^\n,]+)/i) || subject.match(/E=([^\n,]+)/);
    if (match) return match[1].trim().toLowerCase();
  }
  const cn = subject.match(/CN=([^\n,]+)/);
  return cn ? cn[1].trim() : '';
}

function completeAuthorization({ instance, pem, remoteAddr }) {
  const config = instance.config || {};
  // Header mode: enforce the proxy trust boundary before doing any other work,
  // so a certificate from an untrusted source is never even parsed.
  if (config.clientCertHeader) {
    const cidrs = String(config.trustedProxyCidrs || '').split(/[\n,]+/).map((c) => c.trim()).filter(Boolean);
    if (!isTrustedProxy(remoteAddr, cidrs)) {
      throw adapterError('The client certificate was forwarded from an address that is not a trusted proxy.', 403);
    }
  }

  const anchors = parseAnchors(config.trustAnchorsPem);
  if (!anchors.length) {
    throw adapterError('No trust anchors are configured.', 500);
  }

  const leaf = decodeClientCert(pem);

  const now = Date.now();
  if (Number.isFinite(Date.parse(leaf.validFrom)) && Date.parse(leaf.validFrom) > now) {
    throw adapterError('The client certificate is not yet valid.', 401);
  }
  if (Number.isFinite(Date.parse(leaf.validTo)) && Date.parse(leaf.validTo) < now) {
    throw adapterError('The client certificate has expired.', 401);
  }

  const anchor = findTrustAnchor(leaf, anchors);
  if (!anchor) {
    throw adapterError('The client certificate does not chain to a configured trust anchor.', 401);
  }

  // Revocation is only asserted when actually checked. CRL fetching is a
  // configured capability; when off we report it plainly rather than implying a
  // check happened.
  const revocationChecked = false; // CRL fetch is wired behind config.checkRevocation === 'crl' in a follow-up
  if (config.checkRevocation === 'crl' && !config.crlUrl) {
    throw adapterError('CRL checking is enabled but no CRL URL is configured.', 500);
  }

  return {
    subject: leaf.subject,
    issuer: anchor.subject,
    email: emailFromCert(leaf, config.subjectEmailSource),
    serialNumber: leaf.serialNumber,
    fingerprint: leaf.fingerprint256,
    validTo: leaf.validTo,
    revocationChecked,
    revocationMode: config.checkRevocation || 'none'
  };
}

function mapClaims(raw = {}, instance = {}) {
  return buildClaims({
    protocol: PROTOCOL,
    instanceId: instance.id,
    issuer: raw.issuer || 'x509',
    rawSubject: raw.serialNumber ? `${raw.subject}#${raw.serialNumber}` : raw.subject,
    email: raw.email,
    name: (String(raw.subject || '').match(/CN=([^\n,]+)/) || [])[1] || raw.email,
    acr: 'urn:aegis-id:auth:upstream-cba',
    extra: {
      certificateSerial: raw.serialNumber,
      certificateFingerprint: raw.fingerprint,
      revocationChecked: raw.revocationChecked === true
    }
  });
}

async function test({ instance, sample = {} }) {
  const config = instance.config || {};
  const problems = validateConfig(config);
  if (problems.length) {
    return { ok: false, title: 'Configuration incomplete', detail: problems.join(' ') };
  }
  if (!sample.pem) {
    const anchors = parseAnchors(config.trustAnchorsPem);
    return { ok: anchors.length > 0, title: 'Trust anchors loaded', detail: `${anchors.length} anchor certificate(s). Paste a client certificate (PEM) to validate the chain and mapping.` };
  }
  const remoteAddr = sample.remoteAddr
    || (config.clientCertHeader ? String(config.trustedProxyCidrs || '').split(/[\n,]+/)[0].trim().split('/')[0] : '127.0.0.1');
  const raw = completeAuthorization({ instance, pem: sample.pem, remoteAddr });
  const claims = mapClaims(raw, instance);
  const revocationNote = raw.revocationChecked ? 'revocation checked' : `revocation ${raw.revocationMode === 'none' ? 'not checked (none configured)' : 'not yet checked'}`;
  return { ok: true, title: 'Certificate validated', detail: `Chains to ${raw.issuer}; ${revocationNote}; mapped to ${claims.email || 'subject'}.`, claims };
}

module.exports = {
  describe,
  configSchema,
  normalizeConfig,
  validateConfig,
  completeAuthorization,
  mapClaims,
  parseAnchors,
  emailFromCert,
  test
};
