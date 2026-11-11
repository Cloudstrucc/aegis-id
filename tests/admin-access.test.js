const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Who reaches the platform administration area.
//
// Sign-in methods, notification delivery, wallet revocation and registration
// codes are deployment-wide, and so are the registers that list every wallet,
// domain and delivered message on the installation. Reaching them is a
// privilege boundary, not a nicety.
//
// Three populations sign in. A credential holder exists only because an
// organization invited them, and gets a placeholder subscription so they have
// somewhere to land — they must never get in, which is what most of this file
// proves and what it has always proved. A subscriber bought a plan and
// administers their own organizations — organization scope, not this. And the
// deployment operator runs the installation.
//
// The tests below were written when the gate admitted the first two groups,
// and they still pass: on a deployment with one administering subscriber, that
// subscriber *is* the operator, which is what the grandfather rule says. The
// cases that separate the two are at the end of the file.

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
    await assert.rejects(() => access.assertAdminOperations(HOLDER), /operator of this deployment/);
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
    await assert.rejects(() => access.assertAdminOperations(null), /operator of this deployment/);
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

// --- operator, as distinct from subscriber ---------------------------------

const SECOND_SUBSCRIBER = { id: 'user-second', email: 'second@example.com' };

async function administeringSubscriber(platform, subscriptions, user, organization) {
  const subscription = await subscriptions.createSubscription(
    { organization, consent: 'yes', plan: 'pro' },
    user
  );
  await platform.registerWorkspaceForSubscription(subscription, {
    organization,
    role: 'administrator'
  });
  return subscription;
}

test('a second subscriber on the same deployment is not the operator', async () => {
  await withEnv(async ({ access, platform, subscriptions }) => {
    // This is the case the gate was wrong about, and it is what a hosted
    // deployment is: two customers who have each bought a plan. The second one
    // could read the first one's wallets and delivered messages.
    await administeringSubscriber(platform, subscriptions, SUBSCRIBER, 'First Co');
    await administeringSubscriber(platform, subscriptions, SECOND_SUBSCRIBER, 'Second Co');

    assert.equal(await access.canViewAdminOperations(SUBSCRIBER), true);
    assert.equal(await access.canViewAdminOperations(SECOND_SUBSCRIBER), false);
    await assert.rejects(
      () => access.assertAdminOperations(SECOND_SUBSCRIBER),
      /operator of this deployment/
    );
  });
});

test('a configured operator list decides it outright', async () => {
  process.env.PLATFORM_OPERATOR_EMAILS = 'second@example.com';
  try {
    await withEnv(async ({ access, platform, subscriptions }) => {
      await administeringSubscriber(platform, subscriptions, SUBSCRIBER, 'First Co');
      await administeringSubscriber(platform, subscriptions, SECOND_SUBSCRIBER, 'Second Co');

      // Nothing is inferred once the deployment has said. The oldest
      // subscription is no longer special, and the named account does not need
      // to be the oldest — or, below, to own anything at all.
      assert.equal(await access.canViewAdminOperations(SUBSCRIBER), false);
      assert.equal(await access.canViewAdminOperations(SECOND_SUBSCRIBER), true);
    });
  } finally {
    delete process.env.PLATFORM_OPERATOR_EMAILS;
  }
});

test('a configured operator does not have to be a subscriber', async () => {
  process.env.PLATFORM_OPERATOR_EMAILS = 'ops@example.com, Other@Example.com';
  try {
    await withEnv(async ({ access, platform, subscriptions }) => {
      await administeringSubscriber(platform, subscriptions, SUBSCRIBER, 'First Co');

      // Whoever runs the installation need not have bought anything on it.
      // Matched case-insensitively, because an address is not case-sensitive
      // and a capitalised entry in an app setting should not silently fail.
      assert.equal(await access.canViewAdminOperations({ id: 'u1', email: 'ops@example.com' }), true);
      assert.equal(await access.canViewAdminOperations({ id: 'u2', email: 'other@example.com' }), true);
      assert.equal(await access.canViewAdminOperations(SUBSCRIBER), false);
    });
  } finally {
    delete process.env.PLATFORM_OPERATOR_EMAILS;
  }
});

test('an invited holder is still out, configured or not', async () => {
  process.env.PLATFORM_OPERATOR_EMAILS = 'ops@example.com';
  try {
    await withEnv(async ({ access, subscriptions }) => {
      await subscriptions.ensureAccountAccessSubscription(HOLDER);
      assert.equal(await access.canViewAdminOperations(HOLDER), false);
    });
  } finally {
    delete process.env.PLATFORM_OPERATOR_EMAILS;
  }
});
