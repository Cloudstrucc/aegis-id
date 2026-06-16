const express = require('express');

const { createSubscription, validateSubscription } = require('../services/subscription-service');
const { writeAuditEvent } = require('../services/audit-service');
const { requireAuthenticated } = require('../middleware/auth');

const router = express.Router();

router.get('/subscribe', requireAuthenticated, (req, res) => {
  res.render('pages/subscribe', buildSubscribeView(req));
});

router.post('/subscribe', requireAuthenticated, async (req, res, next) => {
  try {
    const record = await createSubscription(req.body, req.user);
    delete req.session.subscriptionDraft;

    await writeAuditEvent('subscription.created', {
      subscriptionId: record.id,
      userId: req.user.id,
      email: record.email,
      plan: record.plan,
      interest: record.interest
    });
    res.redirect(303, `/organizations/${record.id}?welcome=1`);
  } catch (error) {
    if (error.status === 422) {
      const validation = validateSubscription(req.body, req.user);
      return res.status(422).render('pages/subscribe', buildSubscribeView(req, {
        formErrors: validation.errors,
        formValues: validation.values
      }));
    }

    return next(error);
  }
});

function buildSubscribeView(req, overrides = {}) {
  const draft = req.session.subscriptionDraft || {};
  return {
    title: 'Subscribe an organization',
    description: 'Subscribe an organization to Vanguard Cloud Services - Aegis ID.',
    formErrors: overrides.formErrors || {},
    formValues: {
      email: req.user.email,
      organization: '',
      role: 'administrator',
      plan: 'pilot',
      interest: 'both',
      notes: '',
      ...draft,
      ...(overrides.formValues || {}),
      email: req.user.email
    }
  };
}

module.exports = router;
