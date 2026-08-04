const express = require('express');

const { createSubscription, validateSubscription } = require('../services/subscription-service');
const { registerWorkspaceForSubscription } = require('../services/platform-service');
const { writeAuditEvent } = require('../services/audit-service');
const { requireAuthenticated } = require('../middleware/auth');
const { authorize } = require('../middleware/authorization');
const { describePrice } = require('../services/plan-service');
const { redeemRegistrationCode } = require('../services/registration-code-service');
const { claimCheckout, confirmCheckout } = require('../services/billing-service');
const {
  clearIntent,
  getIntent,
  grantFor,
  intendedPlan
} = require('../services/signup-intent-service');

const router = express.Router();

router.get('/subscribe', requireAuthenticated, (req, res) => {
  res.render('pages/subscribe', buildSubscribeView(req));
});

router.post('/subscribe', requireAuthenticated, authorize('subscription.create'), async (req, res, next) => {
  try {
    let planId = intendedPlan(req.session).id;
    let grant = grantFor(req.session);

    // This is the one place a subscription is minted, so it is the one place a
    // registration code is spent. Doing it earlier would burn a redemption for
    // anyone who changed their mind at the last form.
    if (grant?.via === 'code') {
      const redeemed = await redeemRegistrationCode(grant.code, {
        email: req.user.email,
        actorEmail: req.user.email
      });
      // The code itself decides the plan. Nothing between checkout and here can
      // talk it up to a more expensive one.
      planId = redeemed.planId;
      grant = { via: 'code', codeId: redeemed.codeId };
    }

    // A payment is only worth anything if the provider says so. The session
    // flag is re-checked against the stored checkout rather than believed.
    if (grant?.via === 'payment' && grant.reference) {
      const checkout = await confirmCheckout(grant.reference);
      grant =
        checkout?.status === 'paid' && !checkout.claimedBySubscriptionId
          ? {
              via: 'payment',
              confirmed: true,
              reference: grant.reference,
              stripeCustomerId: checkout.stripeCustomerId || null,
              stripeSubscriptionId: checkout.stripeSubscriptionId || null
            }
          : { via: 'payment', confirmed: false, reference: grant.reference };
    }

    const record = await createSubscription(
      // The plan is the session's, whatever the form says.
      { ...req.body, plan: planId },
      req.user,
      grant
    );

    if (grant?.confirmed && grant.reference) {
      // Ties the payment to this subscription so the same checkout cannot be
      // spent twice, and so later webhooks can find the record to update.
      await claimCheckout(grant.reference, record.id);
    }

    delete req.session.subscriptionDraft;
    clearIntent(req.session);

    await writeAuditEvent('subscription.created', {
      subscriptionId: record.id,
      userId: req.user.id,
      email: record.email,
      plan: record.plan,
      billingStatus: record.billingStatus,
      settledBy: grant?.via || 'none',
      stripeSubscriptionId: record.stripeSubscriptionId || null,
      interest: record.interest
    });

    // Create the organization workspace up front so subscribing does not dead-end
    // on "Register your organization to continue". The subscriber supplied the
    // organization name already; re-asking for it was pure friction.
    try {
      const workspace = await registerWorkspaceForSubscription(record, {
        organization: record.organization,
        role: 'administrator'
      });
      await writeAuditEvent('organization.workspace.registered', {
        subscriptionId: record.id,
        workspaceId: workspace.id,
        organization: workspace.organization,
        role: workspace.role,
        source: 'subscription-auto'
      });
      return res.redirect(303, `/organizations/${record.id}?welcome=1&workspace=${encodeURIComponent(workspace.id)}`);
    } catch (workspaceError) {
      // Fall back to the manual registration form rather than failing signup.
      await writeAuditEvent('organization.workspace.autocreate.failed', {
        subscriptionId: record.id,
        reason: workspaceError.message
      });
    }

    res.redirect(303, `/organizations/${record.id}?welcome=1`);
  } catch (error) {
    if (error.status === 422) {
      const validation = validateSubscription(req.body, req.user);
      return res.status(422).render('pages/subscribe', buildSubscribeView(req, {
        formErrors: validation.errors,
        formValues: validation.values
      }));
    }

    // A code that was valid at checkout but spent or revoked since. Say so here
    // rather than creating the subscription as though it had worked.
    if (error.expose) {
      return res.status(error.status || 400).render('pages/subscribe', buildSubscribeView(req, {
        errorMessage: `${error.message} Choose a plan again to continue.`
      }));
    }

    return next(error);
  }
});

function buildSubscribeView(req, overrides = {}) {
  const draft = req.session.subscriptionDraft || {};
  const plan = intendedPlan(req.session);
  const grant = grantFor(req.session);

  return {
    title: 'Subscribe an organization',
    description: 'Subscribe an organization to Vanguard Cloud Services - Aegis ID.',
    formErrors: overrides.formErrors || {},
    errorMessage: overrides.errorMessage || null,
    // Shown, not editable: the plan was settled before the account existed.
    chosenPlan: {
      id: plan.id,
      label: plan.label,
      price: describePrice(plan),
      requiresPayment: plan.requiresPayment,
      settledBy: grant?.via || null,
      wasChosen: Boolean(getIntent(req.session))
    },
    formValues: {
      email: req.user.email,
      organization: '',
      role: 'administrator',
      interest: 'both',
      notes: '',
      ...draft,
      ...(overrides.formValues || {}),
      plan: plan.id,
      email: req.user.email
    }
  };
}

module.exports = router;
