const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// What the signed-in landing page is built from.
//
// It is the first page somebody sees after registering, and for a while it
// showed them a heading, two buttons that went to the same form, and nothing
// else — no statement of what an organization is for, and no mention of what
// their plan would allow. The three states below are the ones that exist:
// nothing yet, organizations of your own, and organizations that invited you.

const MODULES = [
  '../src/config',
  '../src/services/account-landing-service',
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-account-landing-'));
  const previous = { ...process.env };
  process.env.SUBSCRIPTION_STORE_PATH = path.join(dir, 'subs.json');
  process.env.SUBSCRIBER_WORKSPACE_STORE_PATH = path.join(dir, 'ws.json');
  process.env.ORG_ADMIN_STORE_PATH = path.join(dir, 'oa.json');
  process.env.ORG_ADMIN_EVENT_STORE_PATH = path.join(dir, 'oae.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  resetModules();
  try {
    await run({
      landing: require('../src/services/account-landing-service'),
      platform: require('../src/services/platform-service'),
      orgAdmin: require('../src/services/org-admin-service'),
      subscriptions: require('../src/services/subscription-service')
    });
  } finally {
    process.env = previous;
    resetModules();
  }
}

const NEWCOMER = { id: 'user-new', email: 'new@example.com', displayName: 'New Person' };
const OWNER = { id: 'user-owner', email: 'owner@example.com', displayName: 'Owner Person' };
const HOLDER = { id: 'user-holder', email: 'holder@example.com', displayName: 'Holder Person' };

test('somebody who has just registered is told what a plan would give them', async () => {
  await withEnv(async ({ landing }) => {
    const { view } = await landing.buildAccountLanding(NEWCOMER);

    assert.equal(view.hasOrganizations, false);
    assert.equal(view.hasMemberships, false);

    // There is no subscription to read a limit from, so the page describes the
    // plan creating one would start — and says so, rather than claiming a plan
    // this person has not got.
    assert.equal(view.entitlement.isProspective, true);
    assert.equal(view.entitlement.planLabel, 'Trial');
    assert.equal(view.entitlement.standingLabel, 'Not started');

    const labels = view.entitlement.rows.map((row) => row.label);
    assert.deepEqual(labels, ['Organizations', 'Credentials', 'Your own domain', 'Price']);

    // The page is otherwise empty for this person, so the explanation is the
    // page. Losing it is the regression that put them back where they started.
    assert.ok(view.capabilities.length >= 4);
    for (const capability of view.capabilities) {
      assert.ok(capability.title && capability.body && capability.icon);
    }
  });
});

test('an organization you administer carries its own plan and standing', async () => {
  await withEnv(async ({ landing, platform, subscriptions }) => {
    const subscription = await subscriptions.createSubscription(
      { organization: 'Owner Co', consent: 'yes', plan: 'trial' },
      OWNER
    );
    await platform.registerWorkspaceForSubscription(subscription, {
      organization: 'Owner Co',
      role: 'administrator'
    });

    const { view } = await landing.buildAccountLanding(OWNER);

    assert.equal(view.hasOrganizations, true);
    assert.equal(view.organizations.length, 1);
    assert.equal(view.organizations[0].subscription.organization, 'Owner Co');
    assert.equal(view.organizations[0].mark, 'O');
    assert.equal(view.organizations[0].planLabel, 'Trial');
    assert.equal(view.organizations[0].workspaceSummary, '1 workspace');

    assert.equal(view.entitlement.isProspective, false);
    assert.equal(view.entitlement.organizationName, 'Owner Co');

    // Usage against the limit, not just the limit: "may I create another?"
    // is the question, and "1 organization" does not answer it. Drawn as a
    // meter rather than listed, because it is the one figure on this panel
    // that moves — and the list below it does not repeat what the meter says.
    assert.deepEqual(view.entitlement.capacity, { label: '1 of 1', percent: 100, isFull: true });
    assert.equal(
      view.entitlement.rows.some((row) => row.label === 'Organizations'),
      false,
      'the organizations row is duplicating the meter'
    );
    assert.match(view.entitlement.createNote, /Compare plans/);
  });
});

test('a lapsed paid plan says which plan is in effect and which was bought', async () => {
  await withEnv(async ({ landing, platform, subscriptions }) => {
    const subscription = await subscriptions.createSubscription(
      { organization: 'Owner Co', consent: 'yes', plan: 'pro' },
      OWNER
    );
    await platform.registerWorkspaceForSubscription(subscription, { organization: 'Owner Co' });

    // What Stripe would have written on a subscription that stopped paying.
    const store = require('../src/services/subscription-service');
    const all = await store.listSubscriptions();
    all.find((record) => record.id === subscription.id).billingStatus = 'canceled';
    await fs.writeFile(process.env.SUBSCRIPTION_STORE_PATH, JSON.stringify(all), 'utf8');
    resetModules();

    const { view } = await require('../src/services/account-landing-service').buildAccountLanding(OWNER);

    assert.equal(view.entitlement.planLabel, 'Trial');
    assert.equal(view.entitlement.signedUpForLabel, 'Pro');
    assert.equal(view.entitlement.standingLabel, 'Lapsed');
  });
});

test('organizations that invited you are listed separately, one tile each', async () => {
  await withEnv(async ({ landing, platform, orgAdmin, subscriptions }) => {
    const issuer = await subscriptions.createSubscription(
      { organization: 'Northwind', consent: 'yes', plan: 'pro' },
      OWNER
    );
    const workspace = await platform.registerWorkspaceForSubscription(issuer, {
      organization: 'Northwind',
      role: 'administrator'
    });

    // Two credentials in the same organization — an employee badge and a
    // contractor badge is an ordinary thing to hold — which must read as one
    // company rather than two.
    await orgAdmin.issueCredential(workspace, issuer, {
      holderEmail: HOLDER.email,
      displayName: HOLDER.displayName,
      personType: 'employee'
    });
    await orgAdmin.issueCredential(workspace, issuer, {
      holderEmail: HOLDER.email,
      displayName: HOLDER.displayName,
      personType: 'contractor'
    });

    const { view } = await landing.buildAccountLanding(HOLDER);

    assert.equal(view.hasMemberships, true);
    assert.equal(view.memberships.length, 1);
    assert.equal(view.memberships[0].organizationName, 'Northwind');
    assert.equal(view.memberships[0].credentialSummary, '2 credentials');
    assert.equal(view.memberships[0].statusLabel, 'Invited');

    // They are not organizations this person administers, so they are not in
    // that list — the difference between holding a credential and running the
    // place is the whole point of the two sections.
    assert.equal(view.hasOrganizations, false);
  });
});

test('a credential holder is no longer sent past this page', async () => {
  await withEnv(async ({ landing, platform, orgAdmin, subscriptions }) => {
    const issuer = await subscriptions.createSubscription(
      { organization: 'Northwind', consent: 'yes', plan: 'pro' },
      OWNER
    );
    const workspace = await platform.registerWorkspaceForSubscription(issuer, {
      organization: 'Northwind'
    });
    await orgAdmin.issueCredential(workspace, issuer, {
      holderEmail: HOLDER.email,
      displayName: HOLDER.displayName,
      personType: 'employee'
    });

    const result = await landing.buildAccountLanding(HOLDER);

    // It used to redirect a holder who owned no subscription straight into
    // their organization, which also took away the only route they had to
    // create one of their own.
    assert.equal(result.redirectTo, undefined);
    assert.ok(result.view);
    assert.equal(result.view.hasMemberships, true);
  });
});
