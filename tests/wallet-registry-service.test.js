const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MODULES = ['../src/config', '../src/services/wallet-registry-service'];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withRegistry(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-wallet-registry-'));
  const previous = { ...process.env };
  process.env.WALLET_STORE_PATH = path.join(dir, 'wallets.json');
  resetModules();
  try {
    await run(require('../src/services/wallet-registry-service'));
  } finally {
    process.env = previous;
    resetModules();
  }
}

const device = (suffix) => `device-public-key-${suffix}`;

test('registerWallet mints a Wallet ID and persists the record', async () => {
  await withRegistry(async (registry) => {
    const wallet = await registry.registerWallet({
      email: 'Holder@Example.com',
      phone: '613-555-0100',
      devicePublicKey: device('a')
    });

    assert.match(wallet.walletId, /^AEG-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    assert.equal(wallet.email, 'holder@example.com', 'email normalized to lowercase');
    assert.equal(wallet.phone, '+16135550100', 'phone normalized to E.164');
    assert.equal(wallet.status, 'active');
  });
});

test('re-registering the same device is idempotent', async () => {
  await withRegistry(async (registry) => {
    const first = await registry.registerWallet({ email: 'a@example.com', devicePublicKey: device('same') });
    const second = await registry.registerWallet({ email: 'a@example.com', devicePublicKey: device('same') });
    assert.equal(first.walletId, second.walletId);
    assert.equal((await registry.listWallets()).length, 1);
  });
});

test('email is required and duplicates are rejected', async () => {
  await withRegistry(async (registry) => {
    await assert.rejects(() => registry.registerWallet({ devicePublicKey: device('x') }), (e) => e.status === 400);
    await registry.registerWallet({ email: 'dup@example.com', devicePublicKey: device('1') });
    await assert.rejects(
      () => registry.registerWallet({ email: 'dup@example.com', devicePublicKey: device('2') }),
      (e) => e.status === 400
    );
  });
});

test('lookup works by wallet ID, email, and phone with normalization', async () => {
  await withRegistry(async (registry) => {
    const wallet = await registry.registerWallet({
      email: 'lookup@example.com',
      phone: '+1 (613) 555-0199',
      devicePublicKey: device('lookup')
    });

    assert.equal((await registry.getWalletByWalletId(wallet.walletId)).id, wallet.id);
    // case- and dash-insensitive Wallet ID lookup
    assert.equal((await registry.getWalletByWalletId(wallet.walletId.toLowerCase())).id, wallet.id);
    assert.equal((await registry.getWalletByEmail('LOOKUP@EXAMPLE.COM')).id, wallet.id);
    // 613-555-0199 and +16135550199 must resolve to the same wallet
    assert.equal((await registry.getWalletByPhone('613-555-0199')).id, wallet.id);
    assert.equal(await registry.getWalletByEmail('nobody@example.com'), null);
    assert.equal(await registry.getWalletByWalletId('AEG-0000-0000-0000-0000'), null);
  });
});

// ---------------------------------------------------------------------------
// Binding modes (plan §3.2)
// ---------------------------------------------------------------------------

test('MODE 1 — Wallet ID binding accepts a credential whose email differs from the wallet email', async () => {
  await withRegistry(async (registry) => {
    const wallet = await registry.registerWallet({
      email: 'personal@example.com',
      devicePublicKey: device('multi-org')
    });

    // The multi-org case: this org knows the holder by a different address.
    const credential = { walletId: wallet.walletId, holderEmail: 'contractor@agency.gc.ca' };
    const result = await registry.assertBinding(credential, wallet.walletId);

    assert.equal(result.mode, 'wallet-id');
    assert.equal(result.wallet.walletId, wallet.walletId);
  });
});

test('MODE 1 — a different wallet is rejected', async () => {
  await withRegistry(async (registry) => {
    const owner = await registry.registerWallet({ email: 'owner@example.com', devicePublicKey: device('owner') });
    const other = await registry.registerWallet({ email: 'other@example.com', devicePublicKey: device('other') });

    await assert.rejects(
      () => registry.assertBinding({ walletId: owner.walletId }, other.walletId),
      (error) => /different wallet/i.test(error.message)
    );
  });
});

test('MODE 2 — email binding requires the invite email to be a registered wallet email', async () => {
  await withRegistry(async (registry) => {
    const wallet = await registry.registerWallet({ email: 'staff@example.com', devicePublicKey: device('email') });

    const bound = await registry.assertBinding({ holderEmail: 'staff@example.com' }, wallet.walletId);
    assert.equal(bound.mode, 'email');

    // A free-text address that belongs to no wallet must not bind.
    await assert.rejects(
      () => registry.assertBinding({ holderEmail: 'stranger@example.com' }, wallet.walletId),
      (error) => /not addressed to a registered wallet contact/i.test(error.message)
    );
  });
});

test('MODE 3 — phone binding requires the invite phone to be a registered wallet phone', async () => {
  await withRegistry(async (registry) => {
    const wallet = await registry.registerWallet({
      email: 'sms@example.com',
      phone: '613-555-0123',
      devicePublicKey: device('phone')
    });

    const bound = await registry.assertBinding({ holderPhone: '+16135550123' }, wallet.walletId);
    assert.equal(bound.mode, 'phone');

    await assert.rejects(
      () => registry.assertBinding({ holderPhone: '613-555-9999' }, wallet.walletId),
      (error) => /not addressed to a registered wallet contact/i.test(error.message)
    );
  });
});

test('an unregistered or malformed Wallet ID cannot accept anything', async () => {
  await withRegistry(async (registry) => {
    const wallet = await registry.registerWallet({ email: 'x@example.com', devicePublicKey: device('x') });
    await assert.rejects(
      () => registry.assertBinding({ walletId: wallet.walletId }, 'NOT-A-WALLET-ID'),
      (error) => /valid Wallet ID is required/i.test(error.message)
    );
  });
});

// ---------------------------------------------------------------------------
// Contact changes
// ---------------------------------------------------------------------------

test('contact updates are blocked while frozen after a recovery', async () => {
  await withRegistry(async (registry) => {
    const wallet = await registry.registerWallet({ email: 'freeze@example.com', devicePublicKey: device('freeze') });

    // Simulate the post-recovery freeze window.
    const wallets = await registry.listWallets();
    wallets[0].contactFrozenUntil = new Date(Date.now() + 86400000).toISOString();
    await require('node:fs/promises').writeFile(process.env.WALLET_STORE_PATH, JSON.stringify(wallets, null, 2));

    await assert.rejects(
      () => registry.updateWalletContact(wallet.walletId, { email: 'new@example.com' }),
      (error) => error.status === 423
    );
  });
});

test('contact updates reject an address already bound to another wallet', async () => {
  await withRegistry(async (registry) => {
    const first = await registry.registerWallet({ email: 'one@example.com', devicePublicKey: device('1') });
    await registry.registerWallet({ email: 'two@example.com', devicePublicKey: device('2') });

    await assert.rejects(
      () => registry.updateWalletContact(first.walletId, { email: 'two@example.com' }),
      (error) => error.status === 400
    );
  });
});
