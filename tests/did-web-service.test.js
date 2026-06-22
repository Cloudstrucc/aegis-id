const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDidDocument,
  buildDomainLinkageCredentialPayload,
  createDidWebService,
  createDomainLinkageCredentialJwt,
  normalizeEcSignatureToJose
} = require('../src/services/did-web-service');

const didConfig = {
  enabled: true,
  did: 'did:web:vanguard-aegis-id-dev.example.com',
  origin: 'https://vanguard-aegis-id-dev.example.com',
  keyName: 'aegis-did-web-signing',
  keyAlgorithm: 'ES256',
  keyCurve: 'P-256',
  cacheTtlSeconds: 300,
  credentialTtlDays: 30
};

test('buildDidDocument exposes DID:web public key and linked domain service', () => {
  const document = buildDidDocument(didConfig, {
    kty: 'EC',
    crv: 'P-256',
    x: 'test-x-coordinate',
    y: 'test-y-coordinate',
    d: 'private-value-must-not-leak'
  });

  assert.equal(document.id, didConfig.did);
  assert.equal(document.verificationMethod[0].id, `${didConfig.did}#aegis-did-web-signing`);
  assert.equal(document.verificationMethod[0].type, 'JsonWebKey2020');
  assert.equal(document.verificationMethod[0].publicKeyJwk.alg, 'ES256');
  assert.equal(document.verificationMethod[0].publicKeyJwk.use, 'sig');
  assert.equal(document.verificationMethod[0].publicKeyJwk.d, undefined);
  assert.deepEqual(document.assertionMethod, [`${didConfig.did}#aegis-did-web-signing`]);
  assert.deepEqual(document.service[0].serviceEndpoint.origins, [didConfig.origin]);
});

test('domain linkage credential payload follows DIF well-known DID configuration shape', () => {
  const payload = buildDomainLinkageCredentialPayload(didConfig, new Date('2026-06-22T10:00:00.000Z'));

  assert.equal(payload.iss, didConfig.did);
  assert.equal(payload.sub, didConfig.did);
  assert.equal(payload.nbf, 1782122400);
  assert.equal(payload.exp, 1784714400);
  assert.equal(payload.vc.issuer, didConfig.did);
  assert.deepEqual(payload.vc.type, ['VerifiableCredential', 'DomainLinkageCredential']);
  assert.deepEqual(payload.vc.credentialSubject, {
    id: didConfig.did,
    origin: didConfig.origin
  });
});

test('createDomainLinkageCredentialJwt signs compact JWT with DID verification method kid', async () => {
  let signingInput = '';
  const jwt = await createDomainLinkageCredentialJwt(
    didConfig,
    {
      sign: async (input) => {
        signingInput = input;
        return Buffer.alloc(64, 7);
      }
    },
    new Date('2026-06-22T10:00:00.000Z')
  );

  const [encodedHeader, encodedPayload, encodedSignature] = jwt.split('.');
  const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));

  assert.equal(jwt.split('.').length, 3);
  assert.equal(signingInput, `${encodedHeader}.${encodedPayload}`);
  assert.deepEqual(header, {
    alg: 'ES256',
    kid: `${didConfig.did}#aegis-did-web-signing`
  });
  assert.equal(payload.vc.credentialSubject.origin, didConfig.origin);
  assert.equal(Buffer.from(encodedSignature, 'base64url').length, 64);
});

test('createDidWebService caches generated did document and configuration', async () => {
  let publicKeyReads = 0;
  let signatures = 0;
  const service = createDidWebService({
    config: didConfig,
    now: () => new Date('2026-06-22T10:00:00.000Z'),
    keyProvider: {
      getPublicJwk: async () => {
        publicKeyReads += 1;
        return {
          kty: 'EC',
          crv: 'P-256',
          x: 'x',
          y: 'y'
        };
      },
      sign: async () => {
        signatures += 1;
        return Buffer.alloc(64, 9);
      }
    }
  });

  await service.getDidDocument();
  await service.getDidDocument();
  await service.getDidConfiguration();
  await service.getDidConfiguration();

  assert.equal(publicKeyReads, 1);
  assert.equal(signatures, 1);
});

test('normalizeEcSignatureToJose converts DER encoded ES256 signatures to JOSE R/S bytes', () => {
  const r = Buffer.from('00a'.padStart(66, '1'), 'hex');
  const s = Buffer.from('00b'.padStart(66, '2'), 'hex');
  const der = Buffer.concat([
    Buffer.from([0x30, 0x46, 0x02, 0x21]),
    r,
    Buffer.from([0x02, 0x21]),
    s
  ]);

  const jose = normalizeEcSignatureToJose(der);
  assert.equal(jose.length, 64);
  assert.equal(jose.subarray(0, 1).toString('hex'), '11');
  assert.equal(jose.subarray(32, 33).toString('hex'), '22');
});
