const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Who reaches the platform administration area.
//
// The distinction that matters: a subscriber bought a plan and administers
// their own organizations, while a credential holder exists only because an
// organization invited them. Both sign in, and both get a subscription record —
// but the holder's is a placeholder created so they have somewhere to land.
//
// Sign-in methods, notification delivery, wallet revocation and registration
// codes are platform-wide. An invited holder reaching those would be able to
// change how everybody signs in, so this is a privilege boundary, not a
// nicety.

const MODULES = [
  '../src/config',
  '../src/services/admin-access-service',
  '../src/services/platform-service',
  '../src/services/org-admin-service',
  '../src/services/subscription-service',
  '../src/services/audit-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-admin-access-'));
  const previous = { ...process.env };
  process.env.SUBSCRIPTION_STORE_PATH = path.join(dir, 'subs.json');
  process.env.SUBSCRIBER_WORKSPACE_STORE_PATH = path.join(dir, 'ws.json');
  process.env.ORG_ADMIN_STORE_PATH = path.join(dir, 'oa.json');
  process.env.ORG_ADMIN_EVENT_STORE_PATH = path.join(dir, 'oae.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  resetModules();
  try {
    await run({
      access: require('../src/services/admin-access-service'),
      platform: require('../src/services/platform-service'),
      subscriptions: require('../src/services/subscription-service')
    });
  } finally {
    process.env = previous;
    resetModules();
  }
}

const SUBSCRIBER = { id: 'user-sub', email: 'owner@example.com' };
const HOLDER = { id: 'user-holder', email: 'holder@example.com' };

test('a subscriber who administers their own organization gets in', async () => {
  await withEnv(async ({ access, platform, subscriptions }) => {
    const subscription = await subscriptions.createSubscription(
      { organization: 'Owner Co', consent: 'yes', plan: 'pro' },
      SUBSCRIBER
    );
    await platform.registerWorkspaceForSubscription(subscription, {
      organization: 'Owner Co',
      role: 'administrator'
    });

    assert.equal(await access.canViewAdminOperations(SUBSCRIBER), true);
    await access.assertAdminOperations(SUBSCRIBER);
  });
});

test('an invited credential holder never gets in', async () => {
  await withEnv(async ({ access, platform, subscriptions }) => {
    // The subscriber's own organization exists...
    const owned = await subscriptions.createSubscription(
      { organization: 'Owner Co', consent: 'yes', plan: 'pro' },
      SUBSCRIBER
    );
    await platform.registerWorkspaceForSubscription(owned, {
      organization: 'Owner Co',
      role: 'administrator'
    });

    // ...and someone they invited signs in. Their record is the placeholder
    // that exists purely so they have somewhere to land.
    const placeholder = await subscriptions.ensureAccountAccessSubscription(HOLDER);
    assert.equal(subscriptions.isAccountAccessSubscription(placeholder), true);

    assert.equal(await access.canViewAdminOperations(HOLDER), false);
    await assert.rejects(() => access.assertAdminOperations(HOLDER), /subscribers who administer/);
  });
});

test('a placeholder record is not a way in, even with a workspace attached', async () => {
  await withEnv(async ({ access, platform, subscriptions }) => {
    const placeholder = await subscriptions.ensureAccountAccessSubscription(HOLDER);

    // Even if a workspace ends up hanging off the placeholder — which is what
    // a credential membership looks like from this angle — it must not count.
    // The record is filtered out before workspaces are even looked at.
    await platform.registerWorkspaceForSubscription(placeholder, {
      organization: 'Someone Elses Co',
      role: 'administrator'
    });

    assert.equal(await access.canViewAdminOperations(HOLDER), false);
  });
});

test('a subscriber with no organization yet is not an administrator of anything', async () => {
  await withEnv(async ({ access, subscriptions }) => {
    await subscriptions.createSubscription(
      { organization: 'Nothing Yet Co', consent: 'yes', plan: 'trial' },
      SUBSCRIBER
    );
    // Bought a plan, never registered an organization. Nothing to administer.
    assert.equal(await access.canViewAdminOperations(SUBSCRIBER), false);
  });
});

test('signed out is refused', async () => {
  await withEnv(async ({ access }) => {
    assert.equal(await access.canViewAdminOperations(null), false);
    assert.equal(await access.canViewAdminOperations(undefined), false);
    await assert.rejects(() => access.assertAdminOperations(null), /subscribers who administer/);
  });
});

test('every admin route is behind the same gate', () => {
  // The dashboard links to each of these, so a policy drifting to a weaker type
  // would turn the index into a way to reach something it should not.
  const { getPolicy } = require('../src/services/authorization-service');
  const adminPolicies = [
    'admin.dashboard.view',
    'admin.wallets.manage',
    'admin.registrationCodes.manage',
    'admin.signInMethods.manage',
    'admin.notifications.manage',
    'admin.accountRecovery.manage'
  ];

  for (const policyId of adminPolicies) {
    assert.equal(getPolicy(policyId)?.type, 'adminAnyWorkspace', `${policyId} is not admin-gated`);
  }
});
