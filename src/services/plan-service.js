// Subscription plans: what each tier costs, what it allows, and what a given
// subscription is actually entitled to right now.
//
// Two ideas are kept apart deliberately:
//
//   the plan on the record   — what the customer signed up for
//   the *effective* plan     — what they get today
//
// They differ when a trial has expired or a paid subscription has lapsed. In
// both cases the effective plan falls back to Trial rather than to nothing: a
// billing event must never revoke somebody's identity credential, so existing
// workspaces and credentials keep working and only new issuance is blocked.
//
// Prices are placeholders and live only here, so changing them is a one-file
// edit. Amounts are in cents to avoid float arithmetic on money.

const TRIAL_DAYS = 30;

const PLANS = Object.freeze({
  trial: {
    id: 'trial',
    label: 'Trial',
    blurb: 'Try the whole platform for 30 days. No card required.',
    priceCents: 0,
    interval: null,
    maxWorkspaces: 1,
    maxCredentialsPerWorkspace: 5,
    includedCredentials: null,
    perCredentialCents: null,
    trialDays: TRIAL_DAYS,
    requiresPayment: false
  },
  basic: {
    id: 'basic',
    label: 'Basic',
    blurb: 'One organization, up to 20 credentials.',
    priceCents: 4900,
    interval: 'month',
    maxWorkspaces: 1,
    maxCredentialsPerWorkspace: 20,
    includedCredentials: null,
    perCredentialCents: null,
    trialDays: 0,
    requiresPayment: true
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    blurb: 'Two organizations, up to 20 credentials each.',
    priceCents: 14900,
    interval: 'month',
    maxWorkspaces: 2,
    maxCredentialsPerWorkspace: 20,
    includedCredentials: null,
    perCredentialCents: null,
    trialDays: 0,
    requiresPayment: true
  },
  metered: {
    id: 'metered',
    label: 'Pay per credential',
    blurb: 'One organization. Three credentials included, then per credential.',
    priceCents: 1900,
    interval: 'month',
    maxWorkspaces: 1,
    // No ceiling: the customer pays for what they issue rather than being cut off.
    maxCredentialsPerWorkspace: null,
    includedCredentials: 3,
    perCredentialCents: 500,
    trialDays: 0,
    requiresPayment: true
  },
  enterprise: {
    id: 'enterprise',
    label: 'Enterprise',
    blurb: 'Unlimited organizations. 100 credentials included, then per credential.',
    priceCents: 49900,
    interval: 'month',
    maxWorkspaces: null,
    maxCredentialsPerWorkspace: null,
    includedCredentials: 100,
    perCredentialCents: 300,
    trialDays: 0,
    requiresPayment: true
  }
});

const DEFAULT_PLAN_ID = 'trial';

/**
 * Plans that predate this catalogue. Existing subscriptions carry pilot,
 * sandbox or enterprise, and stranding them on an unknown plan would apply
 * trial limits to people already using the product.
 */
const LEGACY_PLAN_MAP = Object.freeze({
  pilot: 'trial',
  sandbox: 'trial',
  enterprise: 'enterprise'
});

function listPlans() {
  return Object.values(PLANS);
}

function getPlan(planId) {
  return PLANS[String(planId || '').toLowerCase()] || null;
}

/** Resolve any stored plan value, including legacy ones, to a catalogue plan. */
function resolvePlan(planId) {
  const direct = getPlan(planId);
  if (direct) {
    return direct;
  }
  const mapped = LEGACY_PLAN_MAP[String(planId || '').toLowerCase()];
  return mapped ? PLANS[mapped] : PLANS[DEFAULT_PLAN_ID];
}

function isKnownPlan(planId) {
  return Boolean(getPlan(planId));
}

/** When a trial that started at `startedAt` runs out. */
function trialEndsAt(startedAt) {
  const start = new Date(startedAt || Date.now()).getTime();
  return new Date(start + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * What this subscription is entitled to right now.
 *
 * `standing` explains the answer so the UI can say why, rather than silently
 * applying a limit the customer cannot account for.
 */
function effectiveEntitlement(subscription = {}) {
  const plan = resolvePlan(subscription.plan);
  const now = Date.now();

  if (!plan.requiresPayment) {
    const endsAt = subscription.trialEndsAt || trialEndsAt(subscription.createdAt);
    if (new Date(endsAt).getTime() < now) {
      return {
        plan: PLANS.trial,
        signedUpFor: plan,
        standing: 'trial-expired',
        limits: limitsFor(PLANS.trial),
        endsAt
      };
    }
    return { plan, signedUpFor: plan, standing: 'trialing', limits: limitsFor(plan), endsAt };
  }

  // A record with no billingStatus at all predates billing entirely, so there
  // is nothing to judge it by. Grandfather it rather than silently dropping a
  // working customer to trial limits the day this ships. Every record created
  // from now on sets the field, so its absence is unambiguous.
  if (subscription.billingStatus === undefined || subscription.billingStatus === null) {
    return { plan, signedUpFor: plan, standing: 'grandfathered', limits: limitsFor(plan), endsAt: null };
  }

  // Otherwise a paid plan only entitles the customer while billing is in good
  // standing. Anything else falls back to Trial limits rather than to nothing.
  // `trialing` is Stripe's word for a paid plan inside its trial window, which
  // entitles in full — the customer has committed, they are simply not billed
  // yet. Free-plan trials never reach here; they return above.
  const billing = String(subscription.billingStatus).toLowerCase();
  const inGoodStanding = billing === 'active' || billing === 'comped' || billing === 'trialing';
  if (!inGoodStanding) {
    return {
      plan: PLANS.trial,
      signedUpFor: plan,
      standing: describeStanding(billing),
      limits: limitsFor(PLANS.trial),
      endsAt: null
    };
  }

  return { plan, signedUpFor: plan, standing: 'active', limits: limitsFor(plan), endsAt: null };
}

/**
 * Why a paid plan is not in effect.
 *
 * Kept apart from `lapsed` because they mean different things to the customer:
 * a subscription that was never paid for has not stopped working, it has not
 * started, and telling somebody their brand-new signup has "lapsed" is simply
 * wrong.
 */
function describeStanding(billingStatus) {
  if (billingStatus === 'past_due') {
    return 'past-due';
  }
  if (billingStatus === 'incomplete' || billingStatus === 'incomplete_expired') {
    return 'unpaid';
  }
  return 'lapsed';
}

function limitsFor(plan) {
  return {
    maxWorkspaces: plan.maxWorkspaces,
    maxCredentialsPerWorkspace: plan.maxCredentialsPerWorkspace,
    includedCredentials: plan.includedCredentials,
    perCredentialCents: plan.perCredentialCents
  };
}

function limitError(message) {
  const error = new Error(message);
  error.status = 402; // Payment Required — the honest status for a plan limit.
  error.expose = true;
  return error;
}

/**
 * May this subscription add another workspace?
 *
 * Called before creating one. `currentCount` is supplied by the caller, which
 * already knows it, so this stays free of store access and easy to test.
 */
function assertCanAddWorkspace(subscription, currentCount) {
  const { plan, limits, standing, signedUpFor } = effectiveEntitlement(subscription);

  if (limits.maxWorkspaces === null) {
    return;
  }
  if (currentCount < limits.maxWorkspaces) {
    return;
  }

  const suffix =
    standing === 'active' || standing === 'trialing' || standing === 'grandfathered'
      ? `The ${plan.label} plan includes ${limits.maxWorkspaces} organization${limits.maxWorkspaces === 1 ? '' : 's'}.`
      : `Your ${signedUpFor.label} plan is ${standingPhrase(standing)}, so ${plan.label} limits apply.`;

  throw limitError(`You have reached your organization limit. ${suffix}`);
}

/**
 * May this workspace issue another credential?
 *
 * Metered plans have no ceiling — the customer pays for what they issue rather
 * than being cut off mid-onboarding — so this only blocks capped plans.
 */
function assertCanIssueCredential(subscription, currentCount) {
  const { plan, limits, standing, signedUpFor } = effectiveEntitlement(subscription);

  if (limits.maxCredentialsPerWorkspace === null) {
    return;
  }
  if (currentCount < limits.maxCredentialsPerWorkspace) {
    return;
  }

  const suffix =
    standing === 'active' || standing === 'trialing' || standing === 'grandfathered'
      ? `The ${plan.label} plan includes ${limits.maxCredentialsPerWorkspace} credentials per organization.`
      : `Your ${signedUpFor.label} plan is ${standingPhrase(standing)}, so ${plan.label} limits apply. Existing credentials keep working.`;

  throw limitError(`You have reached your credential limit for this organization. ${suffix}`);
}

/** The same standing, in a sentence a customer reads. */
function standingPhrase(standing) {
  if (standing === 'past-due') {
    return 'past due';
  }
  if (standing === 'unpaid') {
    return 'not paid for yet';
  }
  return 'not active';
}

/** What a plan costs to display, including its metered component. */
function describePrice(plan) {
  if (!plan.requiresPayment) {
    return `Free for ${plan.trialDays} days`;
  }
  const base = `$${(plan.priceCents / 100).toFixed(0)}/${plan.interval}`;
  if (!plan.perCredentialCents) {
    return base;
  }
  const rate = `$${(plan.perCredentialCents / 100).toFixed(0)} per credential`;
  return plan.includedCredentials
    ? `${base}, ${plan.includedCredentials} included then ${rate}`
    : `${base} plus ${rate}`;
}

/** What a plan allows, in the words a buyer uses rather than field names. */
function describeLimits(plan) {
  const organizations =
    plan.maxWorkspaces === null
      ? 'Unlimited organizations'
      : `${plan.maxWorkspaces} organization${plan.maxWorkspaces === 1 ? '' : 's'}`;

  const credentials =
    plan.maxCredentialsPerWorkspace === null
      ? plan.includedCredentials
        ? `${plan.includedCredentials} credentials included, then $${(plan.perCredentialCents / 100).toFixed(0)} each`
        : 'Unlimited credentials'
      : `${plan.maxCredentialsPerWorkspace} credentials per organization`;

  return [organizations, credentials];
}

/**
 * The headline figure on its own.
 *
 * `describePrice` spells out the metered component too, which is right for a
 * pricing page but too long to sit beside a plan name in a compact list — the
 * per-credential rate is already in the limits there.
 */
function describeHeadlinePrice(plan) {
  if (!plan.requiresPayment) {
    return `Free for ${plan.trialDays} days`;
  }
  return `$${(plan.priceCents / 100).toFixed(0)}/${plan.interval}`;
}

/**
 * The catalogue as the pricing page shows it: everything a visitor needs to
 * choose, and nothing the server relies on. The chosen plan is still read from
 * the session rather than from whatever comes back in the form.
 */
function listPublicPlans() {
  return listPlans().map((plan) => ({
    id: plan.id,
    label: plan.label,
    blurb: plan.blurb,
    price: describePrice(plan),
    headlinePrice: describeHeadlinePrice(plan),
    limits: describeLimits(plan),
    requiresPayment: plan.requiresPayment,
    // Trial is the honest recommendation for a first-time visitor.
    isRecommended: plan.id === 'pro'
  }));
}

module.exports = {
  DEFAULT_PLAN_ID,
  PLANS,
  TRIAL_DAYS,
  assertCanAddWorkspace,
  assertCanIssueCredential,
  describeHeadlinePrice,
  describeLimits,
  describePrice,
  effectiveEntitlement,
  getPlan,
  isKnownPlan,
  listPlans,
  listPublicPlans,
  resolvePlan,
  trialEndsAt
};
