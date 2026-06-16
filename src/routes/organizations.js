const express = require('express');

const { getSubscription } = require('../services/subscription-service');
const {
  listWorkspacesForSubscription,
  registerWorkspaceForSubscription
} = require('../services/platform-service');
const { writeAuditEvent } = require('../services/audit-service');

const router = express.Router();

router.get('/organizations/:subscriptionId', async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req.params.subscriptionId);
    const organizations = await listWorkspacesForSubscription(subscription);

    res.render('pages/organizations', {
      title: 'Organizations',
      description: 'Choose an organization workspace for Vanguard Cloud Services - Aegis ID.',
      subscription,
      organizations,
      hasOrganizations: organizations.length > 0,
      welcome: req.query.welcome === '1',
      formValues: {
        organization: subscription.organization || '',
        role: 'administrator'
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:subscriptionId', async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req.params.subscriptionId);
    const workspace = await registerWorkspaceForSubscription(subscription, req.body);

    await writeAuditEvent('organization.workspace.registered', {
      subscriptionId: subscription.id,
      workspaceId: workspace.id,
      organization: workspace.organization,
      role: workspace.role
    });

    res.redirect(303, `${workspace.dashboardPath}?welcome=1`);
  } catch (error) {
    next(error);
  }
});

async function loadSubscription(subscriptionId) {
  const subscription = await getSubscription(subscriptionId);
  if (!subscription) {
    const error = new Error('Subscriber session not found.');
    error.status = 404;
    throw error;
  }
  return subscription;
}

module.exports = router;
