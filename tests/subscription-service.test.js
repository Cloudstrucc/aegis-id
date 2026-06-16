const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('subscriptions are owned by the authenticated user that created them', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vanguard-subscriptions-'));
  const previousSubscriptionStorePath = process.env.SUBSCRIPTION_STORE_PATH;
  process.env.SUBSCRIPTION_STORE_PATH = path.join(tempDir, 'subscriptions.json');
  resetModules();

  t.after(() => {
    restoreEnv('SUBSCRIPTION_STORE_PATH', previousSubscriptionStorePath);
    resetModules();
  });

  const {
    createSubscription,
    getSubscriptionForUser,
    listSubscriptionsForUser
  } = require('../src/services/subscription-service');

  const owner = { id: 'user-1', email: 'owner@vanguardcs.ca' };
  const otherUser = { id: 'user-2', email: 'other@vanguardcs.ca' };
  const subscription = await createSubscription(
    {
      organization: 'Vanguard Pilot Org',
      role: 'administrator',
      plan: 'pilot',
      interest: 'both',
      consent: 'yes'
    },
    owner
  );

  assert.equal(subscription.userId, owner.id);
  assert.equal(subscription.email, owner.email);
  assert.equal(subscription.source, 'authenticated-subscription');
  assert.equal((await getSubscriptionForUser(subscription.id, owner)).id, subscription.id);
  assert.equal(await getSubscriptionForUser(subscription.id, otherUser), null);
  assert.deepEqual(await listSubscriptionsForUser(otherUser), []);
  assert.equal((await listSubscriptionsForUser(owner)).length, 1);
});

function resetModules() {
  for (const modulePath of ['../src/config', '../src/services/subscription-service']) {
    delete require.cache[require.resolve(modulePath)];
  }
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
