const express = require('express');

const { requireAuthenticated } = require('../middleware/auth');
const {
  ensureAccountAccessSubscription,
  isAccountAccessSubscription,
  listSubscriptionsForUser
} = require('../services/subscription-service');
const { listWorkspacesForSubscription } = require('../services/platform-service');
const { listCredentialMembershipsForEmail } = require('../services/org-admin-service');

const router = express.Router();

router.get('/account', requireAuthenticated, async (req, res, next) => {
  try {
    const subscriptions = (await listSubscriptionsForUser(req.user)).filter((subscription) => !isAccountAccessSubscription(subscription));
    const credentialMemberships = await listCredentialMembershipsForEmail(req.user.email);
    const membershipWorkspaceIds = uniqueWorkspaceIds(credentialMemberships);
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

    if (credentialMemberships.length > 0) {
      const accountAccessSubscription = await ensureAccountAccessSubscription(req.user);
      const workspaces = await listWorkspacesForSubscription(accountAccessSubscription, { membershipWorkspaceIds });
      if (subscriptions.length === 0) {
        return res.redirect(303, `/organizations/${accountAccessSubscription.id}`);
      }

      organizations.push({
        subscription: {
          ...accountAccessSubscription,
          organization: 'Credential memberships',
          plan: 'portal',
          interest: 'organizations you belong to'
        },
        workspaces,
        hasWorkspaces: workspaces.length > 0,
        organizationsPath: `/organizations/${accountAccessSubscription.id}`
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

function uniqueWorkspaceIds(memberships = []) {
  return [...new Set(memberships.map((membership) => membership.workspaceId).filter(Boolean))];
}

module.exports = router;
