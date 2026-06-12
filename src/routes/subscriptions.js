const express = require('express');

const { createSubscription, validateSubscription } = require('../services/subscription-service');
const { writeAuditEvent } = require('../services/audit-service');
const { getHomeContent } = require('../services/home-content');
const { createWorkspaceForSubscription } = require('../services/platform-service');

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
    await createWorkspaceForSubscription(record);

    res.redirect(303, `/dashboard/${record.id}?welcome=1`);
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
