const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Removing a wallet from service.
//
// The distinction that matters: revoking keeps the record and its evidence
// trail while stopping the wallet working, and deleting is only ever allowed
// for a wallet that never held a credential. A wallet with history must not be
// deletable, because that history is what an incident is reconstructed from.

const MODULES = [
  '../src/config',
  '../src/services/wallet-registry-service',
  '../src/services/audit-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-wallet-admin-'));
  const previous = { ...process.env };
  process.env.WALLET_STORE_PATH = path.join(dir, 'wallets.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  resetModules();
  try {
    await run({ dir, registry: require('../src/services/wallet-registry-service') });
  } finally {
    process.env = previous;
    resetModules();
  }
}

async function seedWallet(registry, email = 'holder@example.com') {
  return registry.registerWallet({
    email,
    phone: '',
    devicePublicKey: `device-${email}`
  });
}

test('a revoked wallet can no longer accept a credential', async () => {
  await withEnv(async ({ registry }) => {
    const wallet = await seedWallet(registry);
    const credential = { bindingMode: 'wallet-id', walletId: wallet.walletId };

    // Works before revoking.
    await registry.assertBinding(credential, wallet.walletId);

    await registry.revokeWallet(wallet.walletId, {
      actorEmail: 'admin@example.com',
      reason: 'Device reported stolen'
    });

    // Enforced in assertBinding, which every acceptance goes through — not
    // only hidden in the UI.
    await assert.rejects(
      () => registry.assertBinding(credential, wallet.walletId),
      /withdrawn from service/
    );
  });
});

test('restoring puts it back into service', async () => {
  await withEnv(async ({ registry }) => {
    const wallet = await seedWallet(registry);
    const credential = { bindingMode: 'wallet-id', walletId: wallet.walletId };

    await registry.revokeWallet(wallet.walletId, { actorEmail: 'admin@example.com', reason: 'x' });
    await registry.restoreWallet(wallet.walletId, { actorEmail: 'admin@example.com' });

    await registry.assertBinding(credential, wallet.walletId);
    const restored = await registry.getWalletByWalletId(wallet.walletId);
    assert.equal(restored.status, 'active');
    assert.equal(restored.revokedReason, '');
  });
});

test('revoking twice is harmless', async () => {
  await withEnv(async ({ registry }) => {
    const wallet = await seedWallet(registry);
    await registry.revokeWallet(wallet.walletId, { actorEmail: 'a@example.com', reason: 'first' });
    const again = await registry.revokeWallet(wallet.walletId, { actorEmail: 'b@example.com', reason: 'second' });

    // The first revocation is the one on the record; a repeat does not rewrite
    // who withdrew it or why.
    assert.equal(again.revokedBy, 'a@example.com');
    assert.equal(again.revokedReason, 'first');
  });
});

test('an unused wallet can be deleted', async () => {
  await withEnv(async ({ registry }) => {
    const wallet = await seedWallet(registry);

    await registry.deleteWallet(wallet.walletId, {
      actorEmail: 'admin@example.com',
      reason: 'Test wallet',
      usageCount: 0
    });

    assert.equal(await registry.getWalletByWalletId(wallet.walletId), null);
    assert.equal((await registry.listWallets()).length, 0);
  });
});

test('a wallet holding credentials cannot be deleted', async () => {
  await withEnv(async ({ registry }) => {
    const wallet = await seedWallet(registry);

    await assert.rejects(
      () => registry.deleteWallet(wallet.walletId, { actorEmail: 'admin@example.com', usageCount: 3 }),
      /cannot be deleted/
    );

    // Still there, so the history it carries is still there.
    assert.ok(await registry.getWalletByWalletId(wallet.walletId));
  });
});

test('an unknown wallet is refused rather than silently ignored', async () => {
  await withEnv(async ({ registry }) => {
    await assert.rejects(() => registry.revokeWallet('AEG-0000-0000-0000-0000', {}), /not found/);
    await assert.rejects(() => registry.deleteWallet('AEG-0000-0000-0000-0000', {}), /not found/);
    await assert.rejects(() => registry.restoreWallet('AEG-0000-0000-0000-0000', {}), /not found/);
  });
});

test('who did it and why is on the evidence chain', async () => {
  await withEnv(async ({ registry }) => {
    const { verifyAuditChain } = require('../src/services/audit-service');
    const kept = await seedWallet(registry, 'kept@example.com');
    const removed = await seedWallet(registry, 'removed@example.com');

    await registry.revokeWallet(kept.walletId, {
      actorEmail: 'admin@example.com',
      reason: 'Device reported stolen'
    });
    await registry.deleteWallet(removed.walletId, {
      actorEmail: 'admin@example.com',
      reason: 'Test wallet from a laptop run',
      usageCount: 0
    });

    const events = JSON.parse(await fs.readFile(process.env.AUDIT_STORE_PATH, 'utf8'));
    const revoked = events.find((entry) => entry.type === 'wallet.revoked');
    const deleted = events.find((entry) => entry.type === 'wallet.deleted');

    assert.equal(revoked.data.revokedBy, 'admin@example.com');
    assert.equal(revoked.data.reason, 'Device reported stolen');
    // Deleting erases the wallet, so the audit entry is the only remaining
    // record that it ever existed.
    assert.equal(deleted.data.walletId, removed.walletId);
    assert.equal(deleted.data.email, 'removed@example.com');
    assert.equal(deleted.data.deletedBy, 'admin@example.com');

    const chain = await verifyAuditChain();
    assert.equal(chain.ok, true);
  });
});
