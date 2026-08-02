const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// The administrator's escape hatch for an account with no authenticator and no
// recovery codes left. The property that matters most is that the admin never
// gets hold of a credential — they authorise, the account holder acts.

const MODULES = [
  '../src/config',
  '../src/services/account-recovery-service',
  '../src/services/account-reenrolment-service',
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-reenrol-'));
  const previous = { ...process.env };
  process.env.NODE_ENV = 'development';
  process.env.USER_STORE_PATH = path.join(dir, 'users.json');
  process.env.ACCOUNT_RECOVERY_CODE_STORE_PATH = path.join(dir, 'account-codes.json');
  process.env.ACCOUNT_REENROLMENT_STORE_PATH = path.join(dir, 'grants.json');
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
      id: 'user-lockedout',
      email: 'lockedout@example.com',
      displayName: 'Locked Out',
      passwordHash: null,
      passwordless: true,
      passkeys: [],
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'user-healthy',
      email: 'healthy@example.com',
      displayName: 'Still Fine',
      passwordHash: null,
      passwordless: true,
      passkeys: [{ id: 'pk-1' }],
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'user-with-password',
      email: 'haspassword@example.com',
      displayName: 'Has Password',
      passwordHash: '$2a$12$notarealhash',
      passwordless: false,
      passkeys: [],
      createdAt: now,
      updatedAt: now
    }
  ];
  await fs.writeFile(process.env.USER_STORE_PATH, JSON.stringify(users, null, 2));
}

async function grantLinkFromMail(dir) {
  const files = (await fs.readdir(path.join(dir, 'mail'))).sort();
  const body = await fs.readFile(path.join(dir, 'mail', files[files.length - 1]), 'utf8');
  return /auth\/reenrol\/(\S+)/.exec(body)?.[1] || null;
}

test('the list shows only passwordless accounts, locked-out ones first', async () => {
  await withEnv(async () => {
    const recovery = require('../src/services/account-recovery-service');
    const reenrolment = require('../src/services/account-reenrolment-service');
    await seedAccounts();
    await recovery.generateAccountRecoveryCodes('user-healthy');

    const accounts = await reenrolment.listPasswordlessAccounts();
    assert.equal(accounts.length, 2, 'the password account is not listed');
    assert.equal(accounts.some((entry) => entry.email === 'haspassword@example.com'), false);

    // Whoever opens this page is here because someone is locked out.
    assert.equal(accounts[0].id, 'user-lockedout');
    assert.equal(accounts[0].lockedOut, true);
    assert.equal(accounts[0].remainingCodes, 0);
    assert.equal(accounts[1].lockedOut, false);
    assert.equal(accounts[1].remainingCodes, 10);
  });
});

test('authorising sends a link to the account holder, not the admin', async () => {
  await withEnv(async ({ dir }) => {
    const reenrolment = require('../src/services/account-reenrolment-service');
    await seedAccounts();

    const result = await reenrolment.grantReenrolment('user-lockedout', {
      actorEmail: 'admin@example.com',
      baseUrl: 'http://localhost:3000',
      reason: 'Verified on a video call'
    });
    assert.equal(result.delivered, true);

    const files = await fs.readdir(path.join(dir, 'mail'));
    const body = await fs.readFile(path.join(dir, 'mail', files[0]), 'utf8');
    // An admin who could read the token could take over the account.
    assert.match(body, /To: lockedout@example\.com/);
    assert.doesNotMatch(body, /admin@example\.com/);

    // The result handed back to the admin carries no token either.
    assert.deepEqual(Object.keys(result), ['delivered']);
  });
});

test('the grant token is stored only as a hash', async () => {
  await withEnv(async ({ dir }) => {
    const reenrolment = require('../src/services/account-reenrolment-service');
    await seedAccounts();
    await reenrolment.grantReenrolment('user-lockedout', { baseUrl: 'http://localhost:3000' });

    const token = await grantLinkFromMail(dir);
    const stored = await fs.readFile(path.join(dir, 'grants.json'), 'utf8');
    assert.equal(stored.includes(token), false);
  });
});

test('a grant is single use', async () => {
  await withEnv(async ({ dir }) => {
    const reenrolment = require('../src/services/account-reenrolment-service');
    await seedAccounts();
    await reenrolment.grantReenrolment('user-lockedout', { baseUrl: 'http://localhost:3000' });

    const token = await grantLinkFromMail(dir);
    const resolved = await reenrolment.resolveGrant(token);
    assert.equal(resolved.user.email, 'lockedout@example.com');

    assert.equal(await reenrolment.consumeGrant(resolved.grant.id), true);
    assert.equal(await reenrolment.consumeGrant(resolved.grant.id), false, 'cannot be spent twice');
    assert.equal(await reenrolment.resolveGrant(token), null);
  });
});

test('authorising again retires the previous link', async () => {
  await withEnv(async ({ dir }) => {
    const reenrolment = require('../src/services/account-reenrolment-service');
    await seedAccounts();

    await reenrolment.grantReenrolment('user-lockedout', { baseUrl: 'http://localhost:3000' });
    const first = await grantLinkFromMail(dir);
    await reenrolment.grantReenrolment('user-lockedout', { baseUrl: 'http://localhost:3000' });

    // Two live links would mean two chances for whoever intercepted one.
    assert.equal(await reenrolment.resolveGrant(first), null);
    assert.ok(await reenrolment.resolveGrant(await grantLinkFromMail(dir)));
  });
});

test('an account with a password is refused — it has the reset link instead', async () => {
  await withEnv(async () => {
    const reenrolment = require('../src/services/account-reenrolment-service');
    await seedAccounts();

    await assert.rejects(
      () => reenrolment.grantReenrolment('user-with-password', { baseUrl: 'http://localhost:3000' }),
      /has a password/
    );
  });
});

test('an unknown account is refused', async () => {
  await withEnv(async () => {
    const reenrolment = require('../src/services/account-reenrolment-service');
    await seedAccounts();
    await assert.rejects(() => reenrolment.grantReenrolment('no-such-user', {}), /not found/);
  });
});

test('a made-up token resolves to nothing rather than throwing', async () => {
  await withEnv(async () => {
    const reenrolment = require('../src/services/account-reenrolment-service');
    await seedAccounts();
    assert.equal(await reenrolment.resolveGrant('not-a-real-token'), null);
    assert.equal(await reenrolment.resolveGrant(''), null);
    assert.equal(await reenrolment.resolveGrant(undefined), null);
  });
});

test('who authorised it, and why, is on the record', async () => {
  await withEnv(async () => {
    const reenrolment = require('../src/services/account-reenrolment-service');
    const { verifyAuditChain } = require('../src/services/audit-service');
    await seedAccounts();

    await reenrolment.grantReenrolment('user-lockedout', {
      actorEmail: 'admin@example.com',
      baseUrl: 'http://localhost:3000',
      reason: 'Verified on a video call'
    });

    const events = JSON.parse(await fs.readFile(process.env.AUDIT_STORE_PATH, 'utf8'));
    const granted = events.find((entry) => entry.type === 'auth.account.reenrolment.granted');
    assert.ok(granted, 'authorising someone back into an account is evidence');
    assert.equal(granted.data.grantedBy, 'admin@example.com');
    assert.equal(granted.data.reason, 'Verified on a video call');

    const chain = await verifyAuditChain();
    assert.equal(chain.ok, true);
  });
});
