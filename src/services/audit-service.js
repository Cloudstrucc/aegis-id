const crypto = require('node:crypto');
const config = require('../config');
const FileJsonStore = require('./file-json-store');
const chain = require('./evidence-chain');
const { createSigner } = require('../adapters/signing/signer');
const { createAnchor } = require('../adapters/anchor/anchor');

const sensitiveKeys = new Set([
  'accessToken',
  'authorization',
  'clientSecret',
  'credential',
  'idToken',
  'privateKey',
  'rawCredential',
  'token'
]);

function redact(value) {
  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sensitiveKeys.has(key) ? '[redacted]' : redact(child)])
    );
  }

  return value;
}

// Factory so tests (and future multi-store setups) can inject an isolated store,
// signer, and anchor. The default instance below binds to config.
function createAuditService(options = {}) {
  const store = options.store || new FileJsonStore(options.storePath || config.paths.audit, []);
  const chainingEnabled = options.chainingEnabled ?? config.evidenceLedger.chainingEnabled;
  const signer = options.signer || createSigner(config.evidenceLedger);
  const anchor = options.anchor || createAnchor(config.evidenceLedger);
  const anchorIntervalMs = (options.anchorIntervalSeconds ?? config.evidenceLedger.anchorIntervalSeconds) * 1000;

  // Serialize appends so the hash-chain stays strictly linear (single-instance).
  let queue = Promise.resolve();
  let lastAnchorAt = 0;

  function enqueue(task) {
    const run = queue.then(task, task);
    queue = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  async function writeAuditEvent(type, data = {}) {
    return enqueue(async () => {
      const existing = await store.read();
      const core = {
        id: crypto.randomUUID(),
        type,
        data: redact(data),
        createdAt: new Date().toISOString()
      };

      if (!chainingEnabled) {
        await store.write([...existing, core]);
        return core;
      }

      // Migrate any legacy unchained records so the new event extends a valid chain.
      let records = existing;
      if (!chain.isChained(existing)) {
        const flagged = existing.map((record) =>
          typeof record.seq === 'number' ? record : { ...record, migrated: true }
        );
        records = chain.chainAll(flagged);
      }

      const prev = records[records.length - 1] || null;
      const record = chain.buildChainedRecord(prev, core);
      if (signer.enabled) {
        record.sig = await signer.sign(record.hash);
      }

      const all = [...records, record];
      await store.write(all);
      await maybeAnchor(all);
      return record;
    });
  }

  async function maybeAnchor(records) {
    if (!anchor.enabled || records.length === 0) {
      return;
    }
    const now = Date.now();
    if (now - lastAnchorAt < anchorIntervalMs) {
      return;
    }
    lastAnchorAt = now;
    await anchorHead(records[records.length - 1]);
  }

  async function anchorHead(head) {
    return anchor.anchorHead({
      seq: head.seq,
      hash: head.hash,
      sig: head.sig || null,
      at: new Date().toISOString()
    });
  }

  // Force an anchor of the current head regardless of interval (ops / tests).
  async function anchorNow() {
    const records = await store.read();
    if (records.length === 0 || !anchor.enabled) {
      return null;
    }
    return anchorHead(records[records.length - 1]);
  }

  async function listAuditEvents() {
    const events = await store.read();
    return events
      .slice()
      .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0));
  }

  async function verifyAuditChain() {
    const records = await store.read();
    if (records.length === 0) {
      return { ok: true, count: 0 };
    }
    if (!chain.isChained(records)) {
      return { ok: false, reason: 'not-chained', count: 0 };
    }
    return chain.verifyChain(records, signer.enabled ? { verifySignature: (record) => signer.verify(record) } : {});
  }

  return {
    writeAuditEvent,
    listAuditEvents,
    verifyAuditChain,
    anchorNow,
    redact,
    signer,
    anchor
  };
}

const defaultService = createAuditService();

module.exports = {
  writeAuditEvent: (...args) => defaultService.writeAuditEvent(...args),
  listAuditEvents: (...args) => defaultService.listAuditEvents(...args),
  verifyAuditChain: (...args) => defaultService.verifyAuditChain(...args),
  anchorNow: (...args) => defaultService.anchorNow(...args),
  redact,
  createAuditService
};
