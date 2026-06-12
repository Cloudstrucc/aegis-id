const express = require('express');

const { createSubscription, validateSubscription } = require('../services/subscription-service');
const { writeAuditEvent } = require('../services/audit-service');
const { getHomeContent } = require('../services/home-content');

const router = express.Router();

router.post('/subscribe', async (req, res, next) => {
  try {
    const record = await createSubscription(req.body);
    await writeAuditEvent('subscription.created', {
      subscriptionId: record.id,
      email: record.email,
      plan: record.plan,
      interest: record.interest
    });

    res.status(201).render('pages/subscribed', {
      title: 'Subscription received',
      description: 'Cloudstrucc Aegis ID subscription request received.',
      subscription: record
    });
  } catch (error) {
    if (error.status === 422) {
      const validation = validateSubscription(req.body);
      return res.status(422).render(
        'pages/home',
        getHomeContent({
        formErrors: validation.errors,
        formValues: validation.values
        })
      );
    }

    return next(error);
  }
});

module.exports = router;
