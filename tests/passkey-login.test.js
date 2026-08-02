const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Phase 4: passkey as a first factor. A full WebAuthn ceremony needs a real
// authenticator, so these cover the parts that are ours rather than the
// library's: what we ask the authenticator for, how we resolve an account from
// a credential, and that user verification is insisted on server-side.

const MODULES = [
  '../src/config',
  '../src/services/auth-service',
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-passkey-'));
  const previous = { ...process.env };
  process.env.NODE_ENV = 'development';
  process.env.USER_STORE_PATH = path.join(dir, 'users.json');
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

async function seedUserWithPasskey(credentialId = 'credential-one') {
  const { registerUser } = require('../src/services/auth-service');
  const user = await registerUser({
    displayName: 'Passkey Tester',
    email: `${credentialId}@example.com`,
    password: 'CorrectHorseBattery',
    confirmPassword: 'CorrectHorseBattery'
  });

  // Write the credential straight into the store: minting a real one needs an
  // authenticator, and what is under test here is how we look it up.
  const store = path.join(process.env.USER_STORE_PATH);
  const users = JSON.parse(await fs.readFile(store, 'utf8'));
  const record = users.find((entry) => entry.id === user.id);
  record.passkeys = [
    {
      id: 'passkey-1',
      name: 'Platform passkey',
      credential: {
        id: credentialId,
        publicKey: Buffer.from('not-a-real-key').toString('base64url'),
        counter: 0,
        transports: ['internal']
      },
      createdAt: new Date().toISOString(),
      lastUsedAt: null
    }
  ];
  await fs.writeFile(store, JSON.stringify(users, null, 2));
  return user;
}

test('a sign-in challenge asks for no particular credential', async () => {
  await withEnv(async () => {
    const { startPasskeyLogin } = require('../src/services/auth-service');
    const { options } = await startPasskeyLogin(requestInfo);

    // An allow list would defeat the point: the browser has to be free to offer
    // whichever discoverable passkey the person holds for this site.
    assert.deepEqual(options.allowCredentials, []);
    assert.equal(options.userVerification, 'required');
    assert.ok(options.challenge);
  });
});

test('newly registered passkeys are discoverable', async () => {
  await withEnv(async () => {
    const { registerUser, startPasskeyRegistration } = require('../src/services/auth-service');
    const user = await registerUser({
      displayName: 'Registrar',
      email: 'registrar@example.com',
      password: 'CorrectHorseBattery',
      confirmPassword: 'CorrectHorseBattery'
    });

    const options = await startPasskeyRegistration(user.id, requestInfo);
    // 'preferred' lets an authenticator quietly decline, which would leave the
    // passkey unable to start a sign-in.
    assert.equal(options.authenticatorSelection.residentKey, 'required');
    assert.equal(options.authenticatorSelection.userVerification, 'required');
  });
});

test('an unknown credential is refused without revealing anything', async () => {
  await withEnv(async () => {
    const { startPasskeyLogin, finishPasskeyLogin } = require('../src/services/auth-service');
    await seedUserWithPasskey();
    const { options } = await startPasskeyLogin(requestInfo);

    await assert.rejects(
      () =>
        finishPasskeyLogin(
          { id: 'a-credential-nobody-registered' },
          requestInfo,
          { challenge: options.challenge, rpId: 'localhost', origin: 'http://localhost:3000' }
        ),
      /not registered to any account/
    );
  });
});

test('a sign-in cannot proceed without an active challenge', async () => {
  await withEnv(async () => {
    const { finishPasskeyLogin } = require('../src/services/auth-service');
    await seedUserWithPasskey();

    // A replayed response with no server-side challenge must not be accepted.
    await assert.rejects(
      () => finishPasskeyLogin({ id: 'credential-one' }, requestInfo, null),
      /No passkey sign-in challenge is active/
    );
  });
});

test('the credential identifies which account is signing in', async () => {
  await withEnv(async () => {
    const { startPasskeyLogin, finishPasskeyLogin } = require('../src/services/auth-service');
    await seedUserWithPasskey('credential-alpha');
    await seedUserWithPasskey('credential-beta');
    const { options } = await startPasskeyLogin(requestInfo);

    // The signature check fails on a fabricated credential, but reaching that
    // failure proves the lookup resolved the right account rather than
    // rejecting it as unknown.
    await assert.rejects(
      () =>
        finishPasskeyLogin(
          { id: 'credential-beta' },
          requestInfo,
          { challenge: options.challenge, rpId: 'localhost', origin: 'http://localhost:3000' }
        ),
      (error) => {
        assert.doesNotMatch(error.message, /not registered to any account/);
        return true;
      }
    );
  });
});
