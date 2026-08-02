const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Creating an account with only a security key or passkey. The WebAuthn
// ceremony itself needs a real authenticator, so these cover what is ours: that
// a passwordless account cannot be signed into with a password, that nothing is
// written until the authenticator answers, and that the account has a way back
// in when the device is lost.

const MODULES = [
  '../src/config',
  '../src/services/auth-service',
  '../src/services/account-recovery-service',
  '../src/services/email-verification-service',
  '../src/services/sign-in-methods-service',
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-enrol-'));
  const previous = { ...process.env };
  process.env.NODE_ENV = 'development';
  process.env.USER_STORE_PATH = path.join(dir, 'users.json');
  process.env.ACCOUNT_RECOVERY_CODE_STORE_PATH = path.join(dir, 'account-codes.json');
  process.env.EMAIL_VERIFICATION_STORE_PATH = path.join(dir, 'verifications.json');
  process.env.SIGN_IN_METHOD_STORE_PATH = path.join(dir, 'methods.json');
  process.env.NOTIFICATION_SETTINGS_STORE_PATH = path.join(dir, 'notify.json');
  process.env.NOTIFICATION_LOG_STORE_PATH = path.join(dir, 'notify-log.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  process.env.MAIL_DROP_PATH = path.join(dir, 'mail');
  process.env.PASSKEY_RP_ID = 'localhost';
  process.env.PASSKEY_ORIGIN = 'http://localhost:3000';
  resetModules();
  try {
    await run({ dir });
  } finally {
    process.env = previous;
    resetModules();
  }
}

const requestInfo = { rpId: 'localhost', origin: 'http://localhost:3000' };

/** Write a passwordless account directly, standing in for a finished ceremony. */
async function seedPasswordlessAccount(email = 'nopassword@example.com') {
  const users = [
    {
      id: 'user-passwordless',
      email,
      displayName: 'Keyed Tester',
      passwordHash: null,
      passwordless: true,
      passkeys: [],
      emailVerifiedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];
  await fs.writeFile(process.env.USER_STORE_PATH, JSON.stringify(users, null, 2));
  return users[0];
}

test('a passwordless account cannot be signed into with a password', async () => {
  await withEnv(async () => {
    const { verifyUserPassword } = require('../src/services/auth-service');
    await seedPasswordlessAccount();

    // bcrypt.compare throws on a null hash, which would surface as a 500 and
    // mark the address out as passwordless. It has to fail closed and quietly.
    for (const attempt of ['', 'anything', 'null', 'undefined']) {
      assert.equal(await verifyUserPassword('nopassword@example.com', attempt), null);
    }
  });
});

test('enrolment is refused unless an admin has allowed it', async () => {
  await withEnv(async () => {
    const methods = require('../src/services/sign-in-methods-service');
    // Off by default: it changes who can obtain an account.
    assert.equal(await methods.isEnrolmentEnabled('passkey'), false);

    await methods.updateSignInMethods(
      {
        method_password_enabled: 'true',
        method_password_first: 'true',
        method_passkey_enabled: 'true',
        method_passkey_first: 'true',
        method_passkey_enrol: 'true'
      },
      'admin@example.com'
    );
    assert.equal(await methods.isEnrolmentEnabled('passkey'), true);
  });
});

test('enrolment cannot outlive the method it belongs to', async () => {
  await withEnv(async () => {
    const methods = require('../src/services/sign-in-methods-service');
    await methods.updateSignInMethods(
      {
        method_password_enabled: 'true',
        method_password_first: 'true',
        // Enrolment ticked, but the method itself switched off.
        method_passkey_enrol: 'true'
      },
      'admin@example.com'
    );
    assert.equal(await methods.isEnrolmentEnabled('passkey'), false);
  });
});

test('starting an enrolment writes no account', async () => {
  await withEnv(async () => {
    const { startPasswordlessRegistration } = require('../src/services/auth-service');
    const { options, pending } = await startPasswordlessRegistration(
      { displayName: 'Keyed Tester', email: 'keyed@example.com' },
      requestInfo
    );

    assert.equal(options.authenticatorSelection.residentKey, 'required');
    assert.equal(options.authenticatorSelection.userVerification, 'required');
    assert.equal(pending.email, 'keyed@example.com');

    // An abandoned ceremony must leave nothing behind.
    const users = JSON.parse(await fs.readFile(process.env.USER_STORE_PATH, 'utf8').catch(() => '[]'));
    assert.equal(users.length, 0);
  });
});

test('the user handle sent to the authenticator is not the email address', async () => {
  await withEnv(async () => {
    const { startPasswordlessRegistration } = require('../src/services/auth-service');
    const { options, pending } = await startPasswordlessRegistration(
      { displayName: 'Keyed Tester', email: 'keyed@example.com' },
      requestInfo
    );

    // The handle is stored on the authenticator and syncs between a person's
    // devices, so it must not carry personal data.
    const handle = Buffer.from(options.user.id, 'base64url').toString();
    assert.doesNotMatch(handle, /keyed@example\.com/);
    assert.equal(handle, pending.userHandle);
  });
});

test('an existing address cannot be enrolled again', async () => {
  await withEnv(async () => {
    const { startPasswordlessRegistration } = require('../src/services/auth-service');
    await seedPasswordlessAccount('taken@example.com');

    await assert.rejects(
      () => startPasswordlessRegistration({ displayName: 'Someone Else', email: 'taken@example.com' }, requestInfo),
      /already exists/
    );
  });
});

test('a bad address is refused before any ceremony starts', async () => {
  await withEnv(async () => {
    const { startPasswordlessRegistration } = require('../src/services/auth-service');
    await assert.rejects(
      () => startPasswordlessRegistration({ displayName: 'No Email', email: 'not-an-address' }, requestInfo),
      (error) => {
        assert.equal(error.status, 422);
        assert.ok(error.details.errors.email);
        return true;
      }
    );
  });
});

test('finishing without an active challenge is refused', async () => {
  await withEnv(async () => {
    const { finishPasswordlessRegistration } = require('../src/services/auth-service');
    await assert.rejects(
      () => finishPasswordlessRegistration({ id: 'whatever' }, requestInfo, null),
      /No enrolment challenge is active/
    );
  });
});

test('recovery codes are the way back in, and are never stored in plaintext', async () => {
  await withEnv(async ({ dir }) => {
    const recovery = require('../src/services/account-recovery-service');
    const user = await seedPasswordlessAccount();

    const codes = await recovery.generateAccountRecoveryCodes(user.id);
    assert.equal(codes.length, 10);
    assert.equal(await recovery.getRemainingAccountCodeCount(user.id), 10);

    const stored = await fs.readFile(path.join(dir, 'account-codes.json'), 'utf8');
    for (const code of codes) {
      assert.equal(stored.includes(code), false, 'a leaked store must not hand over account access');
    }

    // Single use: a code read over someone's shoulder is worth one attempt.
    assert.equal(await recovery.redeemAccountRecoveryCode(user.id, codes[0]), true);
    assert.equal(await recovery.redeemAccountRecoveryCode(user.id, codes[0]), false);
    assert.equal(await recovery.getRemainingAccountCodeCount(user.id), 9);

    assert.equal(await recovery.redeemAccountRecoveryCode(user.id, 'ZZZZ-ZZZZ'), false);
  });
});

test('recovery codes tolerate the spacing and case people actually type', async () => {
  await withEnv(async () => {
    const recovery = require('../src/services/account-recovery-service');
    const user = await seedPasswordlessAccount();
    const codes = await recovery.generateAccountRecoveryCodes(user.id);

    const typed = codes[0].toLowerCase().replace('-', ' ');
    assert.equal(await recovery.redeemAccountRecoveryCode(user.id, typed), true);
  });
});

test('the email must be confirmed, and the link works exactly once', async () => {
  await withEnv(async ({ dir }) => {
    const verification = require('../src/services/email-verification-service');
    const user = await seedPasswordlessAccount();

    await verification.sendVerificationEmail(user, { baseUrl: 'http://localhost:3000' });

    const files = await fs.readdir(path.join(dir, 'mail'));
    const body = await fs.readFile(path.join(dir, 'mail', files[0]), 'utf8');
    const token = /auth\/verify-email\/(\S+)/.exec(body)?.[1];
    assert.ok(token, 'a confirmation link was sent');

    const stored = await fs.readFile(path.join(dir, 'verifications.json'), 'utf8');
    assert.equal(stored.includes(token), false, 'the token is stored only as a hash');

    const confirmed = await verification.confirmVerificationToken(token);
    assert.equal(confirmed.email, 'nopassword@example.com');

    const users = JSON.parse(await fs.readFile(process.env.USER_STORE_PATH, 'utf8'));
    assert.ok(users[0].emailVerifiedAt);

    assert.equal(await verification.confirmVerificationToken(token), null, 'single use');
    assert.equal(await verification.confirmVerificationToken('made-up'), null);
  });
});
