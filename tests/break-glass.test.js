const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Break-glass codes: the last way into an organization that has lost every
// root wallet.
//
// The property under test is the one that makes this safe to exist at all:
// **no administrator here can reach a customer's organization on their own.**
// Not by policy — by construction. Every path to redemption needs a code only
// the customer holds AND a root wallet that authorised it in advance.

const MODULES = [
  '../src/config',
  '../src/services/break-glass-service',
  '../src/services/root-wallet-service',
  '../src/services/wallet-registry-service',
  '../src/services/audit-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-break-glass-'));
  const previous = { ...process.env };
  process.env.BREAK_GLASS_STORE_PATH = path.join(dir, 'break-glass.json');
  process.env.ROOT_WALLET_STORE_PATH = path.join(dir, 'root-wallets.json');
  process.env.WALLET_STORE_PATH = path.join(dir, 'wallets.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  resetModules();
  try {
    await run({
      dir,
      glass: require('../src/services/break-glass-service'),
      roots: require('../src/services/root-wallet-service'),
      registry: require('../src/services/wallet-registry-service')
    });
  } finally {
    process.env = previous;
    resetModules();
  }
}

const WORKSPACE = { id: 'ws-1', organization: 'Contoso' };
let counter = 0;

async function confirmedRootWallet(roots, registry) {
  const wallet = await registry.registerWallet({
    email: `root${counter++}@example.com`,
    phone: '',
    devicePublicKey: `device-${counter}`
  });
  const { confirmationToken } = await roots.nominateRootWallet(WORKSPACE.id, wallet.walletId, {});
  await roots.confirmRootWallet(wallet.walletId, confirmationToken);
  return wallet;
}

test('a code does nothing until a root wallet authorises it', async () => {
  await withEnv(async ({ glass, roots, registry }) => {
    const wallet = await confirmedRootWallet(roots, registry);
    const { code, record, authorisationToken } = await glass.issueBreakGlassCode(WORKSPACE, {
      actorEmail: 'owner@example.com'
    });

    assert.equal(record.status, 'awaiting-authorisation');
    assert.equal(record.isActive, false);

    // This is the whole design. An administrator holding the code cannot use it
    // until a root wallet has signed off, so generating one is not a way in.
    await assert.rejects(
      () => glass.redeemBreakGlassCode(code, { actorEmail: 'vanguard@example.com', ticketReference: 'T-1' }),
      /not valid/
    );

    await glass.authoriseBreakGlassCode(wallet.walletId, authorisationToken);
    const redeemed = await glass.redeemBreakGlassCode(code, {
      actorEmail: 'vanguard@example.com',
      ticketReference: 'T-1'
    });
    assert.equal(redeemed.workspaceId, WORKSPACE.id);
  });
});

test('only a root wallet of that organization can authorise', async () => {
  await withEnv(async ({ glass, roots, registry }) => {
    await confirmedRootWallet(roots, registry);
    const { authorisationToken } = await glass.issueBreakGlassCode(WORKSPACE, {});

    // A wallet that saw the QR but is not a root wallet here gets nowhere.
    const outsider = await registry.registerWallet({
      email: 'outsider@example.com',
      phone: '',
      devicePublicKey: 'device-outsider'
    });
    await assert.rejects(
      () => glass.authoriseBreakGlassCode(outsider.walletId, authorisationToken),
      /not valid/
    );
  });
});

test('the code is never stored, only a hash', async () => {
  await withEnv(async ({ dir, glass, roots, registry }) => {
    await confirmedRootWallet(roots, registry);
    const { code } = await glass.issueBreakGlassCode(WORKSPACE, {});

    // The customer holds this. We must not.
    const stored = await fs.readFile(path.join(dir, 'break-glass.json'), 'utf8');
    assert.equal(stored.includes(code), false);
    assert.equal(stored.includes(code.replace(/-/g, '')), false);
  });
});

test('an organization with no root wallet cannot generate one', async () => {
  await withEnv(async ({ glass }) => {
    // A code nobody could validly authorise would be a code that only we could
    // ever act on, which is precisely what this must not be.
    await assert.rejects(() => glass.issueBreakGlassCode(WORKSPACE, {}), /Confirm a root wallet first/);
  });
});

test('redeeming requires a ticket reference', async () => {
  await withEnv(async ({ glass, roots, registry }) => {
    const wallet = await confirmedRootWallet(roots, registry);
    const { code, authorisationToken } = await glass.issueBreakGlassCode(WORKSPACE, {});
    await glass.authoriseBreakGlassCode(wallet.walletId, authorisationToken);

    // The out-of-band conversation belongs on the record too.
    await assert.rejects(
      () => glass.redeemBreakGlassCode(code, { actorEmail: 'vanguard@example.com' }),
      /Record the support ticket/
    );
  });
});

test('a code is single use', async () => {
  await withEnv(async ({ glass, roots, registry }) => {
    const wallet = await confirmedRootWallet(roots, registry);
    const { code, authorisationToken } = await glass.issueBreakGlassCode(WORKSPACE, {});
    await glass.authoriseBreakGlassCode(wallet.walletId, authorisationToken);
    await glass.redeemBreakGlassCode(code, { actorEmail: 'v@example.com', ticketReference: 'T-1' });

    await assert.rejects(
      () => glass.redeemBreakGlassCode(code, { actorEmail: 'v@example.com', ticketReference: 'T-2' }),
      /not valid/
    );
  });
});

test('only one live code at a time', async () => {
  await withEnv(async ({ glass, roots, registry }) => {
    await confirmedRootWallet(roots, registry);
    await glass.issueBreakGlassCode(WORKSPACE, {});

    // Two valid codes is two things to lose.
    await assert.rejects(() => glass.issueBreakGlassCode(WORKSPACE, {}), /already has a break-glass code/);
  });
});

test('a revoked code cannot be redeemed', async () => {
  await withEnv(async ({ glass, roots, registry }) => {
    const wallet = await confirmedRootWallet(roots, registry);
    const { code, record, authorisationToken } = await glass.issueBreakGlassCode(WORKSPACE, {});
    await glass.authoriseBreakGlassCode(wallet.walletId, authorisationToken);
    await glass.revokeBreakGlassCode(WORKSPACE.id, record.id, { actorEmail: 'owner@example.com' });

    await assert.rejects(
      () => glass.redeemBreakGlassCode(code, { actorEmail: 'v@example.com', ticketReference: 'T-1' }),
      /not valid/
    );
  });
});

test('every failure looks the same from outside', async () => {
  await withEnv(async ({ glass, roots, registry }) => {
    await confirmedRootWallet(roots, registry);
    const { code } = await glass.issueBreakGlassCode(WORKSPACE, {});

    const messages = [];
    for (const candidate of [code, 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ', 'nonsense', '']) {
      await glass
        .redeemBreakGlassCode(candidate, { actorEmail: 'v@example.com', ticketReference: 'T-1' })
        .catch((error) => messages.push(error.message));
    }

    // Unauthorised, unknown and junk must be indistinguishable, or this becomes
    // a way to discover which organizations have a live code.
    assert.equal(new Set(messages).size, 1, [...new Set(messages)].join(' | '));
  });
});

test('who authorised it is recorded at the moment it is used', async () => {
  await withEnv(async ({ glass, roots, registry }) => {
    const { verifyAuditChain } = require('../src/services/audit-service');
    const wallet = await confirmedRootWallet(roots, registry);
    const { code, authorisationToken } = await glass.issueBreakGlassCode(WORKSPACE, {
      actorEmail: 'owner@example.com'
    });
    await glass.authoriseBreakGlassCode(wallet.walletId, authorisationToken);
    await glass.redeemBreakGlassCode(code, {
      actorEmail: 'vanguard@example.com',
      ticketReference: 'TICKET-4821'
    });

    const events = JSON.parse(await fs.readFile(process.env.AUDIT_STORE_PATH, 'utf8'));
    const redeemed = events.find((entry) => entry.type === 'organization.breakGlass.redeemed');

    // The answer to "on whose authority did you enter this organization?" has
    // to be on the record, at the moment of entry.
    assert.equal(redeemed.data.authorisedByWalletId, wallet.walletId);
    assert.equal(redeemed.data.redeemedBy, 'vanguard@example.com');
    assert.equal(redeemed.data.ticketReference, 'TICKET-4821');
    assert.ok(redeemed.data.authorisedAt);

    for (const expected of [
      'organization.breakGlass.generated',
      'organization.breakGlass.authorised',
      'organization.breakGlass.redeemed'
    ]) {
      assert.ok(events.some((entry) => entry.type === expected), `missing ${expected}`);
    }
    // And the code itself is nowhere in the trail.
    assert.equal(JSON.stringify(events).includes(code.replace(/-/g, '')), false);

    assert.equal((await verifyAuditChain()).ok, true);
  });
});

test('a rejected attempt is recorded too', async () => {
  await withEnv(async ({ glass, roots, registry }) => {
    await confirmedRootWallet(roots, registry);
    const { code } = await glass.issueBreakGlassCode(WORKSPACE, {});

    // Unauthorised: an administrator trying to use a code no root wallet has
    // signed off on. That attempt is exactly what an audit wants to see.
    await glass
      .redeemBreakGlassCode(code, { actorEmail: 'curious@example.com', ticketReference: 'T-9' })
      .catch(() => {});

    const events = JSON.parse(await fs.readFile(process.env.AUDIT_STORE_PATH, 'utf8'));
    const rejected = events.find((entry) => entry.type === 'organization.breakGlass.rejected');
    assert.equal(rejected.data.reason, 'not-authorised');
    assert.equal(rejected.data.attemptedBy, 'curious@example.com');
  });
});
