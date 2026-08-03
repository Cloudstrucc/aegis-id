const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PLANS,
  TRIAL_DAYS,
  assertCanAddWorkspace,
  assertCanIssueCredential,
  describePrice,
  effectiveEntitlement,
  isKnownPlan,
  resolvePlan,
  trialEndsAt
} = require('../src/services/plan-service');

// Plan limits decide whether someone can use the product they are paying for,
// so the cases that matter are the unhappy ones: an expired trial, a lapsed
// card, and a record that predates billing entirely.

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

test('a live trial gets trial limits', () => {
  const entitlement = effectiveEntitlement({ plan: 'trial', trialEndsAt: iso(5 * DAY) });
  assert.equal(entitlement.standing, 'trialing');
  assert.equal(entitlement.limits.maxWorkspaces, 1);
  assert.equal(entitlement.limits.maxCredentialsPerWorkspace, 5);
});

test('an expired trial keeps trial limits rather than losing everything', () => {
  const entitlement = effectiveEntitlement({ plan: 'trial', trialEndsAt: iso(-1 * DAY) });
  assert.equal(entitlement.standing, 'trial-expired');
  // Still 1 workspace and 5 credentials: what they already built keeps working,
  // and only going further is blocked.
  assert.equal(entitlement.limits.maxWorkspaces, 1);
  assert.equal(entitlement.limits.maxCredentialsPerWorkspace, 5);
});

test('a trial with no explicit end date is dated from when it was created', () => {
  const createdAt = iso(-(TRIAL_DAYS + 1) * DAY);
  assert.equal(effectiveEntitlement({ plan: 'trial', createdAt }).standing, 'trial-expired');

  const fresh = iso(-1 * DAY);
  assert.equal(effectiveEntitlement({ plan: 'trial', createdAt: fresh }).standing, 'trialing');
});

test('a paid plan only entitles while billing is in good standing', () => {
  const paid = { plan: 'pro', billingStatus: 'active' };
  assert.equal(effectiveEntitlement(paid).limits.maxWorkspaces, 2);

  for (const billingStatus of ['past_due', 'canceled', 'unpaid', 'incomplete', '']) {
    const lapsed = effectiveEntitlement({ plan: 'pro', billingStatus });
    // Falls back to Trial, not to nothing — a billing event must never revoke
    // an identity credential.
    assert.equal(lapsed.limits.maxWorkspaces, 1, `billingStatus=${billingStatus}`);
    assert.equal(lapsed.signedUpFor.id, 'pro', 'what they signed up for is still known');
  }
});

test('a past-due plan is distinguished from a cancelled one', () => {
  assert.equal(effectiveEntitlement({ plan: 'basic', billingStatus: 'past_due' }).standing, 'past-due');
  assert.equal(effectiveEntitlement({ plan: 'basic', billingStatus: 'canceled' }).standing, 'lapsed');
});

test('a subscription predating billing is grandfathered, not downgraded', () => {
  // Records created before this feature have no billingStatus at all. Judging
  // them by it would drop working customers to trial limits on deploy day.
  const legacy = { plan: 'enterprise' };
  const entitlement = effectiveEntitlement(legacy);
  assert.equal(entitlement.standing, 'grandfathered');
  assert.equal(entitlement.limits.maxWorkspaces, null);

  // An explicit empty status is a real answer and must not be grandfathered.
  assert.equal(effectiveEntitlement({ plan: 'enterprise', billingStatus: '' }).standing, 'lapsed');
});

test('legacy plan names resolve to catalogue plans', () => {
  assert.equal(resolvePlan('pilot').id, 'trial');
  assert.equal(resolvePlan('sandbox').id, 'trial');
  assert.equal(resolvePlan('enterprise').id, 'enterprise');
  // Anything unrecognised is treated as the least privileged plan.
  assert.equal(resolvePlan('nonsense').id, 'trial');
  assert.equal(resolvePlan(undefined).id, 'trial');

  assert.equal(isKnownPlan('pilot'), false, 'legacy names are not catalogue plans');
  assert.equal(isKnownPlan('basic'), true);
});

test('the workspace limit blocks the one that would exceed it', () => {
  const basic = { plan: 'basic', billingStatus: 'active' };
  assertCanAddWorkspace(basic, 0);
  assert.throws(() => assertCanAddWorkspace(basic, 1), /organization limit/);

  const pro = { plan: 'pro', billingStatus: 'active' };
  assertCanAddWorkspace(pro, 1);
  assert.throws(() => assertCanAddWorkspace(pro, 2), /organization limit/);
});

test('enterprise has no workspace ceiling', () => {
  const enterprise = { plan: 'enterprise', billingStatus: 'active' };
  assertCanAddWorkspace(enterprise, 0);
  assertCanAddWorkspace(enterprise, 500);
});

test('the credential limit blocks the one that would exceed it', () => {
  const basic = { plan: 'basic', billingStatus: 'active' };
  assertCanIssueCredential(basic, 19);
  assert.throws(() => assertCanIssueCredential(basic, 20), /credential limit/);
});

test('metered plans are never cut off mid-onboarding', () => {
  // They pay for what they issue, so a ceiling would be the wrong shape.
  const metered = { plan: 'metered', billingStatus: 'active' };
  assertCanIssueCredential(metered, 0);
  assertCanIssueCredential(metered, 10_000);
  assert.equal(PLANS.metered.includedCredentials, 3);
  assert.equal(PLANS.metered.perCredentialCents, 500);
});

test('a lapsed paid plan is told why it is being limited', () => {
  const lapsed = { plan: 'pro', billingStatus: 'canceled' };
  assert.throws(
    () => assertCanIssueCredential(lapsed, 5),
    (error) => {
      assert.match(error.message, /Pro plan is not active/);
      assert.match(error.message, /Existing credentials keep working/);
      // 402 rather than 403: this is a billing limit, not a permission failure.
      assert.equal(error.status, 402);
      assert.equal(error.expose, true);
      return true;
    }
  );
});

test('prices describe their metered component', () => {
  assert.match(describePrice(PLANS.trial), /Free for 30 days/);
  assert.equal(describePrice(PLANS.basic), '$49/month');
  assert.match(describePrice(PLANS.metered), /\$19\/month, 3 included then \$5 per credential/);
  assert.match(describePrice(PLANS.enterprise), /100 included then \$3 per credential/);
});

test('a trial end date is TRIAL_DAYS after the start', () => {
  const start = '2026-01-01T00:00:00.000Z';
  const ends = new Date(trialEndsAt(start)).getTime() - new Date(start).getTime();
  assert.equal(ends / DAY, TRIAL_DAYS);
});
