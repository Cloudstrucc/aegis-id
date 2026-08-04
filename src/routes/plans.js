// Choosing a plan, and settling it before an account exists.
//
// The order is deliberate: plan first, then account. Somebody who picks
// Enterprise should find that out at the pricing page, not after filling in a
// registration form. Trial goes straight to the form; a paid plan goes through
// checkout, where the two ways to settle it are a registration code or payment.
//
// Nothing here trusts the request for the chosen plan — see
// signup-intent-service for why.

const express = require('express');

const { authorize } = require('../middleware/authorization');
const { listPublicPlans, describePrice, describeLimits } = require('../services/plan-service');
const {
  attachCodeGrant,
  attachPaymentGrant,
  choosePlan,
  getIntent,
  grantFor,
  intendedPlan,
  setSettledPlan
} = require('../services/signup-intent-service');
const { confirmCheckout, startCheckout } = require('../services/billing-service');
const { previewRegistrationCode } = require('../services/registration-code-service');
const { writeAuditEvent } = require('../services/audit-service');
const config = require('../config');

const router = express.Router();

router.get('/plans', authorize('public.plans'), (req, res) => {
  res.render('pages/plans', {
    title: 'Plans',
    description: 'Choose a plan for your organization.',
    plans: listPublicPlans(),
    selectedPlanId: getIntent(req.session)?.planId || null,
    errorMessage: req.query.error || null
  });
});

router.post('/plans', authorize('public.plans'), async (req, res, next) => {
  try {
    const plan = choosePlan(req.session, req.body.planId);
    await writeAuditEvent('subscription.plan.selected', {
      planId: plan.id,
      requiresPayment: plan.requiresPayment
    });

    // A free plan has nothing to settle, so it goes straight to the form.
    return res.redirect(303, plan.requiresPayment ? '/checkout' : '/auth/register');
  } catch (error) {
    if (error.expose) {
      return res.redirect(303, `/plans?error=${encodeURIComponent(error.message)}`);
    }
    return next(error);
  }
});

router.get('/checkout', authorize('public.plans'), (req, res) => {
  if (!getIntent(req.session)) {
    return res.redirect(303, '/plans');
  }
  res.render('pages/checkout', buildCheckoutView(req));
});

/**
 * Check a registration code.
 *
 * Checked here so nobody fills in a whole registration form before being told
 * their code is wrong — but deliberately *not* spent here, because abandoning
 * the form afterwards must not burn a redemption. It is redeemed once, at the
 * moment the subscription is created.
 */
router.post('/checkout/code', authorize('public.plans'), async (req, res, next) => {
  try {
    if (!getIntent(req.session)) {
      return res.redirect(303, '/plans');
    }

    const candidate = String(req.body.code || '').trim();
    const preview = await previewRegistrationCode(candidate);

    if (!preview) {
      return res.status(422).render(
        'pages/checkout',
        buildCheckoutView(req, { errorMessage: 'That registration code is not valid.' })
      );
    }

    // The code decides the plan, not the earlier choice: a code for Basic must
    // not be spendable on Enterprise just because Enterprise was picked first.
    choosePlan(req.session, preview.planId);
    attachCodeGrant(req.session, candidate);

    return res.redirect(303, '/auth/register');
  } catch (error) {
    return next(error);
  }
});

/**
 * The card path.
 *
 * Sends the customer to Stripe's hosted Checkout, so card details never reach
 * this application. Where no payment provider is configured the account can
 * still be created — it simply starts unpaid, and plan-service gives an unpaid
 * paid-plan Trial limits rather than everything or nothing.
 */
router.post('/checkout/pay', authorize('public.plans'), async (req, res, next) => {
  try {
    const intent = getIntent(req.session);
    if (!intent) {
      return res.redirect(303, '/plans');
    }

    if (!config.billing.checkoutEnabled) {
      attachPaymentGrant(req.session, { reference: null });
      await writeAuditEvent('subscription.checkout.deferred', {
        planId: intent.planId,
        reason: 'payment-provider-not-configured'
      });
      return res.redirect(303, '/auth/register');
    }

    const checkout = await startCheckout({
      planId: intent.planId,
      returnBaseUrl: config.app.publicBaseUrl
    });
    // Only the handle is kept. It identifies the checkout to us and is worth
    // nothing anywhere else.
    attachPaymentGrant(req.session, { reference: checkout.handle });
    return res.redirect(303, checkout.url);
  } catch (error) {
    if (error.expose) {
      return res.redirect(303, `/checkout?error=${encodeURIComponent(error.message)}`);
    }
    return next(error);
  }
});

/**
 * Where Stripe sends the customer back.
 *
 * The redirect itself proves nothing — anyone can visit this URL — so payment
 * is confirmed against Stripe rather than against the fact that we were asked
 * for this page. If the webhook has not landed yet, `confirmCheckout` reads the
 * session back from Stripe instead of making the customer wait for it.
 */
router.get('/checkout/return', authorize('public.plans'), async (req, res, next) => {
  try {
    const grant = grantFor(req.session);
    // The session's own handle, not the query string: a handle in a URL somebody
    // else sent you must not attach their payment to your signup.
    const handle = grant?.via === 'payment' ? grant.reference : null;
    if (!handle) {
      return res.redirect(303, '/plans');
    }

    const checkout = await confirmCheckout(handle);
    const paid = checkout?.status === 'paid';

    if (paid) {
      attachPaymentGrant(req.session, {
        reference: handle,
        confirmed: true,
        stripeCustomerId: checkout.stripeCustomerId || null,
        stripeSubscriptionId: checkout.stripeSubscriptionId || null
      });
      if (checkout.planId) {
        // Whatever was actually bought decides the plan.
        setSettledPlan(req.session, checkout.planId);
      }
    }

    return res.render('pages/checkout-return', {
      title: paid ? 'Payment received' : 'Confirming payment',
      description: 'Finishing your subscription.',
      paid,
      plan: intendedPlan(req.session).label
    });
  } catch (error) {
    return next(error);
  }
});

function buildCheckoutView(req, overrides = {}) {
  const plan = intendedPlan(req.session);
  return {
    title: 'Checkout',
    description: `Set up your ${plan.label} subscription.`,
    plan: {
      id: plan.id,
      label: plan.label,
      blurb: plan.blurb,
      price: describePrice(plan),
      limits: describeLimits(plan)
    },
    hasGrant: Boolean(grantFor(req.session)),
    // Saying "not connected here" is better than a card form that cannot take
    // a card. Derived from the Stripe key, so it cannot claim otherwise.
    checkoutEnabled: config.billing.checkoutEnabled,
    errorMessage: overrides.errorMessage || req.query.error || null
  };
}

module.exports = router;
