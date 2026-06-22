const crypto = require('node:crypto');
const {
  AzureCliCredential,
  AzureDeveloperCliCredential,
  ChainedTokenCredential,
  ManagedIdentityCredential
} = require('@azure/identity');
const { CryptographyClient, KeyClient } = require('@azure/keyvault-keys');
const config = require('../config');

const DID_CONTEXT = 'https://www.w3.org/ns/did/v1';
const JWS_CONTEXT = 'https://w3id.org/security/suites/jws-2020/v1';
const VC_CONTEXT = 'https://www.w3.org/2018/credentials/v1';
const DID_CONFIGURATION_CONTEXT = 'https://identity.foundation/.well-known/did-configuration/v1';

function createDidWebService(options = {}) {
  const didConfig = options.config || config.didWeb;
  const keyProvider = options.keyProvider || createKeyVaultKeyProvider(didConfig);
  const now = options.now || (() => new Date());
  const cache = new Map();

  function isEnabled() {
    return Boolean(didConfig.enabled);
  }

  async function getDidDocument() {
    ensureEnabled(didConfig);
    return getCached(cache, 'did-document', didConfig.cacheTtlSeconds, async () =>
      buildDidDocument(didConfig, await keyProvider.getPublicJwk())
    );
  }

  async function getDidConfiguration() {
    ensureEnabled(didConfig);
    return getCached(cache, 'did-configuration', didConfig.cacheTtlSeconds, async () => {
      const linkedDid = await createDomainLinkageCredentialJwt(didConfig, keyProvider, now());
      return {
        '@context': DID_CONFIGURATION_CONTEXT,
        linked_dids: [linkedDid]
      };
    });
  }

  return {
    isEnabled,
    getDidDocument,
    getDidConfiguration
  };
}

function createKeyVaultKeyProvider(didConfig) {
  return {
    async getPublicJwk() {
      try {
        const key = await getKeyVaultKey(didConfig);
        return publicJwkFromAzureKey(key.key, didConfig);
      } catch (error) {
        throw didWebKeyVaultError(error);
      }
    },
    async sign(signingInput) {
      try {
        const cryptoClient = await getCryptographyClient(didConfig);
        const digest = crypto.createHash('sha256').update(signingInput).digest();
        const result = await cryptoClient.sign(didConfig.keyAlgorithm || 'ES256', digest);
        return normalizeEcSignatureToJose(Buffer.from(result.result));
      } catch (error) {
        throw didWebKeyVaultError(error);
      }
    }
  };
}

let keyVaultClientCache;
let cryptographyClientCache;
let keyVaultCredentialCache;

async function getKeyVaultKey(didConfig) {
  if (!didConfig.keyVaultUrl && !didConfig.keyVaultKeyId) {
    throw httpError(503, 'DID:web Key Vault settings are not configured.');
  }

  const credential = getKeyVaultCredential();

  if (didConfig.keyVaultUrl) {
    if (!keyVaultClientCache) {
      keyVaultClientCache = new KeyClient(didConfig.keyVaultUrl, credential);
    }
    return keyVaultClientCache.getKey(didConfig.keyName);
  }

  const parsed = parseKeyVaultKeyId(didConfig.keyVaultKeyId);
  const keyClient = new KeyClient(parsed.vaultUrl, credential);
  return keyClient.getKey(parsed.keyName, parsed.version ? { version: parsed.version } : undefined);
}

async function getCryptographyClient(didConfig) {
  if (!didConfig.keyVaultKeyId) {
    throw httpError(503, 'DID:web Key Vault key ID is not configured.');
  }

  if (!cryptographyClientCache) {
    cryptographyClientCache = new CryptographyClient(didConfig.keyVaultKeyId, getKeyVaultCredential());
  }
  return cryptographyClientCache;
}

function getKeyVaultCredential() {
  if (!keyVaultCredentialCache) {
    keyVaultCredentialCache = new ChainedTokenCredential(
      new ManagedIdentityCredential(),
      new AzureCliCredential(),
      new AzureDeveloperCliCredential()
    );
  }
  return keyVaultCredentialCache;
}

function buildDidDocument(didConfig, publicJwk) {
  ensureRequiredConfig(didConfig);
  const verificationMethodId = verificationMethodIdFor(didConfig);

  return {
    '@context': [DID_CONTEXT, JWS_CONTEXT],
    id: didConfig.did,
    verificationMethod: [
      {
        id: verificationMethodId,
        type: 'JsonWebKey2020',
        controller: didConfig.did,
        publicKeyJwk: stripPrivateJwkFields({
          ...publicJwk,
          alg: didConfig.keyAlgorithm || 'ES256',
          use: 'sig'
        })
      }
    ],
    authentication: [verificationMethodId],
    assertionMethod: [verificationMethodId],
    service: [
      {
        id: `${didConfig.did}#linkeddomains`,
        type: 'LinkedDomains',
        serviceEndpoint: {
          origins: [didConfig.origin]
        }
      }
    ]
  };
}

async function createDomainLinkageCredentialJwt(didConfig, keyProvider, issuedAt = new Date()) {
  ensureRequiredConfig(didConfig);

  const header = {
    alg: didConfig.keyAlgorithm || 'ES256',
    kid: verificationMethodIdFor(didConfig)
  };
  const payload = buildDomainLinkageCredentialPayload(didConfig, issuedAt);
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = await keyProvider.sign(signingInput);

  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`;
}

function buildDomainLinkageCredentialPayload(didConfig, issuedAt = new Date()) {
  const nbf = Math.floor(issuedAt.getTime() / 1000);
  const exp = nbf + Math.max(1, didConfig.credentialTtlDays || 365) * 24 * 60 * 60;
  const issuanceDate = new Date(nbf * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const expirationDate = new Date(exp * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

  return {
    iss: didConfig.did,
    sub: didConfig.did,
    nbf,
    exp,
    vc: {
      '@context': [VC_CONTEXT, DID_CONFIGURATION_CONTEXT],
      type: ['VerifiableCredential', 'DomainLinkageCredential'],
      issuer: didConfig.did,
      issuanceDate,
      expirationDate,
      credentialSubject: {
        id: didConfig.did,
        origin: didConfig.origin
      }
    }
  };
}

function publicJwkFromAzureKey(key, didConfig) {
  if (!key?.x || !key?.y) {
    throw httpError(503, 'DID:web Key Vault key is missing an EC public key.');
  }

  return {
    kty: 'EC',
    crv: azureCurveToJwkCurve(key.crv || didConfig.keyCurve),
    x: toBase64Url(key.x),
    y: toBase64Url(key.y)
  };
}

function azureCurveToJwkCurve(curve) {
  const normalized = String(curve || '').toUpperCase();
  if (normalized === 'P-256' || normalized === 'P_256') {
    return 'P-256';
  }
  return curve || 'P-256';
}

function stripPrivateJwkFields(jwk) {
  const { d, p, q, dp, dq, qi, oth, key_ops: keyOps, ...publicJwk } = jwk;
  return publicJwk;
}

function toBase64Url(value) {
  if (typeof value === 'string') {
    return value;
  }
  return Buffer.from(value).toString('base64url');
}

function normalizeEcSignatureToJose(signature) {
  if (signature.length === 64) {
    return signature;
  }

  if (signature[0] !== 0x30) {
    return signature;
  }

  return derToJoseSignature(signature);
}

function derToJoseSignature(signature) {
  let offset = 2;
  if (signature[1] & 0x80) {
    offset = 2 + (signature[1] & 0x7f);
  }

  const r = readDerInteger(signature, offset);
  const s = readDerInteger(signature, r.nextOffset);
  return Buffer.concat([leftPadTo32(r.value), leftPadTo32(s.value)]);
}

function readDerInteger(signature, offset) {
  if (signature[offset] !== 0x02) {
    throw new Error('Invalid DER ECDSA signature.');
  }

  const length = signature[offset + 1];
  const start = offset + 2;
  const end = start + length;
  let value = signature.subarray(start, end);

  while (value.length > 32 && value[0] === 0x00) {
    value = value.subarray(1);
  }

  return {
    value,
    nextOffset: end
  };
}

function leftPadTo32(value) {
  if (value.length === 32) {
    return value;
  }
  if (value.length > 32) {
    return value.subarray(value.length - 32);
  }
  return Buffer.concat([Buffer.alloc(32 - value.length, 0), value]);
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function verificationMethodIdFor(didConfig) {
  return `${didConfig.did}#${didConfig.keyName || 'aegis-did-web-signing'}`;
}

function ensureEnabled(didConfig) {
  if (!didConfig.enabled) {
    throw httpError(404, 'DID:web is not enabled for this environment.', true);
  }
}

function ensureRequiredConfig(didConfig) {
  const missing = [];
  for (const key of ['did', 'origin', 'keyName', 'keyAlgorithm']) {
    if (!didConfig[key]) {
      missing.push(key);
    }
  }

  if (missing.length) {
    throw httpError(503, `DID:web is missing required settings: ${missing.join(', ')}.`);
  }
}

function getCached(cache, key, ttlSeconds, factory) {
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = Promise.resolve(factory()).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, {
    value,
    expiresAt: now + Math.max(1, ttlSeconds || 300) * 1000
  });
  return value;
}

function parseKeyVaultKeyId(keyId) {
  const url = new URL(keyId);
  const segments = url.pathname.split('/').filter(Boolean);
  const keyIndex = segments.indexOf('keys');
  if (keyIndex === -1 || !segments[keyIndex + 1]) {
    throw httpError(503, 'DID:web Key Vault key ID is invalid.');
  }

  return {
    vaultUrl: `${url.protocol}//${url.host}`,
    keyName: segments[keyIndex + 1],
    version: segments[keyIndex + 2] || ''
  };
}

function httpError(status, message, expose = true) {
  const error = new Error(message);
  error.status = status;
  error.expose = expose;
  return error;
}

function didWebKeyVaultError(error) {
  if (error?.status || error?.statusCode || error?.code) {
    return httpError(503, 'DID:web Key Vault signing key is not reachable by this app identity.');
  }
  return error;
}

module.exports = {
  DID_CONFIGURATION_CONTEXT,
  buildDidDocument,
  buildDomainLinkageCredentialPayload,
  createDidWebService,
  createDomainLinkageCredentialJwt,
  normalizeEcSignatureToJose,
  publicJwkFromAzureKey
};
