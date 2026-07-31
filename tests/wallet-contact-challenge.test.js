const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Phase 6: the holder's global wallet contact is what email/SMS-bound invites
// match on, so changing it must require an approved in-wallet challenge.

const MODULES = [
  '../src/config',
  '../src/services/wallet-registry-service',
  '../src/services/wallet-contact-service',
  '../src/services/audit-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withContact(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-contact-'));
  const previous = { ...process.env };
  process.env.WALLET_STORE_PATH = path.join(dir, 'wallets.json');
  process.env.WALLET_CONTACT_CHALLENGE_STORE_PATH = path.join(dir, 'contact.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit-events.json');
  resetModules();
  try {
    await run({
      registry: require('../src/services/wallet-registry-service'),
      contact: require('../src/services/wallet-contact-service'),
      audit: require('../src/services/audit-service')
    });
  } finally {
    process.env = previous;
    resetModules();
  }
}

test('an approved challenge applies the new email', async () => {
  await withContact(async ({ registry, contact }) => {
    const wallet = await registry.registerWallet({ email: 'old@example.com', devicePublicKey: 'k1' });

    const challenge = await contact.startContactChange(wallet.walletId, {
      field: 'email',
      value: 'New@Example.com'
    });
    assert.equal(challenge.status, 'pending');
    assert.equal(challenge.value, undefined, 'the pending value must not be echoed back');

    await contact.resolveContactChange(challenge.id, { decision: 'approve' });

    const updated = await registry.getWalletByWalletId(wallet.walletId);
    assert.equal(updated.email, 'new@example.com');
  });
});

test('a pending challenge does not mutate the wallet', async () => {
  await withContact(async ({ registry, contact }) => {
    const wallet = await registry.registerWallet({ email: 'stay@example.com', devicePublicKey: 'k2' });
    await contact.startContactChange(wallet.walletId, { field: 'email', value: 'pending@example.com' });

    const unchanged = await registry.getWalletByWalletId(wallet.walletId);
    assert.equal(unchanged.email, 'stay@example.com');
  });
});

test('a declined challenge does not mutate the wallet', async () => {
  await withContact(async ({ registry, contact }) => {
    const wallet = await registry.registerWallet({ email: 'keep@example.com', devicePublicKey: 'k3' });
    const challenge = await contact.startContactChange(wallet.walletId, {
      field: 'email',
      value: 'nope@example.com'
    });

    const resolved = await contact.resolveContactChange(challenge.id, { decision: 'decline' });
    assert.equal(resolved.status, 'declined');

    const unchanged = await registry.getWalletByWalletId(wallet.walletId);
    assert.equal(unchanged.email, 'keep@example.com');
  });
});

test('a challenge cannot be resolved twice', async () => {
  await withContact(async ({ registry, contact }) => {
    const wallet = await registry.registerWallet({ email: 'once@example.com', devicePublicKey: 'k4' });
    const challenge = await contact.startContactChange(wallet.walletId, {
      field: 'phone',
      value: '613-555-0177'
    });

    await contact.resolveContactChange(challenge.id, { decision: 'approve' });
    await assert.rejects(
      () => contact.resolveContactChange(challenge.id, { decision: 'approve' }),
      (error) => error.status === 409
    );
  });
});

test('an expired challenge is refused and does not mutate', async () => {
  await withContact(async ({ registry, contact }) => {
    const wallet = await registry.registerWallet({ email: 'exp@example.com', devicePublicKey: 'k5' });
    const challenge = await contact.startContactChange(wallet.walletId, {
      field: 'email',
      value: 'late@example.com'
    });

    // Force expiry on disk.
    const storePath = process.env.WALLET_CONTACT_CHALLENGE_STORE_PATH;
    const records = JSON.parse(await fs.readFile(storePath, 'utf8'));
    records[0].expiresAt = new Date(Date.now() - 1000).toISOString();
    await fs.writeFile(storePath, JSON.stringify(records, null, 2));

    await assert.rejects(
      () => contact.resolveContactChange(challenge.id, { decision: 'approve' }),
      (error) => /expired/i.test(error.message)
    );

    const unchanged = await registry.getWalletByWalletId(wallet.walletId);
    assert.equal(unchanged.email, 'exp@example.com');
  });
});

test('changing to an address already bound to another wallet is rejected', async () => {
  await withContact(async ({ registry, contact }) => {
    const first = await registry.registerWallet({ email: 'a@example.com', devicePublicKey: 'k6' });
    await registry.registerWallet({ email: 'b@example.com', devicePublicKey: 'k7' });

    const challenge = await contact.startContactChange(first.walletId, {
      field: 'email',
      value: 'b@example.com'
    });

    await assert.rejects(
      () => contact.resolveContactChange(challenge.id, { decision: 'approve' }),
      (error) => error.status === 400
    );
  });
});

test('contact changes write chained evidence', async () => {
  await withContact(async ({ registry, contact, audit }) => {
    const wallet = await registry.registerWallet({ email: 'ev@example.com', devicePublicKey: 'k8' });
    const challenge = await contact.startContactChange(wallet.walletId, {
      field: 'email',
      value: 'ev2@example.com'
    });
    await contact.resolveContactChange(challenge.id, { decision: 'approve' });

    const types = (await audit.listAuditEvents()).map((event) => event.type);
    assert.ok(types.includes('wallet.contact.change.requested'));
    assert.ok(types.includes('wallet.contact.changed'));
    assert.equal((await audit.verifyAuditChain()).ok, true);
  });
});
