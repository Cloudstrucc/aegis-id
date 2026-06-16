const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('auth service registers users, verifies passwords, and validates OTP challenges', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vanguard-auth-'));
  const previousUserStorePath = process.env.USER_STORE_PATH;
  process.env.USER_STORE_PATH = path.join(tempDir, 'users.json');
  resetModules();

  t.after(() => {
    restoreEnv('USER_STORE_PATH', previousUserStorePath);
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
  assert.match(challenge.developmentCode, /^[0-9]{6}$/);
  assert.equal(await verifyOtpChallenge(user.id, '000000'), false);
  assert.equal(await verifyOtpChallenge(user.id, challenge.developmentCode), true);

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
  for (const modulePath of ['../src/config', '../src/services/auth-service']) {
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
