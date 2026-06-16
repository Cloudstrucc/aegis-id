const express = require('express');

const { requireAuthenticated } = require('../middleware/auth');
const { listSubscriptionsForUser } = require('../services/subscription-service');
const { listWorkspacesForSubscription } = require('../services/platform-service');

const router = express.Router();

router.get('/account', requireAuthenticated, async (req, res, next) => {
  try {
    const subscriptions = await listSubscriptionsForUser(req.user);
    const organizations = [];

    for (const subscription of subscriptions) {
      const workspaces = await listWorkspacesForSubscription(subscription);
      organizations.push({
        subscription,
        workspaces,
        hasWorkspaces: workspaces.length > 0,
        organizationsPath: `/organizations/${subscription.id}`
      });
    }

    res.render('pages/account', {
      title: 'Account',
      description: 'Manage your Vanguard Cloud Services - Aegis ID subscriptions.',
      user: req.user,
      organizations,
      hasOrganizations: organizations.length > 0
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
