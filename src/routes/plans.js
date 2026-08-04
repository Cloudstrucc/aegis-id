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
  intendedPlan
} = require('../services/signup-intent-service');
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
 * Phase 5 replaces this with a Stripe Checkout session and confirms payment
 * from the webhook, which is the only source of truth. Until then the account
 * can still be created — it simply starts unpaid, and plan-service already
 * gives an unpaid paid-plan Trial limits rather than everything or nothing.
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

    // Phase 5 lands here.
    return res.redirect(303, '/checkout?error=Card+payment+is+not+available+yet.');
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
    // Off until Stripe is wired up in Phase 5. Saying so is better than a card
    // form that cannot take a card.
    checkoutEnabled: config.billing.checkoutEnabled,
    errorMessage: overrides.errorMessage || req.query.error || null
  };
}

module.exports = router;
