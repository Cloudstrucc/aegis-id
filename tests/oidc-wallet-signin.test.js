const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Signing in to a connected application with a wallet.
//
// The properties worth holding onto are the ones the old screen did not have:
// identity comes from the device rather than from anything typed, an approval
// belongs to the application it was minted for, and it is worth exactly one
// sign-in.

const MODULES = [
  '../src/config',
  '../src/services/oidc-wallet-signin-service',
  '../src/services/wallet-registry-service',
  '../src/services/org-admin-service',
  '../src/services/audit-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-wallet-signin-'));
  const previous = { ...process.env };

  process.env.OIDC_WALLET_SIGNIN_STORE_PATH = path.join(dir, 'signins.json');
  process.env.WALLET_STORE_PATH = path.join(dir, 'wallets.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  process.env.ORG_ADMIN_STORE_PATH = path.join(dir, 'org-admin.json');
  process.env.ORG_ADMIN_EVENT_STORE_PATH = path.join(dir, 'org-admin-events.json');
  process.env.WALLET_RECOVERY_CODE_STORE_PATH = path.join(dir, 'recovery.json');

  resetModules();
  try {
    await run({
      signin: require('../src/services/oidc-wallet-signin-service'),
      wallets: require('../src/services/wallet-registry-service')
    });
  } finally {
    process.env = previous;
    resetModules();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// A wallet registers with the public half of its device key; the private half
// never leaves the phone.
const DEVICE_KEY = 'BJ8kR2wFakePublicKeyForTestsOnly0000000000000000000000000000=';

const REQUEST = {
  clientId: 'business-expenses',
  redirectUri: 'http://localhost:4300/auth/callback',
  state: 'state-1',
  nonce: 'nonce-1',
  appName: 'Business Expenses'
};

test('the deep link carries a challenge and nothing that names anybody', async () => {
  await withEnv(async ({ signin }) => {
    const challenge = await signin.startWalletSignIn(REQUEST);
    const link = signin.walletDeepLink(challenge.id);

    assert.match(link, /:\/\/sign-in\?challenge=/);
    // Anyone can photograph a QR off a screen. What makes that safe is that
    // there is nothing in it worth having.
    assert.doesNotMatch(link, /@/);
    assert.doesNotMatch(link, /AEG-/);
  });
});

test('a pending challenge tells a watcher nothing about who might answer', async () => {
  await withEnv(async ({ signin }) => {
    const challenge = await signin.startWalletSignIn(REQUEST);
    const status = await signin.readSignInStatus(challenge.id);

    assert.deepEqual(status, { status: 'pending' });
  });
});

test('identity comes from the wallet that answers, not from the request', async () => {
  await withEnv(async ({ signin, wallets }) => {
    const wallet = await wallets.registerWallet({ email: 'holder@example.test', devicePublicKey: DEVICE_KEY });
    const challenge = await signin.startWalletSignIn(REQUEST);

    await signin.approveWalletSignIn(challenge.id, wallet.walletId);
    const status = await signin.readSignInStatus(challenge.id);

    assert.equal(status.status, 'approved');
    assert.equal(status.walletId, wallet.walletId);
    assert.equal(status.email, 'holder@example.test');
  });
});

test('an unregistered wallet cannot approve a sign-in', async () => {
  await withEnv(async ({ signin }) => {
    const challenge = await signin.startWalletSignIn(REQUEST);
    await assert.rejects(
      () => signin.approveWalletSignIn(challenge.id, 'AEG-0000-0000-0000-0000'),
      /not registered/
    );
  });
});

test('a withdrawn wallet cannot approve a sign-in', async () => {
  await withEnv(async ({ signin, wallets }) => {
    const wallet = await wallets.registerWallet({ email: 'gone@example.test', devicePublicKey: DEVICE_KEY });
    await wallets.revokeWallet(wallet.walletId, { actorEmail: 'admin@example.test', reason: 'lost' });

    const challenge = await signin.startWalletSignIn(REQUEST);
    await assert.rejects(
      () => signin.approveWalletSignIn(challenge.id, wallet.walletId),
      /withdrawn from service/
    );
  });
});

test('an approval cannot be spent on a different application', async () => {
  await withEnv(async ({ signin, wallets }) => {
    const wallet = await wallets.registerWallet({ email: 'holder@example.test', devicePublicKey: DEVICE_KEY });
    const challenge = await signin.startWalletSignIn(REQUEST);
    await signin.approveWalletSignIn(challenge.id, wallet.walletId);

    await assert.rejects(
      () => signin.claimWalletSignIn(challenge.id, {
        clientId: 'someone-elses-app',
        redirectUri: 'https://elsewhere.example/cb'
      }),
      /different application/
    );
  });
});

test('an approval is worth exactly one sign-in', async () => {
  await withEnv(async ({ signin, wallets }) => {
    const wallet = await wallets.registerWallet({ email: 'holder@example.test', devicePublicKey: DEVICE_KEY });
    const challenge = await signin.startWalletSignIn(REQUEST);
    await signin.approveWalletSignIn(challenge.id, wallet.walletId);

    const claimed = await signin.claimWalletSignIn(challenge.id, {
      clientId: REQUEST.clientId,
      redirectUri: REQUEST.redirectUri
    });
    assert.equal(claimed.record.email, 'holder@example.test');

    await assert.rejects(
      () => signin.claimWalletSignIn(challenge.id, {
        clientId: REQUEST.clientId,
        redirectUri: REQUEST.redirectUri
      }),
      /not been approved/
    );
  });
});

test('a challenge nobody approved cannot be claimed', async () => {
  await withEnv(async ({ signin }) => {
    const challenge = await signin.startWalletSignIn(REQUEST);
    await assert.rejects(
      () => signin.claimWalletSignIn(challenge.id, {
        clientId: REQUEST.clientId,
        redirectUri: REQUEST.redirectUri
      }),
      /not been approved/
    );
  });
});

test('declining is an answer, and closes the challenge', async () => {
  await withEnv(async ({ signin, wallets }) => {
    const wallet = await wallets.registerWallet({ email: 'holder@example.test', devicePublicKey: DEVICE_KEY });
    const challenge = await signin.startWalletSignIn(REQUEST);

    await signin.declineWalletSignIn(challenge.id, wallet.walletId);
    assert.equal((await signin.readSignInStatus(challenge.id)).status, 'declined');

    await assert.rejects(
      () => signin.approveWalletSignIn(challenge.id, wallet.walletId),
      /already been answered/
    );
  });
});
