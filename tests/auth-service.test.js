const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('auth service registers users, verifies passwords, and validates OTP challenges', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vanguard-auth-'));
  const previousUserStorePath = process.env.USER_STORE_PATH;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAppEnv = process.env.APP_ENV;
  process.env.USER_STORE_PATH = path.join(tempDir, 'users.json');
  process.env.NOTIFICATION_SETTINGS_STORE_PATH = path.join(tempDir, 'notify.json');
  process.env.NOTIFICATION_LOG_STORE_PATH = path.join(tempDir, 'notify-log.json');
  process.env.AUDIT_STORE_PATH = path.join(tempDir, 'audit.json');
  process.env.MAIL_DROP_PATH = path.join(tempDir, 'mail');
  process.env.NODE_ENV = 'test';
  process.env.APP_ENV = 'local';
  resetModules();

  t.after(() => {
    restoreEnv('USER_STORE_PATH', previousUserStorePath);
    restoreEnv('NODE_ENV', previousNodeEnv);
    restoreEnv('APP_ENV', previousAppEnv);
    resetModules();
  });

  const {
    createOtpChallenge,
    getUserById,
    registerUser,
    verifyOtpChallenge,
    verifyUserPassword
  } = require('../src/services/auth-service');

  const user = await registerUser({
    displayName: 'Vanguard Admin',
    email: 'Admin@VanguardCS.ca',
    password: 'StrongPass123!',
    confirmPassword: 'StrongPass123!',
    preferredMfa: 'email'
  });

  assert.equal(user.email, 'admin@vanguardcs.ca');
  assert.equal(user.preferredMfa, 'email');
  assert.equal(user.passkeyCount, 0);

  const passwordUser = await verifyUserPassword('admin@vanguardcs.ca', 'StrongPass123!');
  assert.equal(passwordUser.id, user.id);
  assert.equal(await verifyUserPassword('admin@vanguardcs.ca', 'wrong-password'), null);

  const challenge = await createOtpChallenge(user.id, 'email');
  assert.equal(challenge.delivered, true, 'the code is sent, not returned');

  // Read it from the message that was actually delivered, the way the person
  // signing in would.
  const dropped = await fs.readdir(path.join(tempDir, 'mail'));
  const body = await fs.readFile(path.join(tempDir, 'mail', dropped[0]), 'utf8');
  const code = /\b(\d{6})\b/.exec(body)[1];

  assert.equal(await verifyOtpChallenge(user.id, '000000'), false);
  assert.equal(await verifyOtpChallenge(user.id, code), true);

  const refreshed = await getUserById(user.id);
  assert.ok(refreshed.lastSecondFactorAt);

  await assert.rejects(
    () =>
      registerUser({
        displayName: 'Duplicate',
        email: 'admin@vanguardcs.ca',
        password: 'StrongPass123!',
        confirmPassword: 'StrongPass123!',
        preferredMfa: 'email'
      }),
    /already exists/
  );
});

function resetModules() {
  const modules = [
    '../src/config',
    '../src/services/auth-service',
    '../src/services/notification-settings-service',
    '../src/services/otp-delivery-service',
    '../src/services/audit-service',
    '../src/adapters/notify/notification-adapter'
  ];
  for (const modulePath of modules) {
    delete require.cache[require.resolve(modulePath)];
  }
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
