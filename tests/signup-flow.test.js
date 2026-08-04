const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Phase 4: choosing a plan before an account exists.
//
// The property everything else rests on is that **the plan is never taken from
// the request**. A signup form carrying `plan=enterprise` is a form anyone can
// edit, so the chosen plan lives in the session and a paid plan entitles
// nothing until a code or a payment settles it.

const MODULES = [
  '../src/config',
  '../src/services/plan-service',
  '../src/services/signup-intent-service',
  '../src/services/subscription-service',
  '../src/services/registration-code-service',
  '../src/services/audit-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-signup-'));
  const previous = { ...process.env };
  process.env.APP_ENV = 'dev';
  process.env.SUBSCRIPTION_STORE_PATH = path.join(dir, 'subs.json');
  process.env.REGISTRATION_CODE_STORE_PATH = path.join(dir, 'codes.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  resetModules();
  try {
    await run({
      dir,
      intent: require('../src/services/signup-intent-service'),
      subscriptions: require('../src/services/subscription-service'),
      codes: require('../src/services/registration-code-service')
    });
  } finally {
    process.env = previous;
    resetModules();
  }
}

const USER = { id: 'user-1', email: 'buyer@example.com' };

function subscriptionForm(overrides = {}) {
  return {
    organization: 'Buyer Co',
    consent: 'yes',
    role: 'administrator',
    ...overrides
  };
}

test('the chosen plan is held in the session, not in the form', async () => {
  await withEnv(async ({ intent, subscriptions }) => {
    const session = {};
    intent.choosePlan(session, 'trial');

    // The form claims Enterprise. The route passes the session's plan, so what
    // is stored is Trial.
    const record = await subscriptions.createSubscription(
      { ...subscriptionForm(), plan: intent.intendedPlan(session).id },
      USER
    );
    assert.equal(record.plan, 'trial');
  });
});

test('a plan that does not exist is refused rather than defaulted', async () => {
  await withEnv(async ({ intent }) => {
    const session = {};
    assert.throws(() => intent.choosePlan(session, 'enterprise-plus'), /available plans/);
    assert.throws(() => intent.choosePlan(session, ''), /available plans/);
    assert.equal(intent.getIntent(session), null);
  });
});

test('a trial needs nothing to settle it; a paid plan does', async () => {
  await withEnv(async ({ intent }) => {
    const session = {};

    intent.choosePlan(session, 'trial');
    assert.equal(intent.isSettled(session), true, 'no card, no checkout');

    intent.choosePlan(session, 'pro');
    assert.equal(intent.isSettled(session), false, 'Pro needs a code or a payment');
  });
});

test('choosing a plan again drops any code applied to the old one', async () => {
  await withEnv(async ({ intent }) => {
    const session = {};
    intent.choosePlan(session, 'basic');
    intent.attachCodeGrant(session, 'AAAA-BBBB-CCCC');
    assert.equal(intent.grantFor(session).via, 'code');

    // Otherwise a Basic code could be carried sideways onto Enterprise.
    intent.choosePlan(session, 'enterprise');
    assert.equal(intent.grantFor(session), null);
  });
});

test('a paid plan with nothing settling it starts unpaid and entitles trial limits', async () => {
  await withEnv(async ({ intent, subscriptions }) => {
    const { effectiveEntitlement } = require('../src/services/plan-service');
    const session = {};
    intent.choosePlan(session, 'enterprise');

    const record = await subscriptions.createSubscription(
      { ...subscriptionForm(), plan: intent.intendedPlan(session).id },
      USER,
      intent.grantFor(session)
    );

    // Choosing Enterprise and walking away from the card form must not grant
    // Enterprise.
    assert.equal(record.plan, 'enterprise');
    assert.equal(record.billingStatus, 'incomplete');
    const entitlement = effectiveEntitlement(record);
    assert.equal(entitlement.plan.id, 'trial');
    assert.equal(entitlement.signedUpFor.id, 'enterprise');
  });
});

test('a redeemed code produces a comped subscription with the full plan', async () => {
  await withEnv(async ({ intent, subscriptions, codes }) => {
    const { effectiveEntitlement } = require('../src/services/plan-service');
    const { code } = await codes.createRegistrationCode({ planId: 'pro', environments: ['dev'] });

    const session = {};
    intent.choosePlan(session, 'pro');

    // Checkout checks the code but must not spend it.
    assert.equal((await codes.previewRegistrationCode(code)).planId, 'pro');
    intent.attachCodeGrant(session, code);
    assert.equal((await codes.listRegistrationCodes())[0].redemptionCount, 0, 'still unspent');

    // It is spent once, where the subscription is created.
    const redeemed = await codes.redeemRegistrationCode(code, { email: USER.email });
    const record = await subscriptions.createSubscription(
      { ...subscriptionForm(), plan: redeemed.planId },
      USER,
      { via: 'code', codeId: redeemed.codeId }
    );

    assert.equal(record.plan, 'pro');
    assert.equal(record.billingStatus, 'comped');
    assert.equal(record.compedBy, 'registration-code');
    assert.equal(record.compedCodeId, redeemed.codeId);

    // Comped entitles exactly as much as paying does — that is the point.
    const entitlement = effectiveEntitlement(record);
    assert.equal(entitlement.standing, 'active');
    assert.equal(entitlement.limits.maxWorkspaces, 2);
  });
});

test('abandoning the form after applying a code does not spend it', async () => {
  await withEnv(async ({ intent, codes }) => {
    const { code } = await codes.createRegistrationCode({ planId: 'basic', environments: ['dev'] });

    const session = {};
    intent.choosePlan(session, 'basic');
    await codes.previewRegistrationCode(code);
    intent.attachCodeGrant(session, code);

    // The visitor closes the tab here.
    const [record] = await codes.listRegistrationCodes();
    assert.equal(record.redemptionCount, 0);
    assert.equal(record.isUsable, true, 'the code still works for the next attempt');
  });
});

test("a code cannot be talked up to a plan it was not issued for", async () => {
  await withEnv(async ({ intent, codes }) => {
    const { code } = await codes.createRegistrationCode({ planId: 'basic', environments: ['dev'] });

    // Checkout re-chooses the plan from the code, so this is what the session
    // holds no matter what was picked first.
    const session = {};
    intent.choosePlan(session, 'enterprise');
    const preview = await codes.previewRegistrationCode(code);
    intent.choosePlan(session, preview.planId);
    intent.attachCodeGrant(session, code);

    assert.equal(intent.intendedPlan(session).id, 'basic');
    // And redemption independently returns the code's own plan, so even a
    // tampered session cannot buy more than the code is worth.
    assert.equal((await codes.redeemRegistrationCode(code, {})).planId, 'basic');
  });
});

test('a free plan is never marked comped, code or no code', async () => {
  await withEnv(async ({ subscriptions }) => {
    const record = await subscriptions.createSubscription(
      { ...subscriptionForm(), plan: 'trial' },
      USER,
      { via: 'code', codeId: 'whatever' }
    );
    assert.equal(record.billingStatus, 'trialing');
    assert.ok(record.trialEndsAt, 'and it gets a trial end date');
  });
});

test('payment only counts once it is confirmed', async () => {
  await withEnv(async ({ subscriptions }) => {
    // A checkout that was started but never completed must not entitle
    // anything — Phase 5 sets `confirmed` from the Stripe webhook, which is the
    // only source of truth.
    const started = await subscriptions.createSubscription(
      { ...subscriptionForm(), plan: 'pro' },
      USER,
      { via: 'payment', reference: 'cs_test_123' }
    );
    assert.equal(started.billingStatus, 'incomplete');

    const paid = await subscriptions.createSubscription(
      { ...subscriptionForm(), plan: 'pro' },
      USER,
      { via: 'payment', reference: 'cs_test_123', confirmed: true }
    );
    assert.equal(paid.billingStatus, 'active');
  });
});

test('an intent survives being read back after login regenerates the session', async () => {
  await withEnv(async ({ intent }) => {
    const session = {};
    intent.choosePlan(session, 'pro');
    intent.attachCodeGrant(session, 'AAAA-BBBB-CCCC');

    // What auth.js carries across: the intent object, keyed by SESSION_KEY.
    const carried = intent.getIntent(session);
    const regenerated = { [intent.SESSION_KEY]: carried };

    assert.equal(intent.intendedPlan(regenerated).id, 'pro');
    assert.equal(intent.grantFor(regenerated).code, 'AAAA-BBBB-CCCC');
  });
});

test('with no intent at all, signup falls back to trial rather than to nothing', async () => {
  await withEnv(async ({ intent }) => {
    // Somebody who lands straight on /auth/register from an old bookmark.
    assert.equal(intent.intendedPlan({}).id, 'trial');
    assert.equal(intent.isSettled({}), true);
  });
});

test('the registration form asks for a plan, it does not grant one', async () => {
  await withEnv(async ({ intent, subscriptions }) => {
    const { effectiveEntitlement } = require('../src/services/plan-service');
    const session = {};

    // Someone picks Enterprise on the account form and submits. That is a
    // request: the plan is recorded, but nothing has paid for it.
    intent.choosePlan(session, 'enterprise');
    assert.equal(intent.isSettled(session), false, 'so the flow must route to checkout');

    const record = await subscriptions.createSubscription(
      { ...subscriptionForm(), plan: intent.intendedPlan(session).id },
      USER,
      intent.grantFor(session)
    );
    assert.equal(record.billingStatus, 'incomplete');
    assert.equal(effectiveEntitlement(record).plan.id, 'trial');
  });
});

test('a plan chosen on the registration form must exist', async () => {
  await withEnv(async ({ intent }) => {
    const session = {};
    // The radio list is client-side; the value that comes back is not trusted.
    assert.throws(() => intent.choosePlan(session, 'enterprise-unlimited'), /available plans/);
    assert.throws(() => intent.choosePlan(session, '../../admin'), /available plans/);
  });
});

test('a code entered on the registration form beats the plan picked beside it', async () => {
  await withEnv(async ({ intent, codes }) => {
    const { code } = await codes.createRegistrationCode({ planId: 'basic', environments: ['dev'] });
    const session = {};

    // Enterprise selected in the radio list, but the code is for Basic.
    intent.choosePlan(session, 'enterprise');
    const preview = await codes.previewRegistrationCode(code);
    intent.choosePlan(session, preview.planId);
    intent.attachCodeGrant(session, code);

    assert.equal(intent.intendedPlan(session).id, 'basic');
    assert.equal(intent.isSettled(session), true);
    // And still unspent — the form has not been submitted successfully yet.
    assert.equal((await codes.listRegistrationCodes())[0].redemptionCount, 0);
  });
});

test('a bad code on the registration form settles nothing', async () => {
  await withEnv(async ({ intent, codes }) => {
    const session = {};
    intent.choosePlan(session, 'pro');

    assert.equal(await codes.previewRegistrationCode('ZZZZ-ZZZZ-ZZZZ'), null);
    // The route re-renders instead of registering, so no grant is attached and
    // no half-made account is left behind.
    assert.equal(intent.grantFor(session), null);
    assert.equal(intent.isSettled(session), false);
  });
});

test('trial is the default when the form says nothing about a plan', async () => {
  await withEnv(async ({ intent }) => {
    const { DEFAULT_PLAN_ID } = require('../src/services/plan-service');
    const session = {};
    intent.choosePlan(session, DEFAULT_PLAN_ID);

    assert.equal(intent.intendedPlan(session).id, 'trial');
    assert.equal(intent.isSettled(session), true, 'so it goes straight to the organization form');
  });
});

test('the public catalogue describes every plan the server enforces', async () => {
  await withEnv(async () => {
    const { PLANS, listPublicPlans } = require('../src/services/plan-service');
    const listed = listPublicPlans();

    assert.deepEqual(
      listed.map((plan) => plan.id).sort(),
      Object.keys(PLANS).sort(),
      'a plan that cannot be chosen is a plan nobody can buy'
    );
    for (const plan of listed) {
      assert.ok(plan.price, `${plan.id} has a price to show`);
      assert.equal(plan.limits.length, 2, `${plan.id} says what it allows`);
    }
  });
});
