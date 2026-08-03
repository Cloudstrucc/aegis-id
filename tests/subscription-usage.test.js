const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Phase 2: several workspaces under one subscription, and the usage figures a
// customer is shown.
//
// The property that matters most is isolation — a credential issued in one
// workspace must not count against another — because the whole point of Pro is
// two organizations with separate allowances.

const MODULES = [
  '../src/config',
  '../src/services/platform-service',
  '../src/services/org-admin-service',
  '../src/services/plan-service',
  '../src/services/subscription-usage-service',
  '../src/services/wallet-registry-service',
  '../src/services/audit-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-usage-'));
  const previous = { ...process.env };
  process.env.SUBSCRIPTION_STORE_PATH = path.join(dir, 'subs.json');
  process.env.SUBSCRIBER_WORKSPACE_STORE_PATH = path.join(dir, 'ws.json');
  process.env.ORG_ADMIN_STORE_PATH = path.join(dir, 'oa.json');
  process.env.ORG_ADMIN_EVENT_STORE_PATH = path.join(dir, 'oae.json');
  process.env.WALLET_STORE_PATH = path.join(dir, 'wallets.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  resetModules();
  try {
    await run({
      platform: require('../src/services/platform-service'),
      orgAdmin: require('../src/services/org-admin-service'),
      usage: require('../src/services/subscription-usage-service')
    });
  } finally {
    process.env = previous;
    resetModules();
  }
}

function subscriptionFor(plan, billingStatus = 'active') {
  return {
    id: `sub-${plan}`,
    email: `${plan}@example.com`,
    organization: `${plan} Co`,
    plan,
    billingStatus,
    createdAt: new Date().toISOString()
  };
}

async function issue(orgAdmin, workspace, subscription, count, prefix) {
  for (let index = 0; index < count; index += 1) {
    await orgAdmin.issueCredential(workspace, subscription, {
      holderEmail: `${prefix}${index}@example.com`,
      displayName: `${prefix}${index}`
    });
  }
}

test('two workspaces under one subscription get separate credential allowances', async () => {
  await withEnv(async ({ platform, orgAdmin, usage }) => {
    const pro = subscriptionFor('pro');
    const first = await platform.registerWorkspaceForSubscription(pro, { organization: 'Pro One' });
    const second = await platform.registerWorkspaceForSubscription(pro, { organization: 'Pro Two' });

    assert.notEqual(first.id, second.id, 'each workspace has its own id');

    // Fill the first to its limit; the second must be unaffected.
    await issue(orgAdmin, first, pro, 20, 'a');
    await assert.rejects(() => issue(orgAdmin, first, pro, 1, 'overflow'), /credential limit/);

    await issue(orgAdmin, second, pro, 20, 'b');

    const summary = await usage.summarizeUsage(pro);
    assert.equal(summary.workspacesUsed, 2);
    assert.equal(summary.totalCredentials, 40);
    for (const workspace of summary.workspaces) {
      assert.equal(workspace.credentialsUsed, 20);
      assert.equal(workspace.credentialLimit, 20);
      assert.equal(workspace.atCapacity, true);
    }
  });
});

test('usage reports remaining capacity for a partly used plan', async () => {
  await withEnv(async ({ platform, orgAdmin, usage }) => {
    const basic = subscriptionFor('basic');
    const workspace = await platform.registerWorkspaceForSubscription(basic, { organization: 'Basic Co' });
    await issue(orgAdmin, workspace, basic, 7, 'c');

    const summary = await usage.summarizeUsage(basic);
    assert.equal(summary.workspacesUsed, 1);
    assert.equal(summary.workspacesRemaining, 0, 'Basic includes one organization');
    assert.equal(summary.canAddWorkspace, false);
    assert.equal(summary.workspaces[0].credentialsUsed, 7);
    assert.equal(summary.workspaces[0].credentialsRemaining, 13);
    assert.equal(summary.workspaces[0].atCapacity, false);
  });
});

test('a metered plan reports what is billable rather than a ceiling', async () => {
  await withEnv(async ({ platform, orgAdmin, usage }) => {
    const metered = subscriptionFor('metered');
    const workspace = await platform.registerWorkspaceForSubscription(metered, { organization: 'Metered Co' });
    await issue(orgAdmin, workspace, metered, 10, 'd');

    const summary = await usage.summarizeUsage(metered);
    assert.equal(summary.workspaces[0].credentialLimit, null, 'no ceiling');
    assert.equal(summary.workspaces[0].atCapacity, false, 'metered is never at capacity');
    assert.equal(summary.includedCredentials, 3);
    assert.equal(summary.billableCredentials, 7, '10 issued, 3 included');
    assert.equal(summary.estimatedOverageCents, 7 * 500);
  });
});

test('a lapsed plan is reported as limited by standing, not silently', async () => {
  await withEnv(async ({ platform, orgAdmin, usage }) => {
    const lapsed = subscriptionFor('pro', 'canceled');
    const workspace = await platform.registerWorkspaceForSubscription(lapsed, { organization: 'Lapsed Co' });
    await issue(orgAdmin, workspace, lapsed, 3, 'e');

    const summary = await usage.summarizeUsage(lapsed);
    assert.equal(summary.isLimitedByStanding, true);
    assert.equal(summary.standing, 'lapsed');
    assert.equal(summary.plan.id, 'trial', 'trial limits are in effect');
    assert.equal(summary.signedUpFor.id, 'pro', 'but what they bought is still known');
    // What exists keeps working; only the next one is blocked.
    assert.equal(summary.workspaces[0].credentialsUsed, 3);
    assert.equal(summary.workspaces[0].credentialsRemaining, 2);
  });
});

test('enterprise reports no ceilings at all', async () => {
  await withEnv(async ({ platform, usage }) => {
    const enterprise = subscriptionFor('enterprise');
    for (const name of ['One', 'Two', 'Three', 'Four']) {
      await platform.registerWorkspaceForSubscription(enterprise, { organization: `Ent ${name}` });
    }

    const summary = await usage.summarizeUsage(enterprise);
    assert.equal(summary.workspacesUsed, 4);
    assert.equal(summary.workspaceLimit, null);
    assert.equal(summary.workspacesRemaining, null);
    assert.equal(summary.canAddWorkspace, true);
  });
});

test('re-registering an existing organization is not a new workspace', async () => {
  await withEnv(async ({ platform, usage }) => {
    const basic = subscriptionFor('basic');
    await platform.registerWorkspaceForSubscription(basic, { organization: 'Basic Co' });
    // At the limit — but opening the one they already have must still work,
    // or a Basic customer could never reach their own organization again.
    const again = await platform.registerWorkspaceForSubscription(basic, { organization: 'Basic Co' });
    assert.ok(again);

    const summary = await usage.summarizeUsage(basic);
    assert.equal(summary.workspacesUsed, 1);
  });
});
