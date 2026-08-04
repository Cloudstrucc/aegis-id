const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');

const store = new FileJsonStore(config.paths.subscriptions, []);

const { DEFAULT_PLAN_ID, isKnownPlan, resolvePlan, trialEndsAt } = require('./plan-service');

// The catalogue is the authority on which plans exist. The legacy values are
// still accepted so existing records and any bookmarked form keep working;
// resolvePlan maps them onto a catalogue plan.
const legacyPlans = new Set(['pilot', 'sandbox']);
const allowedInterests = new Set(['microsoft-native', 'aries-lab', 'both']);

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function normalizeText(value = '') {
  return String(value).trim().slice(0, 400);
}

function validateSubscription(input = {}, user = null) {
  const errors = {};
  const email = normalizeEmail(user?.email || input.email);
  const requested = String(input.plan || '').toLowerCase();
  const plan = isKnownPlan(requested) || legacyPlans.has(requested) ? requested : DEFAULT_PLAN_ID;
  const interest = allowedInterests.has(input.interest) ? input.interest : 'both';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid work email.';
  }

  if (!input.consent) {
    errors.consent = 'Consent is required to follow up.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    values: {
      email,
      plan,
      interest,
      organization: normalizeText(input.organization),
      role: normalizeText(input.role),
      notes: normalizeText(input.notes)
    }
  };
}

async function createSubscription(input, user = null, grant = null) {
  const validation = validateSubscription(input, user);
  if (!validation.isValid) {
    const error = new Error('Subscription form needs attention.');
    error.status = 422;
    error.details = validation;
    throw error;
  }

  const now = new Date().toISOString();
  const selectedPlan = resolvePlan(validation.values.plan);
  const record = {
    id: crypto.randomUUID(),
    ...validation.values,
    userId: user?.id || null,
    status: 'new',
    // Billing state is a cache of what the payment provider says. A paid plan
    // entitles nobody until this says so, which is what stops an unpaid
    // checkout from granting access.
    billingStatus: billingStatusFor(selectedPlan, grant),
    trialEndsAt: selectedPlan.requiresPayment ? null : trialEndsAt(now),
    source: user ? 'authenticated-subscription' : 'landing-page',
    createdAt: now
  };

  if (grant?.via === 'code') {
    // Kept so an audit can answer "why is this customer not being charged?"
    // without the code itself, which is a secret.
    record.compedBy = 'registration-code';
    record.compedCodeId = grant.codeId || null;
  }

  if (grant?.via === 'payment') {
    // The provider's own identifiers, which is how a later webhook finds this
    // record. Without them a cancellation at Stripe would never reach us.
    record.stripeCustomerId = grant.stripeCustomerId || null;
    record.stripeSubscriptionId = grant.stripeSubscriptionId || null;
    record.billingUpdatedAt = now;
  }

  return store.append(record);
}

/**
 * The billing state a new subscription starts in.
 *
 * A redeemed registration code produces `comped`, which entitles exactly as
 * much as paying does — that is the whole point of a code. Anything else on a
 * paid plan starts `incomplete`, so choosing Enterprise and walking away from
 * the card form grants nothing.
 */
function billingStatusFor(plan, grant) {
  if (!plan.requiresPayment) {
    return 'trialing';
  }
  if (grant?.via === 'code') {
    return 'comped';
  }
  if (grant?.via === 'payment' && grant.confirmed) {
    return 'active';
  }
  return 'incomplete';
}

async function ensureAccountAccessSubscription(user) {
  if (!user) {
    const error = new Error('Authenticated user is required.');
    error.status = 401;
    throw error;
  }

  const subscriptions = await listSubscriptions();
  const email = normalizeEmail(user.email);
  const existing = subscriptions.find((subscription) => isAccountAccessSubscription(subscription) && ownsSubscription(subscription, user));
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    email,
    organization: 'Credential memberships',
    role: 'credential-holder',
    plan: 'pilot',
    interest: 'both',
    notes: 'Portal access record for credential-holder organization memberships.',
    userId: user.id,
    status: 'active',
    source: 'portal-account',
    createdAt: now,
    updatedAt: now
  };

  subscriptions.push(record);
  await store.write(subscriptions);
  return record;
}

async function listSubscriptions() {
  return store.read();
}

/**
 * Apply a billing change from the payment provider.
 *
 * Stripe is the source of truth for billing, so this writes what it says
 * rather than deciding anything. `occurredAt` is the provider's own timestamp
 * for the event: webhooks can arrive out of order, and applying a stale event
 * after a newer one would flip a paying customer back to unpaid.
 */
/**
 * Is this event older than what has already been applied?
 *
 * Compared at whole-second resolution because Stripe timestamps events to the
 * second. Comparing milliseconds would discard a legitimate event that happened
 * to land in the same second as the record it updates — which is the common
 * case immediately after checkout, not a rare one.
 */
function isStale(occurredAt, appliedAt) {
  const second = (value) => Math.floor(new Date(value).getTime() / 1000);
  return second(occurredAt) < second(appliedAt);
}

async function applyBillingUpdate(predicate, patch, occurredAt = null) {
  const subscriptions = await listSubscriptions();
  const index = subscriptions.findIndex(predicate);
  if (index === -1) {
    return null;
  }

  const current = subscriptions[index];
  if (occurredAt && current.billingUpdatedAt && isStale(occurredAt, current.billingUpdatedAt)) {
    return current;
  }

  subscriptions[index] = {
    ...current,
    ...patch,
    billingUpdatedAt: occurredAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await store.write(subscriptions);
  return subscriptions[index];
}

async function getSubscription(id) {
  const subscriptions = await listSubscriptions();
  return subscriptions.find((subscription) => subscription.id === id) || null;
}

async function listSubscriptionsForUser(user) {
  if (!user) {
    return [];
  }

  const subscriptions = await listSubscriptions();
  return subscriptions.filter((subscription) => ownsSubscription(subscription, user));
}

async function getSubscriptionForUser(id, user) {
  const subscription = await getSubscription(id);
  return subscription && ownsSubscription(subscription, user) ? subscription : null;
}

function ownsSubscription(subscription, user) {
  if (!subscription || !user) {
    return false;
  }
  return subscription.userId === user.id || normalizeEmail(subscription.email) === normalizeEmail(user.email);
}

function isAccountAccessSubscription(subscription = {}) {
  return subscription.source === 'portal-account';
}

module.exports = {
  applyBillingUpdate,
  createSubscription,
  ensureAccountAccessSubscription,
  getSubscription,
  getSubscriptionForUser,
  isAccountAccessSubscription,
  listSubscriptionsForUser,
  listSubscriptions,
  validateSubscription
};
