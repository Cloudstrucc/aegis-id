const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Signing in with a recovery code when the authenticator is gone.
//
// The properties that matter are that a code is worth exactly one sign-in, that
// it is never enough on its own, and that the flow cannot be used to work out
// who holds an account or which accounts are passwordless.

const MODULES = [
  '../src/config',
  '../src/services/auth-service',
  '../src/services/account-recovery-service',
  '../src/services/notification-settings-service',
  '../src/services/otp-delivery-service',
  '../src/services/audit-service',
  '../src/adapters/notify/notification-adapter'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-recover-'));
  const previous = { ...process.env };
  process.env.NODE_ENV = 'development';
  process.env.USER_STORE_PATH = path.join(dir, 'users.json');
  process.env.ACCOUNT_RECOVERY_CODE_STORE_PATH = path.join(dir, 'account-codes.json');
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

async function seedAccounts() {
  const now = new Date().toISOString();
  const users = [
    {
      id: 'user-passwordless',
      email: 'lost@example.com',
      displayName: 'Lost Device',
      phone: '',
      passwordHash: null,
      passwordless: true,
      passkeys: [],
      emailVerifiedAt: now,
      preferredMfa: 'passkey',
      mfaMethods: { email: true },
      pendingSecondFactor: null,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'user-with-password',
      email: 'haspassword@example.com',
      displayName: 'Has Password',
      phone: '',
      passwordHash: '$2a$12$notarealhashbutnonempty',
      passwordless: false,
      passkeys: [],
      pendingSecondFactor: null,
      createdAt: now,
      updatedAt: now
    }
  ];
  await fs.writeFile(process.env.USER_STORE_PATH, JSON.stringify(users, null, 2));
  return users;
}

async function latestOtp(dir) {
  const files = (await fs.readdir(path.join(dir, 'mail'))).sort();
  const body = await fs.readFile(path.join(dir, 'mail', files[files.length - 1]), 'utf8');
  return /\b(\d{6})\b/.exec(body)[1];
}

test('a recovery code is worth exactly one sign-in', async () => {
  await withEnv(async () => {
    const recovery = require('../src/services/account-recovery-service');
    await seedAccounts();
    const codes = await recovery.generateAccountRecoveryCodes('user-passwordless');

    assert.equal(await recovery.redeemAccountRecoveryCode('user-passwordless', codes[0]), true);
    // Replaying it must fail, so a code glimpsed over a shoulder buys one go.
    assert.equal(await recovery.redeemAccountRecoveryCode('user-passwordless', codes[0]), false);
    assert.equal(await recovery.getRemainingAccountCodeCount('user-passwordless'), 9);
  });
});

test('one account\'s codes do not work on another', async () => {
  await withEnv(async () => {
    const recovery = require('../src/services/account-recovery-service');
    await seedAccounts();
    const codes = await recovery.generateAccountRecoveryCodes('user-passwordless');
    await recovery.generateAccountRecoveryCodes('user-with-password');

    assert.equal(await recovery.redeemAccountRecoveryCode('user-with-password', codes[0]), false);
    // Still unspent on the account it belongs to.
    assert.equal(await recovery.redeemAccountRecoveryCode('user-passwordless', codes[0]), true);
  });
});

test('a code alone does not sign anyone in — an emailed code is also required', async () => {
  await withEnv(async ({ dir }) => {
    const recovery = require('../src/services/account-recovery-service');
    const { createOtpChallenge, verifyOtpChallenge } = require('../src/services/auth-service');
    await seedAccounts();
    const codes = await recovery.generateAccountRecoveryCodes('user-passwordless');

    assert.equal(await recovery.redeemAccountRecoveryCode('user-passwordless', codes[0]), true);

    // A written-down code is only possession. Control of the registered address
    // is the second half, matching Tier-1 wallet recovery.
    const delivery = await createOtpChallenge('user-passwordless', 'email');
    assert.equal(delivery.delivered, true);
    assert.equal(await verifyOtpChallenge('user-passwordless', '000000'), false);
    assert.equal(await verifyOtpChallenge('user-passwordless', await latestOtp(dir)), true);
  });
});

test('an account with a password has no recovery codes to spend', async () => {
  await withEnv(async () => {
    const recovery = require('../src/services/account-recovery-service');
    await seedAccounts();

    // Password accounts recover through the emailed reset link instead, so
    // there is nothing here for the recovery-code route to accept.
    assert.equal(await recovery.getRemainingAccountCodeCount('user-with-password'), 0);
    assert.equal(await recovery.redeemAccountRecoveryCode('user-with-password', 'ANYT-HING'), false);
  });
});

test('an unknown account has nothing to spend either, and says nothing different', async () => {
  await withEnv(async () => {
    const recovery = require('../src/services/account-recovery-service');
    await seedAccounts();

    assert.equal(await recovery.getRemainingAccountCodeCount('no-such-user'), 0);
    assert.equal(await recovery.redeemAccountRecoveryCode('no-such-user', 'ANYT-HING'), false);
  });
});

test('running out of codes is a hard stop, not a fallback', async () => {
  await withEnv(async () => {
    const recovery = require('../src/services/account-recovery-service');
    await seedAccounts();
    const codes = await recovery.generateAccountRecoveryCodes('user-passwordless');

    for (const code of codes) {
      assert.equal(await recovery.redeemAccountRecoveryCode('user-passwordless', code), true);
    }

    assert.equal(await recovery.getRemainingAccountCodeCount('user-passwordless'), 0);
    // With none left the route refuses to start, so an admin has to step in.
    assert.equal(await recovery.redeemAccountRecoveryCode('user-passwordless', codes[0]), false);
  });
});

test('regenerating codes retires the old set', async () => {
  await withEnv(async () => {
    const recovery = require('../src/services/account-recovery-service');
    await seedAccounts();
    const first = await recovery.generateAccountRecoveryCodes('user-passwordless');
    const second = await recovery.generateAccountRecoveryCodes('user-passwordless');

    assert.equal(await recovery.redeemAccountRecoveryCode('user-passwordless', first[0]), false);
    assert.equal(await recovery.redeemAccountRecoveryCode('user-passwordless', second[0]), true);
  });
});

test('every recovery attempt is recorded', async () => {
  await withEnv(async () => {
    const recovery = require('../src/services/account-recovery-service');
    const { verifyAuditChain } = require('../src/services/audit-service');
    await seedAccounts();
    const codes = await recovery.generateAccountRecoveryCodes('user-passwordless');

    await recovery.redeemAccountRecoveryCode('user-passwordless', 'WRON-GCDE');
    await recovery.redeemAccountRecoveryCode('user-passwordless', codes[0]);

    const events = JSON.parse(await fs.readFile(process.env.AUDIT_STORE_PATH, 'utf8'));
    const types = events.map((entry) => entry.type);
    assert.ok(types.includes('auth.account.recovery-code.rejected'), 'a failed attempt is evidence too');
    assert.ok(types.includes('auth.account.recovery-code.redeemed'));

    const chain = await verifyAuditChain();
    assert.equal(chain.ok, true);
  });
});
