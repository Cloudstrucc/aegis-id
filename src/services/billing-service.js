// Taking payment, and keeping our idea of a subscription's billing state in
// step with the payment provider's.
//
// The governing rule: **Stripe is the source of truth for billing.** Our
// `billingStatus` is a cache of what Stripe says, written only by a verified
// webhook or by reading the API back. Nothing a browser sends decides whether
// somebody has paid — the redirect back from Checkout is a navigation hint, not
// evidence, so it is never trusted on its own.
//
// Prices are still owned by plan-service. Line items are built inline from the
// catalogue rather than from Stripe Price IDs, so changing pricing stays the
// one-file edit it was and there is no dashboard state to keep in sync.

const crypto = require('node:crypto');
const Stripe = require('stripe');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { writeAuditEvent } = require('./audit-service');
const { resolvePlan } = require('./plan-service');
const { applyBillingUpdate } = require('./subscription-service');

// Checkout happens before the account exists, so a paid checkout has nowhere to
// live yet. It is parked here under a handle the browser carries, and claimed
// once the subscription is created.
const store = new FileJsonStore(config.paths.checkoutSessions, []);

let client = null;

function isConfigured() {
  return Boolean(config.billing.stripeSecretKey);
}

function getStripe() {
  if (!isConfigured()) {
    const error = new Error('Card payment is not configured on this environment.');
    error.status = 503;
    error.expose = true;
    throw error;
  }
  if (!client) {
    client = new Stripe(config.billing.stripeSecretKey);
  }
  return client;
}

/** Test seam: lets the suite drive the flow without reaching Stripe. */
function setStripeClientForTesting(stub) {
  client = stub;
}

/**
 * Stripe's subscription status is used verbatim, because inventing our own
 * vocabulary on top would only create a second thing to keep in step. The one
 * value plan-service cares about beyond `active` is `trialing`, which Stripe
 * uses for a paid plan inside its trial window.
 */
function billingStatusFromStripe(stripeStatus) {
  return String(stripeStatus || 'incomplete').toLowerCase();
}

/**
 * Start a hosted Checkout session for a plan.
 *
 * Hosted rather than embedded on purpose: card details then never touch this
 * application, which keeps it out of PCI scope entirely.
 */
async function startCheckout({ planId, email = null, returnBaseUrl }) {
  const plan = resolvePlan(planId);
  if (!plan.requiresPayment) {
    const error = new Error('That plan is free, so there is nothing to pay.');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  // The handle is ours, not Stripe's: it is what the browser carries back, and
  // knowing one tells you nothing you could use elsewhere.
  const handle = crypto.randomBytes(24).toString('base64url');

  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    client_reference_id: handle,
    customer_email: email || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: plan.priceCents,
          recurring: { interval: plan.interval || 'month' },
          product_data: {
            name: `Aegis ID ${plan.label}`,
            description: plan.blurb
          }
        }
      }
    ],
    // Carried through to the webhook so a completed payment knows which plan it
    // bought without us having to trust the browser for it.
    subscription_data: { metadata: { planId: plan.id, handle } },
    metadata: { planId: plan.id, handle },
    success_url: `${returnBaseUrl}/checkout/return?handle=${encodeURIComponent(handle)}`,
    cancel_url: `${returnBaseUrl}/checkout?error=${encodeURIComponent('Payment was cancelled.')}`
  });

  await recordCheckout({
    handle,
    stripeSessionId: session.id,
    planId: plan.id,
    status: 'pending',
    email
  });

  await writeAuditEvent('subscription.checkout.started', {
    planId: plan.id,
    stripeSessionId: session.id,
    email
  });

  return { handle, url: session.url, stripeSessionId: session.id };
}

async function recordCheckout(record) {
  const records = await store.read();
  const index = records.findIndex((entry) => entry.handle === record.handle);
  const now = new Date().toISOString();

  if (index === -1) {
    records.unshift({ ...record, createdAt: now, updatedAt: now });
  } else {
    // Upsert, because Stripe retries webhooks and a repeat must be harmless.
    records[index] = { ...records[index], ...record, updatedAt: now };
  }

  await store.write(records);
  return records.find((entry) => entry.handle === record.handle);
}

async function getCheckout(handle) {
  if (!handle) {
    return null;
  }
  const records = await store.read();
  return records.find((entry) => entry.handle === handle) || null;
}

/**
 * Has this checkout been paid?
 *
 * Answers from the webhook record if it has landed. If it has not — webhooks
 * and browser redirects race, and the redirect usually wins — it asks Stripe
 * directly rather than making the customer wait or, worse, taking their word
 * for it.
 */
async function confirmCheckout(handle) {
  const record = await getCheckout(handle);
  if (!record) {
    return null;
  }
  if (record.status === 'paid') {
    return record;
  }

  if (!isConfigured()) {
    return record;
  }

  const session = await getStripe().checkout.sessions.retrieve(record.stripeSessionId, {
    expand: ['subscription']
  });
  if (session.payment_status !== 'paid' && session.status !== 'complete') {
    return record;
  }

  return applyPaidSession(session);
}

/** Mark a checkout paid, from either a webhook event or a direct read. */
async function applyPaidSession(session) {
  const handle = session.client_reference_id || session.metadata?.handle;
  const subscription = typeof session.subscription === 'object' ? session.subscription : null;

  const updated = await recordCheckout({
    handle,
    stripeSessionId: session.id,
    planId: session.metadata?.planId || null,
    status: 'paid',
    email: session.customer_details?.email || session.customer_email || null,
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id || null,
    stripeSubscriptionId:
      typeof session.subscription === 'string' ? session.subscription : subscription?.id || null,
    stripeSubscriptionStatus: subscription ? billingStatusFromStripe(subscription.status) : 'active',
    paidAt: new Date().toISOString()
  });

  await writeAuditEvent('subscription.checkout.paid', {
    stripeSessionId: session.id,
    planId: updated?.planId || null,
    stripeSubscriptionId: updated?.stripeSubscriptionId || null
  });

  return updated;
}

/** Tie a paid checkout to the subscription it created, so it cannot be reused. */
async function claimCheckout(handle, subscriptionId) {
  const record = await getCheckout(handle);
  if (!record || record.claimedBySubscriptionId) {
    return null;
  }
  return recordCheckout({
    handle,
    claimedBySubscriptionId: subscriptionId,
    claimedAt: new Date().toISOString()
  });
}

/**
 * Verify and apply a Stripe webhook.
 *
 * The signature check is the whole security boundary here: this endpoint is
 * public, so an unverified body is an attacker telling us who has paid.
 */
async function handleWebhook(rawBody, signature) {
  if (!config.billing.stripeWebhookSecret) {
    const error = new Error('Webhook secret is not configured.');
    error.status = 503;
    throw error;
  }

  const event = getStripe().webhooks.constructEvent(
    rawBody,
    signature,
    config.billing.stripeWebhookSecret
  );

  const occurredAt = new Date((event.created || Date.now() / 1000) * 1000).toISOString();
  const object = event.data?.object || {};

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      if (object.payment_status === 'paid' || object.status === 'complete') {
        await applyPaidSession(object);
      }
      break;

    // The lifecycle of an existing subscription: renewals, failures, upgrades
    // and cancellations all arrive as one of these.
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncSubscriptionStatus(object, occurredAt);
      break;

    case 'invoice.payment_failed':
      await syncByStripeSubscriptionId(object.subscription, 'past_due', occurredAt);
      break;

    case 'invoice.paid':
      await syncByStripeSubscriptionId(object.subscription, 'active', occurredAt);
      break;

    default:
      // Anything else is acknowledged and ignored. Stripe sends a great deal
      // that is none of our business, and 400ing on it only causes retries.
      break;
  }

  await writeAuditEvent('subscription.billing.webhook', {
    eventId: event.id,
    type: event.type,
    occurredAt
  });

  return { received: true, type: event.type };
}

async function syncSubscriptionStatus(stripeSubscription, occurredAt) {
  const status =
    stripeSubscription.status === 'canceled' || !stripeSubscription.status
      ? 'canceled'
      : billingStatusFromStripe(stripeSubscription.status);

  return applyBillingUpdate(
    (record) => record.stripeSubscriptionId === stripeSubscription.id,
    {
      billingStatus: status,
      stripeSubscriptionStatus: status,
      cancelAtPeriodEnd: Boolean(stripeSubscription.cancel_at_period_end)
    },
    occurredAt
  );
}

async function syncByStripeSubscriptionId(stripeSubscriptionId, status, occurredAt) {
  if (!stripeSubscriptionId) {
    return null;
  }
  return applyBillingUpdate(
    (record) => record.stripeSubscriptionId === stripeSubscriptionId,
    { billingStatus: status, stripeSubscriptionStatus: status },
    occurredAt
  );
}

/**
 * Re-read one subscription's billing state from Stripe.
 *
 * A missed or mis-delivered webhook would otherwise leave a paying customer on
 * trial limits with no way back, so there has to be a path that does not depend
 * on a webhook ever arriving.
 */
async function reconcileSubscription(subscription) {
  if (!subscription?.stripeSubscriptionId || !isConfigured()) {
    return null;
  }

  const remote = await getStripe().subscriptions.retrieve(subscription.stripeSubscriptionId);
  const status = billingStatusFromStripe(remote.status);

  const updated = await applyBillingUpdate(
    (record) => record.id === subscription.id,
    {
      billingStatus: status,
      stripeSubscriptionStatus: status,
      cancelAtPeriodEnd: Boolean(remote.cancel_at_period_end)
    },
    // No event timestamp: a deliberate read is always the newest word.
    new Date().toISOString()
  );

  await writeAuditEvent('subscription.billing.reconciled', {
    subscriptionId: subscription.id,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
    billingStatus: status
  });

  return updated;
}

module.exports = {
  billingStatusFromStripe,
  claimCheckout,
  confirmCheckout,
  getCheckout,
  handleWebhook,
  isConfigured,
  reconcileSubscription,
  setStripeClientForTesting,
  startCheckout
};
