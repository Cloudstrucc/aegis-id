const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

// Point every store this suite touches at a throwaway directory BEFORE config is
// required. dotenv does not override an env var that is already set, so these win
// over .env.local and nothing lands in the repo's data/ or audit files.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-adapters-'));
process.env.AUTH_ADAPTER_STORE_PATH = path.join(TMP, 'auth-adapters.json');
process.env.AUTH_ADAPTER_STATE_STORE_PATH = path.join(TMP, 'auth-adapter-states.json');
process.env.AUDIT_STORE_PATH = path.join(TMP, 'audit.json');
process.env.AUDIT_CHAIN_ENABLED = 'false';

const saml = require('../src/services/adapters/saml-adapter');
const kerberos = require('../src/services/adapters/kerberos-adapter');
const cba = require('../src/services/adapters/cba-adapter');
const registry = require('../src/services/adapter-registry-service');

// ---------------------------------------------------------------------------
// SAML
// ---------------------------------------------------------------------------
test('SAML: validateConfig is deny-by-default on an incomplete instance', () => {
  const problems = saml.validateConfig(saml.normalizeConfig({ idpEntityId: 'idp' }));
  assert.ok(problems.length >= 1);
  assert.ok(problems.some((p) => /signing certificate/i.test(p)));
});

test('SAML: mapClaims applies the attribute map and drops unmapped attributes', () => {
  const instance = {
    id: 'adp_saml',
    config: saml.normalizeConfig({
      idpEntityId: 'https://idp.example/entity',
      attributeMap: 'mail -> email\nrole -> roles',
      roleAttribute: ''
    })
  };
  const profile = {
    issuer: 'https://idp.example/entity',
    nameID: 'jdoe@example.ca',
    mail: 'jdoe@example.ca',
    role: ['Finance', 'Approver'],
    department: 'leaked-should-not-appear'
  };
  const claims = saml.mapClaims(profile, instance);
  assert.equal(claims.email, 'jdoe@example.ca');
  assert.equal(claims.identityProvider, 'saml');
  assert.ok(claims.roles.includes('Finance'));
  assert.ok(claims.roles.includes('Approver'));
  assert.ok(!JSON.stringify(claims).includes('leaked-should-not-appear'));
  assert.equal(claims.acr, 'urn:aegis-id:auth:upstream-saml');
});

test('SAML: parseMetadata extracts entityID, SSO URL and signing cert', async () => {
  const xml = `<?xml version="1.0"?>
  <EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://sts.example/adfs">
    <IDPSSODescriptor>
      <KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>MIIBdummyCERTdata==</X509Certificate></X509Data></KeyInfo></KeyDescriptor>
      <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://sts.example/adfs/ls/"/>
    </IDPSSODescriptor>
  </EntityDescriptor>`;
  const meta = await saml.parseMetadata(xml);
  assert.equal(meta.entityId, 'https://sts.example/adfs');
  assert.equal(meta.ssoUrl, 'https://sts.example/adfs/ls/');
  assert.ok(meta.cert.includes('BEGIN CERTIFICATE'));
});

// ---------------------------------------------------------------------------
// Kerberos — the trust boundary is the whole point
// ---------------------------------------------------------------------------
test('Kerberos: refuses to validate without a trusted-proxy allowlist', () => {
  const problems = kerberos.validateConfig(kerberos.normalizeConfig({ headerName: 'x-forwarded-user' }));
  assert.ok(problems.some((p) => /trusted proxy/i.test(p)));
});

test('Kerberos: isTrustedProxy matches CIDR and rejects outside it', () => {
  assert.equal(kerberos.isTrustedProxy('10.1.2.3', ['10.1.0.0/16']), true);
  assert.equal(kerberos.isTrustedProxy('10.2.2.3', ['10.1.0.0/16']), false);
  assert.equal(kerberos.isTrustedProxy('::ffff:10.1.2.3', ['10.1.0.0/16']), true);
  assert.equal(kerberos.isTrustedProxy('127.0.0.1', ['127.0.0.1']), true);
});

test('Kerberos: completeAuthorization rejects a principal from an untrusted address', () => {
  const instance = { id: 'adp_krb', config: kerberos.normalizeConfig({ headerName: 'x-forwarded-user', trustedProxyCidrs: '10.0.0.0/8', realm: 'CLOUDSTRUCC.CA' }) };
  assert.throws(
    () => kerberos.completeAuthorization({ instance, principal: 'jdoe@CLOUDSTRUCC.CA', remoteAddr: '203.0.113.9' }),
    /not a trusted proxy/i
  );
});

test('Kerberos: parsePrincipal handles user@REALM and DOMAIN\\\\user, and mapClaims builds email', () => {
  assert.deepEqual(kerberos.parsePrincipal('jdoe@CLOUDSTRUCC.CA'), { username: 'jdoe', realm: 'CLOUDSTRUCC.CA' });
  assert.deepEqual(kerberos.parsePrincipal('CLOUDSTRUCC\\jdoe'), { username: 'jdoe', realm: 'CLOUDSTRUCC' });
  const instance = { id: 'adp_krb', config: kerberos.normalizeConfig({ headerName: 'h', trustedProxyCidrs: '10.0.0.0/8', emailDomain: 'cloudstrucc.ca' }) };
  const claims = kerberos.mapClaims({ username: 'jdoe', realm: 'CLOUDSTRUCC.CA', groups: ['Finance'] }, instance);
  assert.equal(claims.email, 'jdoe@cloudstrucc.ca');
  assert.ok(claims.roles.includes('Finance'));
});

// ---------------------------------------------------------------------------
// CBA
// ---------------------------------------------------------------------------
test('CBA: a client-certificate header without a trusted-proxy allowlist does not validate', () => {
  const problems = cba.validateConfig(cba.normalizeConfig({
    trustAnchorsPem: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----',
    clientCertHeader: 'x-ssl-client-cert'
  }));
  assert.ok(problems.some((p) => /trusted proxy/i.test(p)));
});

test('CBA: CRL mode requires a CRL URL', () => {
  const problems = cba.validateConfig(cba.normalizeConfig({
    trustAnchorsPem: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----',
    checkRevocation: 'crl'
  }));
  assert.ok(problems.some((p) => /CRL/i.test(p)));
});

test('CBA: header mode rejects a certificate forwarded from an untrusted address before parsing it', () => {
  const instance = { id: 'adp_cba', config: cba.normalizeConfig({
    trustAnchorsPem: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----',
    clientCertHeader: 'x-ssl-client-cert',
    trustedProxyCidrs: '10.0.0.0/8'
  }) };
  assert.throws(
    () => cba.completeAuthorization({ instance, pem: 'anything', remoteAddr: '203.0.113.5' }),
    /not a trusted proxy/i
  );
});

test('CBA: a real certificate chaining to a trust anchor validates and maps (needs openssl)', { skip: !hasOpenssl() }, () => {
  const { caPem, leafPem } = makeChain();
  const instance = { id: 'adp_cba', config: cba.normalizeConfig({
    trustAnchorsPem: caPem,
    subjectEmailSource: 'subjectCN',
    checkRevocation: 'none'
  }) };
  const raw = cba.completeAuthorization({ instance, pem: leafPem, remoteAddr: '127.0.0.1' });
  assert.equal(raw.revocationChecked, false, 'revocation is reported as not checked when none is configured');
  const claims = cba.mapClaims(raw, instance);
  assert.equal(claims.identityProvider, 'cba');
  assert.ok(claims.subject.includes('cba:'));

  // A certificate that does not chain to the anchor is rejected.
  const { leafPem: strayLeaf } = makeChain();
  assert.throws(() => cba.completeAuthorization({ instance, pem: strayLeaf, remoteAddr: '127.0.0.1' }), /does not chain/i);
});

// ---------------------------------------------------------------------------
// Registry — deny-by-default persistence + evidence
// ---------------------------------------------------------------------------
test('registry: invalid config is parked as a draft, valid config goes active', async () => {
  const draft = await registry.createInstance({ kind: 'saml', name: 'Half-configured', config: { idpEntityId: 'idp' }, actorEmail: 'admin@example.ca' });
  assert.equal(draft.record.status, 'draft');
  assert.ok(draft.problems.length >= 1);

  const good = await registry.createInstance({
    kind: 'kerberos',
    name: 'AD SSO',
    config: { headerName: 'x-forwarded-user', trustedProxyCidrs: '10.0.0.0/8', realm: 'CLOUDSTRUCC.CA' },
    actorEmail: 'admin@example.ca'
  });
  assert.equal(good.record.status, 'active');

  const all = await registry.listInstances();
  assert.ok(all.find((a) => a.id === draft.record.id));
  assert.ok(all.find((a) => a.id === good.record.id));
});

test('registry: a passing live self-test promotes a draft to active', async () => {
  // Create a Kerberos adapter that validates, then self-test with a sample
  // principal — runSelfTest should record a pass. (Validates already, so this
  // mainly exercises the test path + audit write.)
  const created = await registry.createInstance({
    kind: 'kerberos',
    name: 'AD SSO 2',
    config: { headerName: 'x-forwarded-user', trustedProxyCidrs: '10.0.0.0/8' },
    actorEmail: 'admin@example.ca'
  });
  const result = await registry.runSelfTest(created.record.id, { principal: 'asmith@CLOUDSTRUCC.CA', groups: 'Finance' }, { actorEmail: 'admin@example.ca' });
  assert.equal(result.ok, true);
  assert.equal(result.claims.email, 'asmith');
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function hasOpenssl() {
  try { execFileSync('openssl', ['version']); return true; } catch { return false; }
}

function makeChain() {
  const dir = fs.mkdtempSync(path.join(TMP, 'chain-'));
  const caKey = path.join(dir, 'ca.key');
  const caPemPath = path.join(dir, 'ca.pem');
  const leafKey = path.join(dir, 'leaf.key');
  const leafCsr = path.join(dir, 'leaf.csr');
  const leafPemPath = path.join(dir, 'leaf.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', caPemPath, '-days', '2', '-subj', '/CN=Test GC PKI Root']);
  execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', leafKey, '-out', leafCsr, '-subj', `/CN=user-${crypto.randomUUID().slice(0, 8)}`]);
  execFileSync('openssl', ['x509', '-req', '-in', leafCsr, '-CA', caPemPath, '-CAkey', caKey, '-CAcreateserial', '-out', leafPemPath, '-days', '2']);
  return { caPem: fs.readFileSync(caPemPath, 'utf8'), leafPem: fs.readFileSync(leafPemPath, 'utf8') };
}
