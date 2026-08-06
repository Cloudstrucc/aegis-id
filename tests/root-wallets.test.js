const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Root wallets: the wallets that can recover control of an organization.
//
// Two properties carry the whole feature, and both are tested here because
// without either it would be a form field nobody reads:
//
//   * nominating is not confirming — a Wallet ID is public, so knowing one must
//     not be enough to become a root wallet
//   * the minimum is enforced, not displayed — an organization below it cannot
//     issue credentials

const MODULES = [
  '../src/config',
  '../src/services/root-wallet-service',
  '../src/services/wallet-registry-service',
  '../src/services/audit-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(run, { enforced = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-root-wallets-'));
  const previous = { ...process.env };
  // Enforcement is off by default in the product, because switching it on stops
  // issuance for every organization below the minimum. These tests are about
  // what happens once an operator has switched it on.
  process.env.ROOT_WALLET_POLICY_ENFORCED = enforced ? 'true' : 'false';
  process.env.ROOT_WALLET_STORE_PATH = path.join(dir, 'root-wallets.json');
  process.env.WALLET_STORE_PATH = path.join(dir, 'wallets.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  resetModules();
  try {
    await run({
      dir,
      roots: require('../src/services/root-wallet-service'),
      registry: require('../src/services/wallet-registry-service')
    });
  } finally {
    process.env = previous;
    resetModules();
  }
}

const WORKSPACE = 'ws-1';

/** Register a wallet so there is something real to nominate. */
async function seedWallet(registry, email) {
  return registry.registerWallet({ email, phone: '', devicePublicKey: `device-${email}` });
}

let seedCounter = 0;

async function confirmedRootWallets(roots, registry, count) {
  const created = [];
  for (let index = 0; index < count; index += 1) {
    // A fresh address each time: registerWallet matches on devicePublicKey, so
    // reusing one returns the same wallet and the second nomination is
    // (correctly) refused as a duplicate.
    const wallet = await seedWallet(registry, `holder${seedCounter++}@example.com`);
    const { confirmationToken } = await roots.nominateRootWallet(WORKSPACE, wallet.walletId, {
      actorEmail: 'admin@example.com'
    });
    await roots.confirmRootWallet(wallet.walletId, confirmationToken);
    created.push(wallet);
  }
  return created;
}

test('a nomination does not count until the wallet confirms', async () => {
  await withEnv(async ({ roots, registry }) => {
    const wallet = await seedWallet(registry, 'holder@example.com');
    const { record } = await roots.nominateRootWallet(WORKSPACE, wallet.walletId, {
      actorEmail: 'admin@example.com'
    });

    assert.equal(record.status, 'pending');
    assert.equal(record.isConfirmed, false);

    // A Wallet ID is public. If nominating were enough, anybody who saw one
    // could make that wallet responsible for an organization.
    let summary = await roots.summarizeRootWallets(WORKSPACE);
    assert.equal(summary.confirmedCount, 0);
    assert.equal(summary.pendingCount, 1);
    assert.equal(summary.meetsMinimum, false);
  });
});

test('confirming needs the token, not just the Wallet ID', async () => {
  await withEnv(async ({ roots, registry }) => {
    const wallet = await seedWallet(registry, 'holder@example.com');
    const { confirmationToken } = await roots.nominateRootWallet(WORKSPACE, wallet.walletId, {});

    // Knowing the public identifier gets you nowhere.
    await assert.rejects(() => roots.confirmRootWallet(wallet.walletId, 'guessed'), /not valid/);
    await assert.rejects(() => roots.confirmRootWallet(wallet.walletId, ''), /not valid/);

    const confirmed = await roots.confirmRootWallet(wallet.walletId, confirmationToken);
    assert.equal(confirmed.isConfirmed, true);
  });
});

test('a token cannot be spent twice', async () => {
  await withEnv(async ({ dir, roots, registry }) => {
    const wallet = await seedWallet(registry, 'holder@example.com');
    const { confirmationToken } = await roots.nominateRootWallet(WORKSPACE, wallet.walletId, {});
    await roots.confirmRootWallet(wallet.walletId, confirmationToken);

    await assert.rejects(() => roots.confirmRootWallet(wallet.walletId, confirmationToken), /not valid/);

    // And it is not kept once used.
    const stored = await fs.readFile(path.join(dir, 'root-wallets.json'), 'utf8');
    assert.equal(stored.includes(confirmationToken), false);
  });
});

test('a mistyped Wallet ID is caught by its check symbol', async () => {
  await withEnv(async ({ roots }) => {
    // wallet-id.js puts a mod-37 check symbol in the last position, so a typo
    // is detectable rather than becoming a nomination nobody can explain.
    await assert.rejects(
      () => roots.nominateRootWallet(WORKSPACE, 'AEG-0000-0000-0001', {}),
      /not a valid Wallet ID/
    );
    await assert.rejects(() => roots.nominateRootWallet(WORKSPACE, 'nonsense', {}), /not a valid Wallet ID/);
  });
});

test('a Wallet ID belonging to nothing is refused', async () => {
  await withEnv(async ({ roots, registry }) => {
    const wallet = await seedWallet(registry, 'holder@example.com');
    await registry.deleteWallet(wallet.walletId, { actorEmail: 'admin@example.com', usageCount: 0 });

    // Accepting it would create a slot that can never be filled.
    await assert.rejects(() => roots.nominateRootWallet(WORKSPACE, wallet.walletId, {}), /No wallet is registered/);
  });
});

test('a revoked wallet cannot become a root wallet', async () => {
  await withEnv(async ({ roots, registry }) => {
    const wallet = await seedWallet(registry, 'holder@example.com');
    await registry.revokeWallet(wallet.walletId, { actorEmail: 'admin@example.com', reason: 'lost' });

    await assert.rejects(
      () => roots.nominateRootWallet(WORKSPACE, wallet.walletId, {}),
      /withdrawn from service/
    );
  });
});

test('the same wallet cannot fill more than one slot', async () => {
  await withEnv(async ({ roots, registry }) => {
    const wallet = await seedWallet(registry, 'holder@example.com');
    await roots.nominateRootWallet(WORKSPACE, wallet.walletId, {});

    // Three slots held by one device is one point of failure in a disguise.
    await assert.rejects(() => roots.nominateRootWallet(WORKSPACE, wallet.walletId, {}), /already a root wallet/);
  });
});

test('the minimum is three, and it is counted in confirmations', async () => {
  await withEnv(async ({ roots, registry }) => {
    assert.equal(roots.MINIMUM_ROOT_WALLETS, 3);

    await confirmedRootWallets(roots, registry, 2);
    let summary = await roots.summarizeRootWallets(WORKSPACE);
    assert.equal(summary.meetsMinimum, false);
    assert.equal(summary.remaining, 1);

    await confirmedRootWallets(roots, registry, 1);
    summary = await roots.summarizeRootWallets(WORKSPACE);
    assert.equal(summary.confirmedCount, 3);
    assert.equal(summary.meetsMinimum, true);
    assert.equal(summary.remaining, 0);
  });
});

test('an organization below the minimum cannot issue credentials', async () => {
  await withEnv(async ({ roots, registry }) => {
    // This is what makes the feature a guardrail rather than a form field.
    await assert.rejects(
      () => roots.assertRootWalletPolicy(WORKSPACE),
      (error) => {
        assert.match(error.message, /0 of 3 root wallets confirmed/);
        assert.match(error.message, /how administrative control is recovered/);
        assert.equal(error.status, 409);
        assert.equal(error.expose, true);
        return true;
      }
    );

    await confirmedRootWallets(roots, registry, 3);
    const summary = await roots.assertRootWalletPolicy(WORKSPACE);
    assert.equal(summary.meetsMinimum, true);
  });
});

test('pending nominations do not satisfy the minimum', async () => {
  await withEnv(async ({ roots, registry }) => {
    for (let index = 0; index < 3; index += 1) {
      const wallet = await seedWallet(registry, `pending${index}@example.com`);
      await roots.nominateRootWallet(WORKSPACE, wallet.walletId, {});
    }

    // Three nominations, no devices agreed. That is not a recovery path.
    await assert.rejects(() => roots.assertRootWalletPolicy(WORKSPACE), /0 of 3/);
  });
});

test('an expired nomination stops counting as pending', async () => {
  await withEnv(async ({ dir, roots, registry }) => {
    const wallet = await seedWallet(registry, 'holder@example.com');
    const { confirmationToken } = await roots.nominateRootWallet(WORKSPACE, wallet.walletId, {});

    const file = path.join(dir, 'root-wallets.json');
    const records = JSON.parse(await fs.readFile(file, 'utf8'));
    records[0].expiresAt = new Date(Date.now() - 1000).toISOString();
    await fs.writeFile(file, JSON.stringify(records, null, 2));

    const summary = await roots.summarizeRootWallets(WORKSPACE);
    assert.equal(summary.pendingCount, 0);
    assert.equal(summary.wallets[0].isExpired, true);

    await assert.rejects(() => roots.confirmRootWallet(wallet.walletId, confirmationToken), /expired/);
  });
});

test('a compromised device can be removed even below the minimum', async () => {
  await withEnv(async ({ roots, registry }) => {
    const wallets = await confirmedRootWallets(roots, registry, 3);
    const listed = await roots.listRootWallets(WORKSPACE);
    const target = listed.find((entry) => entry.walletId === wallets[0].walletId);

    // Blocking removal to preserve a count would be the wrong trade: a stolen
    // device has to be removable immediately. Issuance stops instead.
    await roots.removeRootWallet(WORKSPACE, target.id, {
      actorEmail: 'admin@example.com',
      reason: 'Device stolen'
    });

    const summary = await roots.summarizeRootWallets(WORKSPACE);
    assert.equal(summary.confirmedCount, 2);
    assert.equal(summary.meetsMinimum, false);
    await assert.rejects(() => roots.assertRootWalletPolicy(WORKSPACE), /2 of 3/);
  });
});

test('root wallets are scoped to one organization', async () => {
  await withEnv(async ({ roots, registry }) => {
    await confirmedRootWallets(roots, registry, 3);

    // Another organization's roots are its own problem.
    const other = await roots.summarizeRootWallets('ws-2');
    assert.equal(other.confirmedCount, 0);
    await assert.rejects(() => roots.assertRootWalletPolicy('ws-2'), /0 of 3/);
  });
});

test('the whole lifecycle is on the evidence chain', async () => {
  await withEnv(async ({ roots, registry }) => {
    const { verifyAuditChain } = require('../src/services/audit-service');
    const wallet = await seedWallet(registry, 'holder@example.com');
    const { record, confirmationToken } = await roots.nominateRootWallet(WORKSPACE, wallet.walletId, {
      actorEmail: 'admin@example.com'
    });
    await roots.confirmRootWallet(wallet.walletId, confirmationToken);
    await roots.removeRootWallet(WORKSPACE, record.id, {
      actorEmail: 'admin@example.com',
      reason: 'Left the company'
    });

    const events = JSON.parse(await fs.readFile(process.env.AUDIT_STORE_PATH, 'utf8'));
    const types = events.map((entry) => entry.type);
    for (const expected of [
      'organization.rootWallet.nominated',
      'organization.rootWallet.confirmed',
      'organization.rootWallet.removed'
    ]) {
      assert.ok(types.includes(expected), `missing ${expected}`);
    }

    // The count afterwards is what decides whether issuance still works, so it
    // belongs on the record of the removal.
    const removed = events.find((entry) => entry.type === 'organization.rootWallet.removed');
    assert.equal(removed.data.remainingConfirmed, 0);
    assert.equal(removed.data.reason, 'Left the company');

    // And no token anywhere in the trail.
    assert.equal(JSON.stringify(events).includes(confirmationToken), false);

    assert.equal((await verifyAuditChain()).ok, true);
  });
});

test('with enforcement off the policy advises rather than blocks', async () => {
  await withEnv(
    async ({ roots }) => {
      // The default. Turning it on is an operator decision per environment,
      // because it stops issuance for organizations that already exist.
      const summary = await roots.assertRootWalletPolicy(WORKSPACE);
      assert.equal(summary.meetsMinimum, false);
      assert.equal(summary.enforced, false);
      assert.equal(summary.confirmedCount, 0);
    },
    { enforced: false }
  );
});
