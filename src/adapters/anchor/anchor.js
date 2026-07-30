// Audit-ledger anchor abstraction — periodically writes the signed chain HEAD
// to write-once (WORM) storage so that even an attacker who steals the signing
// key cannot silently rewrite-and-resign the whole chain: the older head remains.
//
//   mode "none"        → no anchoring
//   mode "local-file"  → append-only files under data/audit-heads (local testing)
//   mode "azure-blob"  → Azure immutable Blob (production; interface stub here)

const fs = require('node:fs/promises');
const path = require('node:path');

function createAnchor(cfg = {}) {
  const mode = cfg.anchorMode || 'none';
  if (mode === 'none') {
    return {
      enabled: false,
      mode,
      async anchorHead() {
        return null;
      }
    };
  }
  if (mode === 'local-file') {
    return createLocalFileAnchor(cfg);
  }
  if (mode === 'azure-blob') {
    return createAzureBlobAnchor(cfg);
  }
  throw new Error(`Unknown audit anchor mode: ${mode}`);
}

function createLocalFileAnchor(cfg) {
  const dir = cfg.anchorDir || path.join(process.cwd(), 'data', 'audit-heads');
  return {
    enabled: true,
    mode: 'local-file',
    async anchorHead(head) {
      await fs.mkdir(dir, { recursive: true });
      const safeStamp = String(head.at).replace(/[:.]/g, '-');
      const ref = path.join(dir, `${safeStamp}-seq${head.seq}.json`);
      try {
        // write-once: never overwrite an existing anchor (wx flag).
        await fs.writeFile(ref, `${JSON.stringify(head, null, 2)}\n`, { flag: 'wx' });
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      }
      return { target: 'local-file', ref };
    }
  };
}

// Production interface stub. Wiring this to an Azure Blob container that has an
// immutability (WORM) policy is a Phase-2 production task; not exercised locally.
function createAzureBlobAnchor(cfg) {
  return {
    enabled: true,
    mode: 'azure-blob',
    container: cfg.anchorContainer || '',
    async anchorHead() {
      throw new Error('Azure Blob anchor is not wired for local use. Set AUDIT_ANCHOR_MODE=local-file for local testing.');
    }
  };
}

module.exports = { createAnchor };
