const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Phase 2: password recovery. The two properties that matter are that the
// endpoint cannot be used to discover who has an account, and that a token is
// worth exactly one use.

const MODULES = [
  '../src/config',
  '../src/services/notification-settings-service',
  '../src/services/otp-delivery-service',
  '../src/services/password-reset-service',
  '../src/services/auth-service',
  '../src/services/audit-service',
  '../src/adapters/notify/notification-adapter'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-reset-'));
  const previous = { ...process.env };
  process.env.NODE_ENV = 'development';
  process.env.USER_STORE_PATH = path.join(dir, 'users.json');
  process.env.PASSWORD_RESET_STORE_PATH = path.join(dir, 'resets.json');
  process.env.NOTIFICATION_SETTINGS_STORE_PATH = path.join(dir, 'notify.json');
  process.env.NOTIFICATION_LOG_STORE_PATH = path.join(dir, 'notify-log.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  process.env.MAIL_DROP_PATH = path.join(dir, 'mail');
  resetModules();
  try {
    await run({ dir });
  } finally {
    process.env = previous;
    resetModules();
  }
}

async function seedUser(email = 'holder@example.com', password = 'OriginalPassword1') {
  const { registerUser } = require('../src/services/auth-service');
  return registerUser({ displayName: 'Reset Tester', email, password, confirmPassword: password });
}

async function tokenFromMail(dir) {
  const files = await fs.readdir(path.join(dir, 'mail'));
  const bodies = await Promise.all(files.map((file) => fs.readFile(path.join(dir, 'mail', file), 'utf8')));
  return /auth\/reset\/(\S+)/.exec(bodies.join('\n'))?.[1] || null;
}

test('an unknown address is answered the same way as a known one', async () => {
  await withEnv(async ({ dir }) => {
    const { requestPasswordReset } = require('../src/services/password-reset-service');
    await seedUser();

    const unknown = await requestPasswordReset('stranger@example.com', { baseUrl: 'http://localhost:3000' });
    const known = await requestPasswordReset('holder@example.com', { baseUrl: 'http://localhost:3000' });

    // Identical results: the caller cannot tell the two apart, which is what
    // stops the endpoint being used to enumerate accounts.
    assert.deepEqual(unknown, known);

    // Only the real account produced a message.
    const files = await fs.readdir(path.join(dir, 'mail'));
    assert.equal(files.length, 1);
  });
});

test('the reset token is never stored in plaintext', async () => {
  await withEnv(async ({ dir }) => {
    const { requestPasswordReset } = require('../src/services/password-reset-service');
    await seedUser();
    await requestPasswordReset('holder@example.com', { baseUrl: 'http://localhost:3000' });

    const token = await tokenFromMail(dir);
    assert.ok(token, 'a token reached the mail drop');

    const stored = await fs.readFile(path.join(dir, 'resets.json'), 'utf8');
    assert.equal(stored.includes(token), false, 'a leaked store must not hand over reset ability');
  });
});

test('a reset changes the password and invalidates existing sessions', async () => {
  await withEnv(async ({ dir }) => {
    const { requestPasswordReset, completePasswordReset } = require('../src/services/password-reset-service');
    const { verifyUserPassword, getUserById } = require('../src/services/auth-service');
    const user = await seedUser();

    await requestPasswordReset('holder@example.com', { baseUrl: 'http://localhost:3000' });
    await completePasswordReset(await tokenFromMail(dir), 'ReplacementPassword1');

    assert.equal(await verifyUserPassword('holder@example.com', 'OriginalPassword1'), null);
    assert.ok(await verifyUserPassword('holder@example.com', 'ReplacementPassword1'));

    // Whoever already had a session must lose it, or the reset achieves nothing.
    const refreshed = await getUserById(user.id);
    assert.ok(refreshed.sessionsValidFrom, 'sessions issued before the reset are cut off');
  });
});

test('a reset token cannot be used twice', async () => {
  await withEnv(async ({ dir }) => {
    const { requestPasswordReset, completePasswordReset } = require('../src/services/password-reset-service');
    await seedUser();
    await requestPasswordReset('holder@example.com', { baseUrl: 'http://localhost:3000' });

    const token = await tokenFromMail(dir);
    await completePasswordReset(token, 'ReplacementPassword1');
    await assert.rejects(() => completePasswordReset(token, 'YetAnotherPassword1'), /no longer valid/);
  });
});

test('requesting again invalidates the previous link', async () => {
  await withEnv(async ({ dir }) => {
    const { requestPasswordReset, resolveResetToken } = require('../src/services/password-reset-service');
    await seedUser();

    await requestPasswordReset('holder@example.com', { baseUrl: 'http://localhost:3000' });
    const first = await tokenFromMail(dir);

    await requestPasswordReset('holder@example.com', { baseUrl: 'http://localhost:3000' });

    // Only the newest link stays live, so asking repeatedly cannot build up a
    // pile of usable tokens.
    assert.equal(await resolveResetToken(first), null);
  });
});

test('a short password is refused', async () => {
  await withEnv(async ({ dir }) => {
    const { requestPasswordReset, completePasswordReset } = require('../src/services/password-reset-service');
    await seedUser();
    await requestPasswordReset('holder@example.com', { baseUrl: 'http://localhost:3000' });

    const token = await tokenFromMail(dir);
    await assert.rejects(() => completePasswordReset(token, 'short'), /at least 10/);
  });
});

test('a made-up token resolves to nothing rather than throwing', async () => {
  await withEnv(async () => {
    const { resolveResetToken } = require('../src/services/password-reset-service');
    assert.equal(await resolveResetToken('not-a-real-token'), null);
    assert.equal(await resolveResetToken(''), null);
    assert.equal(await resolveResetToken(undefined), null);
  });
});
