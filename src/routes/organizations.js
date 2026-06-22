const express = require('express');

const { requireAuthenticated } = require('../middleware/auth');
const { authorize } = require('../middleware/authorization');
const { getSubscriptionForUser } = require('../services/subscription-service');
const {
  deleteWorkspaceForSubscription,
  disableWorkspaceForSubscription,
  listWorkspacesForSubscription,
  registerWorkspaceForSubscription
} = require('../services/platform-service');
const {
  getOrganizationBranding,
  listCredentialMembershipsForEmail
} = require('../services/org-admin-service');
const { writeAuditEvent } = require('../services/audit-service');

const router = express.Router();
router.use('/organizations', requireAuthenticated);

router.get('/organizations/:subscriptionId', authorize('workspace.view'), async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const membershipWorkspaceIds = await getCredentialMembershipWorkspaceIds(req);
    const organizations = await decorateOrganizations(await listWorkspacesForSubscription(subscription, { membershipWorkspaceIds }));

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

router.post('/organizations/:subscriptionId', authorize('workspace.register'), async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
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

router.post('/organizations/:subscriptionId/:workspaceId/disable', authorize('workspace.manage'), async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const workspace = await disableWorkspaceForSubscription(subscription, req.params.workspaceId, true);
    await writeAuditEvent('organization.workspace.disabled', {
      subscriptionId: subscription.id,
      workspaceId: workspace.id,
      organization: workspace.organization,
      actorEmail: subscription.email
    });
    res.redirect(303, `/organizations/${subscription.id}`);
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:subscriptionId/:workspaceId/enable', authorize('workspace.manage'), async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const workspace = await disableWorkspaceForSubscription(subscription, req.params.workspaceId, false);
    await writeAuditEvent('organization.workspace.enabled', {
      subscriptionId: subscription.id,
      workspaceId: workspace.id,
      organization: workspace.organization,
      actorEmail: subscription.email
    });
    res.redirect(303, `/organizations/${subscription.id}`);
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:subscriptionId/:workspaceId/delete', authorize('workspace.manage'), async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const workspace = await deleteWorkspaceForSubscription(subscription, req.params.workspaceId);
    await writeAuditEvent('organization.workspace.deleted', {
      subscriptionId: subscription.id,
      workspaceId: workspace.id,
      organization: workspace.organization,
      actorEmail: subscription.email
    });
    res.redirect(303, `/organizations/${subscription.id}`);
  } catch (error) {
    next(error);
  }
});

async function decorateOrganizations(organizations) {
  return Promise.all(organizations.map(async (organization) => {
    const branding = await getOrganizationBranding(organization.id);
    return {
      ...organization,
      brandInitial: organization.organization?.trim()?.charAt(0)?.toUpperCase() || 'V',
      brandPrimaryColor: branding?.primaryColor || '#1769e0',
      brandAccentColor: branding?.accentColor || '#00b7c7',
      brandLogoDataUrl: branding?.logoDataUrl || ''
    };
  }));
}

async function getCredentialMembershipWorkspaceIds(req) {
  const memberships = await listCredentialMembershipsForEmail(req.user.email);
  return [...new Set(memberships.map((membership) => membership.workspaceId).filter(Boolean))];
}

async function loadSubscription(req) {
  const subscription = await getSubscriptionForUser(req.params.subscriptionId, req.user);
  if (!subscription) {
    const error = new Error('Subscriber session not found.');
    error.status = 404;
    throw error;
  }
  return subscription;
}

module.exports = router;
