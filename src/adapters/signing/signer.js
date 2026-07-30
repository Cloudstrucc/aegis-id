// Audit-ledger signer abstraction.
//
//   mode "none"      → signing disabled (chain integrity only)
//   mode "local"     → dev Ed25519 key on disk (data/keys), for local testing
//   mode "keyvault"  → Azure Key Vault (production; interface stub here)
//
// The signer signs a record's `hash` (the chain head fingerprint), giving
// non-repudiation on top of the hash-chain's tamper-evidence.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createSigner(cfg = {}) {
  if (!cfg.signingEnabled) {
    return {
      enabled: false,
      mode: 'none',
      keyId: null,
      sign() {
        return null;
      },
      verify() {
        return true;
      }
    };
  }

  const mode = cfg.signingMode || 'local';
  if (mode === 'local') {
    return createLocalSigner(cfg);
  }
  if (mode === 'keyvault') {
    return createKeyVaultSigner(cfg);
  }
  throw new Error(`Unknown audit signing mode: ${mode}`);
}

function createLocalSigner(cfg) {
  const keyPath = cfg.signingKeyPath || path.join(process.cwd(), 'data', 'keys', 'audit-signing-dev.json');
  const material = loadOrCreateKey(keyPath);
  const privateKey = crypto.createPrivateKey(material.privateKeyPem);
  const publicKey = crypto.createPublicKey(material.publicKeyPem);
  const keyId = `local-dev:${crypto.createHash('sha256').update(material.publicKeyPem).digest('hex').slice(0, 16)}`;

  return {
    enabled: true,
    mode: 'local',
    keyId,
    publicKeyPem: material.publicKeyPem,
    sign(hash) {
      // Ed25519 uses a null algorithm identifier in Node's crypto.sign.
      const value = crypto.sign(null, Buffer.from(String(hash)), privateKey).toString('base64');
      return { alg: 'EdDSA', keyId, value };
    },
    verify(record) {
      if (!record || !record.sig || !record.sig.value) {
        return false;
      }
      try {
        return crypto.verify(null, Buffer.from(String(record.hash)), publicKey, Buffer.from(record.sig.value, 'base64'));
      } catch {
        return false;
      }
    }
  };
}

function loadOrCreateKey(keyPath) {
  try {
    return JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const material = {
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' })
    };
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, JSON.stringify(material, null, 2), { mode: 0o600 });
    return material;
  }
}

// Production interface stub. Wiring this to Azure Key Vault (sign/verify with a
// managed key) is a Phase-1 production task; it is intentionally not exercised
// locally so tests never require Azure credentials.
function createKeyVaultSigner(cfg) {
  return {
    enabled: true,
    mode: 'keyvault',
    keyId: cfg.signingKeyVaultKeyId || 'keyvault',
    async sign() {
      throw new Error('Key Vault audit signer is not wired for local use. Set AUDIT_SIGNING_MODE=local for local testing.');
    },
    verify() {
      return false;
    }
  };
}

module.exports = { createSigner };
