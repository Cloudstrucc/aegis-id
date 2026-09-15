const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// Signing in to the web app itself by approving from the wallet. The wallet
// side is the same challenge the relying parties use; what is ours here is the
// mapping from the wallet that answered to an account, and the refusal to
// invent one.

const MODULES = [
  '../src/config',
  '../src/app',
  '../src/services/auth-service',
  '../src/services/sign-in-methods-service',
  '../src/services/oidc-wallet-signin-service',
  '../src/services/wallet-registry-service',
  '../src/services/org-admin-service',
  '../src/services/audit-service',
  '../src/services/notification-settings-service',
  '../src/services/otp-delivery-service',
  '../src/adapters/notify/notification-adapter',
  '../src/services/site-context-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/src/routes/') || key.includes('/src/middleware/')) {
      delete require.cache[key];
    }
  }
}

async function withApp(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-wallet-login-'));
  const previous = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: 'development',
    APP_ENV: 'no-such-env-file',
    PUBLIC_BASE_URL: 'http://127.0.0.1',
    SESSION_SECRET: 'test-secret-test-secret-test-secret',
    USER_STORE_PATH: path.join(dir, 'users.json'),
    WALLET_STORE_PATH: path.join(dir, 'wallets.json'),
    OIDC_WALLET_SIGNIN_STORE_PATH: path.join(dir, 'signin.json'),
    SIGN_IN_METHOD_STORE_PATH: path.join(dir, 'methods.json'),
    ORG_ADMIN_STORE_PATH: path.join(dir, 'org-admin.json'),
    ORG_ADMIN_EVENT_STORE_PATH: path.join(dir, 'org-admin-events.json'),
    SUBSCRIBER_WORKSPACE_STORE_PATH: path.join(dir, 'workspaces.json'),
    SUBSCRIPTION_STORE_PATH: path.join(dir, 'subscriptions.json'),
    AUDIT_STORE_PATH: path.join(dir, 'audit.json'),
    NOTIFICATION_SETTINGS_STORE_PATH: path.join(dir, 'notify.json'),
    NOTIFICATION_LOG_STORE_PATH: path.join(dir, 'notify-log.json'),
    MAIL_DROP_PATH: path.join(dir, 'mail')
  });
  resetModules();
  const { createApp } = require('../src/app');
  const server = http.createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ base, dir });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    process.env = previous;
    resetModules();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function request(base, method, urlPath, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(`${base}${urlPath}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(cookie ? { Cookie: cookie } : {})
      }
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: (() => { try { return JSON.parse(text); } catch { return null; } })() }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function enableWalletMethod() {
  const methods = require('../src/services/sign-in-methods-service');
  const current = await methods.getSignInMethods();
  await methods.updateSignInMethods({
    ...Object.fromEntries(Object.entries(current).flatMap(([id, m]) => [
      [`method_${id}_enabled`, m.enabled ? 'true' : 'false'],
      [`method_${id}_first`, m.firstFactor ? 'true' : 'false'],
      [`method_${id}_second`, m.satisfiesSecond ? 'true' : 'false']
    ])),
    method_wallet_enabled: 'true',
    method_wallet_first: 'true',
    method_wallet_second: 'true'
  });
}

test('the wallet method is offered on the login page only once enabled', async () => {
  await withApp(async ({ base }) => {
    const before = await request(base, 'GET', '/auth/login');
    assert.doesNotMatch(before.text, /Sign in with your wallet/);
    const redirected = await request(base, 'GET', '/auth/login/wallet');
    assert.equal(redirected.status, 303, 'the wallet page is not reachable while the method is off');

    await enableWalletMethod();
    const after = await request(base, 'GET', '/auth/login');
    assert.match(after.text, /Sign in with your wallet/);
    const page = await request(base, 'GET', '/auth/login/wallet');
    assert.equal(page.status, 200);
    assert.match(page.text, /data-wallet-signin-complete="\/auth\/login\/wallet\/complete"/);
    assert.match(page.text, /sign-in\?challenge/);
  });
});

test('an approved wallet opens the account registered with its email, and no other', async () => {
  await withApp(async ({ base }) => {
    await enableWalletMethod();
    const { registerUser } = require('../src/services/auth-service');
    const { registerWallet } = require('../src/services/wallet-registry-service');
    const signin = require('../src/services/oidc-wallet-signin-service');

    await registerUser({ displayName: 'Holder', email: 'holder@example.com', password: 'CorrectHorseBattery', confirmPassword: 'CorrectHorseBattery' });
    const wallet = await registerWallet({ email: 'holder@example.com', devicePublicKey: 'device-key-1' });
    const stranger = await registerWallet({ email: 'nobody@example.com', devicePublicKey: 'device-key-2' });

    // The page mints the challenge; take its id from the page.
    const page = await request(base, 'GET', '/auth/login/wallet');
    const cookie = (page.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    const challengeId = page.text.match(/data-wallet-signin="([^"]+)"/)[1];

    // Unapproved: refused.
    const early = await request(base, 'POST', '/auth/login/wallet/complete', { body: { challengeId }, cookie });
    assert.equal(early.status, 403);

    // Approved by a wallet whose email has no account: refused, not invented.
    await signin.approveWalletSignIn(challengeId, stranger.walletId);
    const refused = await request(base, 'POST', '/auth/login/wallet/complete', { body: { challengeId }, cookie });
    assert.equal(refused.status, 403);
    assert.match(refused.json.error.message, /No Aegis account/);

    // A fresh challenge approved by the holder's wallet: signed in.
    const page2 = await request(base, 'GET', '/auth/login/wallet', { cookie });
    const challenge2 = page2.text.match(/data-wallet-signin="([^"]+)"/)[1];
    await signin.approveWalletSignIn(challenge2, wallet.walletId);
    const ok = await request(base, 'POST', '/auth/login/wallet/complete', { body: { challengeId: challenge2 }, cookie });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.ok, true);
    assert.ok(ok.json.redirectUrl);

    // The approval was spent; it cannot open a second session.
    const again = await request(base, 'POST', '/auth/login/wallet/complete', { body: { challengeId: challenge2 } });
    assert.equal(again.status, 403);
  });
});
