const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Phase 5: taking payment.
//
// The governing rule is that **Stripe is the source of truth for billing**. Our
// billingStatus is a cache of what Stripe says, written only by a signature-
// verified webhook or by reading the API back. The tests that matter are
// therefore about what happens when the browser lies, when a webhook is forged,
// and when events arrive in the wrong order.

const MODULES = [
  '../src/config',
  '../src/services/billing-service',
  '../src/services/subscription-service',
  '../src/services/plan-service',
  '../src/services/audit-service'
];

const WEBHOOK_SECRET = 'whsec_test_secret_for_the_suite';

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(run, { stripeKey = 'sk_test_suite' } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-billing-'));
  const previous = { ...process.env };
  process.env.APP_ENV = 'dev';
  process.env.STRIPE_SECRET_KEY = stripeKey;
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.CHECKOUT_SESSION_STORE_PATH = path.join(dir, 'checkouts.json');
  process.env.SUBSCRIPTION_STORE_PATH = path.join(dir, 'subs.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  resetModules();
  try {
    await run({
      dir,
      billing: require('../src/services/billing-service'),
      subscriptions: require('../src/services/subscription-service')
    });
  } finally {
    process.env = previous;
    resetModules();
  }
}

/**
 * A stub standing in for the Stripe SDK, except for `webhooks`, which is the
 * real implementation — signature verification is the one thing that must not
 * be faked.
 */
function stripeStub({ sessions = {}, subscriptions = {} } = {}) {
  const Stripe = require('stripe');
  const real = new Stripe('sk_test_suite');
  const created = [];

  return {
    created,
    webhooks: real.webhooks,
    checkout: {
      sessions: {
        async create(params) {
          const session = {
            id: `cs_test_${created.length + 1}`,
            url: 'https://checkout.stripe.com/c/pay/cs_test',
            ...params
          };
          created.push(session);
          return session;
        },
        async retrieve(id) {
          if (!sessions[id]) {
            throw new Error(`no stubbed session ${id}`);
          }
          return sessions[id];
        }
      }
    },
    subscriptions: {
      async retrieve(id) {
        if (!subscriptions[id]) {
          throw new Error(`no stubbed subscription ${id}`);
        }
        return subscriptions[id];
      }
    }
  };
}

/** A properly signed webhook, the way Stripe sends one. */
function signedWebhook(event) {
  const payload = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return { body: Buffer.from(payload), header: `t=${timestamp},v1=${signature}` };
}

function completedSession(overrides = {}) {
  return {
    id: 'cs_test_1',
    object: 'checkout.session',
    status: 'complete',
    payment_status: 'paid',
    client_reference_id: 'handle-1',
    customer: 'cus_123',
    subscription: 'sub_123',
    customer_details: { email: 'buyer@example.com' },
    metadata: { planId: 'pro', handle: 'handle-1' },
    ...overrides
  };
}

async function seedSubscription(subscriptions, overrides = {}) {
  const record = await subscriptions.createSubscription(
    { organization: 'Payer Co', consent: 'yes', plan: 'pro' },
    { id: 'user-1', email: 'buyer@example.com' },
    { via: 'payment', confirmed: true, stripeCustomerId: 'cus_123', stripeSubscriptionId: 'sub_123' }
  );
  if (Object.keys(overrides).length) {
    await subscriptions.applyBillingUpdate((entry) => entry.id === record.id, overrides);
  }
  return record;
}

test('a forged webhook is rejected', async () => {
  await withEnv(async ({ billing }) => {
    billing.setStripeClientForTesting(stripeStub());
    const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: completedSession() } };
    const payload = Buffer.from(JSON.stringify(event));

    // No signature at all.
    await assert.rejects(() => billing.handleWebhook(payload, undefined));

    // A signature computed with the wrong secret. This is the whole security
    // boundary: without it, anyone can tell us who has paid.
    const timestamp = Math.floor(Date.now() / 1000);
    const wrong = crypto.createHmac('sha256', 'whsec_not_the_secret')
      .update(`${timestamp}.${payload}`)
      .digest('hex');
    await assert.rejects(() => billing.handleWebhook(payload, `t=${timestamp},v1=${wrong}`));

    // And nothing was written.
    assert.equal(await billing.getCheckout('handle-1'), null);
  });
});

test('a signed completion marks the checkout paid', async () => {
  await withEnv(async ({ billing }) => {
    billing.setStripeClientForTesting(stripeStub());
    const { body, header } = signedWebhook({
      id: 'evt_1',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: { object: completedSession() }
    });

    const result = await billing.handleWebhook(body, header);
    assert.equal(result.type, 'checkout.session.completed');

    const checkout = await billing.getCheckout('handle-1');
    assert.equal(checkout.status, 'paid');
    assert.equal(checkout.planId, 'pro');
    assert.equal(checkout.stripeSubscriptionId, 'sub_123');
    assert.equal(checkout.stripeCustomerId, 'cus_123');
  });
});

test('a repeated webhook is harmless', async () => {
  await withEnv(async ({ billing }) => {
    billing.setStripeClientForTesting(stripeStub());
    const event = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: { object: completedSession() }
    };

    // Stripe retries until it gets a 2xx, so this happens routinely.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { body, header } = signedWebhook(event);
      await billing.handleWebhook(body, header);
    }

    const records = JSON.parse(await fs.readFile(process.env.CHECKOUT_SESSION_STORE_PATH, 'utf8'));
    assert.equal(records.length, 1, 'upserted, not appended');
    assert.equal(records[0].status, 'paid');
  });
});

test('an unpaid session is not treated as paid', async () => {
  await withEnv(async ({ billing }) => {
    billing.setStripeClientForTesting(stripeStub());
    const { body, header } = signedWebhook({
      id: 'evt_1',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: { object: completedSession({ payment_status: 'unpaid', status: 'open' }) }
    });

    await billing.handleWebhook(body, header);
    assert.equal(await billing.getCheckout('handle-1'), null);
  });
});

test('the return page confirms with Stripe rather than believing the browser', async () => {
  await withEnv(async ({ billing }) => {
    const stub = stripeStub({
      sessions: { cs_test_1: completedSession({ subscription: { id: 'sub_123', status: 'active' } }) }
    });
    billing.setStripeClientForTesting(stub);

    const checkout = await billing.startCheckout({
      planId: 'pro',
      returnBaseUrl: 'https://example.test'
    });
    assert.equal((await billing.getCheckout(checkout.handle)).status, 'pending');

    // The customer lands back before the webhook. Reading Stripe directly is
    // what stops them either waiting or being taken at their word.
    const confirmed = await billing.confirmCheckout(checkout.handle);
    assert.equal(confirmed.status, 'paid');
    assert.equal(confirmed.stripeSubscriptionId, 'sub_123');
  });
});

test('a checkout that Stripe says is unpaid stays pending', async () => {
  await withEnv(async ({ billing }) => {
    const stub = stripeStub({
      sessions: { cs_test_1: completedSession({ payment_status: 'unpaid', status: 'open' }) }
    });
    billing.setStripeClientForTesting(stub);

    const checkout = await billing.startCheckout({ planId: 'basic', returnBaseUrl: 'https://example.test' });
    const confirmed = await billing.confirmCheckout(checkout.handle);
    assert.equal(confirmed.status, 'pending', 'no payment, no subscription');
  });
});

test('checkout is built from the plan catalogue, not from Stripe price ids', async () => {
  await withEnv(async ({ billing }) => {
    const stub = stripeStub();
    billing.setStripeClientForTesting(stub);

    await billing.startCheckout({ planId: 'pro', returnBaseUrl: 'https://example.test' });
    const [session] = stub.created;
    const price = session.line_items[0].price_data;

    // Pricing stays a one-file edit in plan-service; there is no dashboard
    // state to drift out of step with it.
    assert.equal(price.unit_amount, 14900);
    assert.equal(price.recurring.interval, 'month');
    assert.equal(session.mode, 'subscription');
    assert.equal(session.metadata.planId, 'pro');
    // The handle is ours and unguessable; Stripe's id is not used as a secret.
    assert.ok(session.client_reference_id.length >= 32);
    assert.match(session.success_url, /^https:\/\/example\.test\/checkout\/return\?handle=/);
  });
});

test('a free plan cannot start a checkout', async () => {
  await withEnv(async ({ billing }) => {
    billing.setStripeClientForTesting(stripeStub());
    await assert.rejects(
      () => billing.startCheckout({ planId: 'trial', returnBaseUrl: 'https://example.test' }),
      /nothing to pay/
    );
  });
});

test('a cancellation at Stripe reaches the subscription record', async () => {
  await withEnv(async ({ billing, subscriptions }) => {
    billing.setStripeClientForTesting(stripeStub());
    const record = await seedSubscription(subscriptions);
    assert.equal(record.billingStatus, 'active');

    const { body, header } = signedWebhook({
      id: 'evt_2',
      type: 'customer.subscription.deleted',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'sub_123', status: 'canceled' } }
    });
    await billing.handleWebhook(body, header);

    const [updated] = await subscriptions.listSubscriptions();
    assert.equal(updated.billingStatus, 'canceled');
  });
});

test('a failed invoice puts the subscription past due, and paying restores it', async () => {
  await withEnv(async ({ billing, subscriptions }) => {
    const { effectiveEntitlement } = require('../src/services/plan-service');
    billing.setStripeClientForTesting(stripeStub());
    await seedSubscription(subscriptions);

    const failed = signedWebhook({
      id: 'evt_3',
      type: 'invoice.payment_failed',
      created: Math.floor(Date.now() / 1000),
      data: { object: { subscription: 'sub_123' } }
    });
    await billing.handleWebhook(failed.body, failed.header);

    let [record] = await subscriptions.listSubscriptions();
    assert.equal(record.billingStatus, 'past_due');
    // Falls back to trial limits, never to nothing.
    assert.equal(effectiveEntitlement(record).plan.id, 'trial');
    assert.equal(effectiveEntitlement(record).standing, 'past-due');

    const paid = signedWebhook({
      id: 'evt_4',
      type: 'invoice.paid',
      created: Math.floor(Date.now() / 1000) + 60,
      data: { object: { subscription: 'sub_123' } }
    });
    await billing.handleWebhook(paid.body, paid.header);

    [record] = await subscriptions.listSubscriptions();
    assert.equal(record.billingStatus, 'active');
    assert.equal(effectiveEntitlement(record).plan.id, 'pro');
  });
});

test('a webhook that arrives late cannot undo a newer one', async () => {
  await withEnv(async ({ billing, subscriptions }) => {
    billing.setStripeClientForTesting(stripeStub());
    await seedSubscription(subscriptions);

    const now = Math.floor(Date.now() / 1000);
    const newer = signedWebhook({
      id: 'evt_new',
      type: 'invoice.paid',
      created: now,
      data: { object: { subscription: 'sub_123' } }
    });
    await billing.handleWebhook(newer.body, newer.header);

    // Stripe does not guarantee delivery order. Applying this stale failure
    // would drop a paying customer to trial limits for no reason.
    const older = signedWebhook({
      id: 'evt_old',
      type: 'invoice.payment_failed',
      created: now - 3600,
      data: { object: { subscription: 'sub_123' } }
    });
    await billing.handleWebhook(older.body, older.header);

    const [record] = await subscriptions.listSubscriptions();
    assert.equal(record.billingStatus, 'active');
  });
});

test("a webhook for somebody else's subscription changes nothing", async () => {
  await withEnv(async ({ billing, subscriptions }) => {
    billing.setStripeClientForTesting(stripeStub());
    await seedSubscription(subscriptions);

    const { body, header } = signedWebhook({
      id: 'evt_5',
      type: 'customer.subscription.deleted',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'sub_somebody_else', status: 'canceled' } }
    });
    await billing.handleWebhook(body, header);

    const [record] = await subscriptions.listSubscriptions();
    assert.equal(record.billingStatus, 'active');
  });
});

test("Stripe's own trial window entitles in full", async () => {
  await withEnv(async ({ billing, subscriptions }) => {
    const { effectiveEntitlement } = require('../src/services/plan-service');
    billing.setStripeClientForTesting(stripeStub());
    await seedSubscription(subscriptions);

    const { body, header } = signedWebhook({
      id: 'evt_6',
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'sub_123', status: 'trialing' } }
    });
    await billing.handleWebhook(body, header);

    const [record] = await subscriptions.listSubscriptions();
    assert.equal(record.billingStatus, 'trialing');
    // The customer has committed; they are simply not billed yet.
    assert.equal(effectiveEntitlement(record).plan.id, 'pro');
    assert.equal(effectiveEntitlement(record).standing, 'active');
  });
});

test('a missed webhook can be repaired by reading Stripe back', async () => {
  await withEnv(async ({ billing, subscriptions }) => {
    billing.setStripeClientForTesting(
      stripeStub({ subscriptions: { sub_123: { id: 'sub_123', status: 'canceled' } } })
    );
    const record = await seedSubscription(subscriptions);

    // Without this there would be no way back for a customer whose webhook was
    // dropped — their record would say active forever.
    const repaired = await billing.reconcileSubscription(record);
    assert.equal(repaired.billingStatus, 'canceled');
  });
});

test('a paid checkout can only be claimed once', async () => {
  await withEnv(async ({ billing }) => {
    billing.setStripeClientForTesting(stripeStub());
    const { body, header } = signedWebhook({
      id: 'evt_7',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: { object: completedSession() }
    });
    await billing.handleWebhook(body, header);

    assert.ok(await billing.claimCheckout('handle-1', 'sub-record-1'));
    // A second subscription must not be able to spend the same payment.
    assert.equal(await billing.claimCheckout('handle-1', 'sub-record-2'), null);
    assert.equal((await billing.getCheckout('handle-1')).claimedBySubscriptionId, 'sub-record-1');
  });
});

test('nothing is chargeable when no payment provider is configured', async () => {
  await withEnv(
    async ({ billing }) => {
      assert.equal(billing.isConfigured(), false);
      await assert.rejects(
        () => billing.startCheckout({ planId: 'pro', returnBaseUrl: 'https://example.test' }),
        /not configured/
      );
      // And a webhook cannot be verified either, so it must not be accepted.
      await assert.rejects(() => billing.handleWebhook(Buffer.from('{}'), 'sig'));
    },
    { stripeKey: '' }
  );
});
