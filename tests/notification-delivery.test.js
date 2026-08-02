const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Phase 1: every outbound message goes through one delivery path, the channel
// matrix is honoured, and codes are never handed back to the caller.

const MODULES = [
  '../src/config',
  '../src/services/notification-settings-service',
  '../src/services/otp-delivery-service',
  '../src/services/auth-service',
  '../src/services/audit-service',
  '../src/adapters/notify/notification-adapter'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(env, run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-notify-'));
  const previous = { ...process.env };
  process.env.USER_STORE_PATH = path.join(dir, 'users.json');
  process.env.NOTIFICATION_SETTINGS_STORE_PATH = path.join(dir, 'notify.json');
  process.env.NOTIFICATION_LOG_STORE_PATH = path.join(dir, 'notify-log.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  process.env.MAIL_DROP_PATH = path.join(dir, 'mail');
  Object.assign(process.env, env);
  resetModules();
  try {
    await run({ dir });
  } finally {
    process.env = previous;
    resetModules();
  }
}

async function readMailDrop(dir) {
  try {
    const files = await fs.readdir(path.join(dir, 'mail'));
    const bodies = await Promise.all(
      files.map((file) => fs.readFile(path.join(dir, 'mail', file), 'utf8'))
    );
    return bodies;
  } catch {
    return [];
  }
}

test('a sign-in code is actually sent, not just generated', async () => {
  await withEnv({ NODE_ENV: 'development' }, async ({ dir }) => {
    const { registerUser, createOtpChallenge, verifyOtpChallenge } = require('../src/services/auth-service');
    const user = await registerUser({
      displayName: 'Codey Tester',
      email: 'codey@example.com',
      password: 'CorrectHorseBattery',
      confirmPassword: 'CorrectHorseBattery'
    });

    const challenge = await createOtpChallenge(user.id, 'email');
    assert.equal(challenge.delivered, true);

    const messages = await readMailDrop(dir);
    assert.equal(messages.length, 1, 'exactly one message was sent');

    const code = /code is (\d{6})/.exec(messages[0])?.[1];
    assert.ok(code, 'the message carries the six-digit code');
    assert.equal(await verifyOtpChallenge(user.id, code), true, 'the sent code is the one that verifies');
  });
});

test('the sign-in code is never returned to the caller', async () => {
  await withEnv({ NODE_ENV: 'development' }, async () => {
    const { registerUser, createOtpChallenge } = require('../src/services/auth-service');
    const user = await registerUser({
      displayName: 'Quiet Tester',
      email: 'quiet@example.com',
      password: 'CorrectHorseBattery',
      confirmPassword: 'CorrectHorseBattery'
    });

    const challenge = await createOtpChallenge(user.id, 'email');
    // Returning it would be a bypass in dev and qa, which are internet-facing
    // and run NODE_ENV=production anyway.
    assert.equal('developmentCode' in challenge, false);
    assert.equal(JSON.stringify(challenge).match(/\d{6}/), null);
  });
});

test('a message type with no channel ticked is not sent', async () => {
  await withEnv({ NODE_ENV: 'development' }, async ({ dir }) => {
    const settings = require('../src/services/notification-settings-service');
    await settings.updateNotificationSettings(
      {
        emailEnabled: 'true',
        emailPreset: 'filesystem',
        // Only wallet recovery may use email; mfa-otp is left unticked.
        'type_wallet-recovery_email': 'true'
      },
      'admin@example.com'
    );

    const { deliverMessage } = require('../src/services/otp-delivery-service');
    const blocked = await deliverMessage({
      type: 'mfa-otp',
      email: 'someone@example.com',
      variables: { code: '111111' }
    });
    assert.equal(blocked.delivered, false, 'mfa-otp has no permitted channel');

    const allowed = await deliverMessage({
      type: 'wallet-recovery',
      email: 'someone@example.com',
      variables: { code: '222222', walletId: 'AEG-TEST' }
    });
    assert.equal(allowed.delivered, true);

    const messages = await readMailDrop(dir);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /222222/);
  });
});

test('an unknown message type is refused rather than silently dropped', async () => {
  await withEnv({ NODE_ENV: 'development' }, async () => {
    const { deliverMessage } = require('../src/services/otp-delivery-service');
    await assert.rejects(
      () => deliverMessage({ type: 'not-a-real-type', email: 'x@example.com' }),
      /Unknown message type/
    );
  });
});

test('every delivery is logged with the recipient masked', async () => {
  await withEnv({ NODE_ENV: 'development' }, async () => {
    const { deliverMessage, listDeliveryLog } = require('../src/services/otp-delivery-service');
    await deliverMessage({
      type: 'wallet-recovery',
      email: 'holder@example.com',
      variables: { code: '333333', walletId: 'AEG-LOG' }
    });

    const log = await listDeliveryLog();
    assert.equal(log.length, 1);
    assert.equal(log[0].type, 'wallet-recovery');
    assert.equal(log[0].delivered, true);
    assert.equal(log[0].recipient, 'ho***@example.com');
    // The log is for admins to read: it must not carry the code itself.
    assert.equal(JSON.stringify(log[0]).includes('333333'), false);
  });
});

test('hosted environments start fail-closed until an admin configures a channel', async () => {
  await withEnv({ NODE_ENV: 'production' }, async () => {
    const { getNotificationSettings } = require('../src/services/notification-settings-service');
    const settings = await getNotificationSettings();
    // dev, qa and prod all run NODE_ENV=production, so none of them may quietly
    // fall back to writing codes to disk.
    assert.equal(settings.email.enabled, false);
    assert.notEqual(settings.email.preset, 'filesystem');
  });
});
