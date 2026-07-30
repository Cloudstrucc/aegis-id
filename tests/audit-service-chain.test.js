const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createAuditService } = require('../src/services/audit-service');
const { createSigner } = require('../src/adapters/signing/signer');
const { createAnchor } = require('../src/adapters/anchor/anchor');

async function tempWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-audit-'));
  return {
    dir,
    storePath: path.join(dir, 'audit-events.json'),
    keyPath: path.join(dir, 'audit-key.json'),
    anchorDir: path.join(dir, 'audit-heads')
  };
}

function buildService(ws, { signing = true } = {}) {
  return createAuditService({
    storePath: ws.storePath,
    chainingEnabled: true,
    anchorIntervalSeconds: 3600,
    signer: createSigner({ signingEnabled: signing, signingMode: 'local', signingKeyPath: ws.keyPath }),
    anchor: createAnchor({ anchorMode: 'local-file', anchorDir: ws.anchorDir })
  });
}

test('writeAuditEvent chains, signs, and verifies', async () => {
  const ws = await tempWorkspace();
  const audit = buildService(ws);

  await audit.writeAuditEvent('wallet.challenge.approved', { challengeId: 'c1' });
  await audit.writeAuditEvent('document.signed', { docId: 'd1' });
  await audit.writeAuditEvent('access.revoked', { subject: 's1' });

  const records = JSON.parse(await fs.readFile(ws.storePath, 'utf8'));
  assert.deepEqual(records.map((r) => r.seq), [0, 1, 2]);
  assert.ok(records.every((r) => r.sig && r.sig.alg === 'EdDSA'));

  assert.deepEqual(await audit.verifyAuditChain(), { ok: true, count: 3 });
});

test('secrets are redacted before hashing', async () => {
  const ws = await tempWorkspace();
  const audit = buildService(ws, { signing: false });
  await audit.writeAuditEvent('token.issued', { token: 'super-secret', ok: true });
  const [record] = JSON.parse(await fs.readFile(ws.storePath, 'utf8'));
  assert.equal(record.data.token, '[redacted]');
  assert.equal(record.data.ok, true);
});

test('verifyAuditChain detects a tampered record on disk', async () => {
  const ws = await tempWorkspace();
  const audit = buildService(ws, { signing: false });
  await audit.writeAuditEvent('a', { n: 1 });
  await audit.writeAuditEvent('b', { n: 2 });
  await audit.writeAuditEvent('c', { n: 3 });

  const records = JSON.parse(await fs.readFile(ws.storePath, 'utf8'));
  records[1].data = { n: 2, injected: 'evil' };
  await fs.writeFile(ws.storePath, JSON.stringify(records, null, 2));

  const result = await audit.verifyAuditChain();
  assert.equal(result.ok, false);
  assert.equal(result.brokenAtSeq, 1);
  assert.equal(result.reason, 'payload-tampered');
});

test('verifyAuditChain detects a forged signature', async () => {
  const ws = await tempWorkspace();
  const audit = buildService(ws);
  await audit.writeAuditEvent('a', { n: 1 });
  await audit.writeAuditEvent('b', { n: 2 });

  const records = JSON.parse(await fs.readFile(ws.storePath, 'utf8'));
  // Corrupt the signature value while leaving the hash intact.
  records[1].sig.value = Buffer.from('not-a-valid-signature').toString('base64');
  await fs.writeFile(ws.storePath, JSON.stringify(records, null, 2));

  const result = await audit.verifyAuditChain();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'signature-invalid');
});

test('anchorNow writes a write-once head digest', async () => {
  const ws = await tempWorkspace();
  const audit = buildService(ws);
  await audit.writeAuditEvent('a', { n: 1 });

  const anchor = await audit.anchorNow();
  assert.equal(anchor.target, 'local-file');
  const heads = (await fs.readdir(ws.anchorDir)).sort();
  assert.ok(heads.length >= 1, 'at least one anchored head digest exists');
  const head = JSON.parse(await fs.readFile(path.join(ws.anchorDir, heads.at(-1)), 'utf8'));
  assert.equal(head.seq, 0);
  assert.ok(head.hash);
});

test('legacy unchained records are migrated into the chain', async () => {
  const ws = await tempWorkspace();
  // Seed a pre-Feature-A store: plain events with no seq/hash.
  await fs.mkdir(path.dirname(ws.storePath), { recursive: true });
  await fs.writeFile(
    ws.storePath,
    JSON.stringify([
      { id: 'legacy-1', type: 'old.event', data: { n: 1 }, createdAt: '2026-07-01T00:00:00.000Z' },
      { id: 'legacy-2', type: 'old.event', data: { n: 2 }, createdAt: '2026-07-02T00:00:00.000Z' }
    ])
  );

  const audit = buildService(ws, { signing: false });
  await audit.writeAuditEvent('new.event', { n: 3 });

  const records = JSON.parse(await fs.readFile(ws.storePath, 'utf8'));
  assert.deepEqual(records.map((r) => r.seq), [0, 1, 2]);
  assert.equal(records[0].migrated, true);
  assert.equal(records[1].migrated, true);
  assert.equal(records[2].migrated, undefined);
  assert.deepEqual(await audit.verifyAuditChain(), { ok: true, count: 3 });
});
