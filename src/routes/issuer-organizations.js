const express = require('express');

const { requireAuthenticated } = require('../middleware/auth');
const { getSubscriptionForUser } = require('../services/subscription-service');
const { getOrCreateWorkspace, getWorkspaceForSubscription } = require('../services/platform-service');
const {
  createIssuerOrganizationInvitation,
  registerIssuerOrganizationConnection
} = require('../services/issuer-organization-service');
const { writeAuditEvent } = require('../services/audit-service');

const router = express.Router();

router.post('/dashboard/:subscriptionId/issuer-organizations/invitations', requireAuthenticated, async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const workspace = await getOrCreateWorkspace(subscription);
    const issuerOrganization = await createIssuerOrganizationInvitation(subscription, workspace);

    await writeAuditEvent('issuer-organization.invitation.created', {
      subscriptionId: subscription.id,
      organizationId: workspace.id,
      organizationName: workspace.organization,
      invitationId: issuerOrganization.invitationId
    });

    res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#issuer-orgs`);
  } catch (error) {
    next(error);
  }
});

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/issuer-organizations/invitations', requireAuthenticated, async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const workspace = await loadWorkspace(subscription, req.params.workspaceId);
    const issuerOrganization = await createIssuerOrganizationInvitation(subscription, workspace);

    await writeAuditEvent('issuer-organization.invitation.created', {
      subscriptionId: subscription.id,
      workspaceId: workspace.id,
      organizationId: workspace.id,
      organizationName: workspace.organization,
      invitationId: issuerOrganization.invitationId
    });

    res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#issuer-orgs`);
  } catch (error) {
    next(error);
  }
});

router.post('/api/issuer-organizations/:organizationId/connections', async (req, res, next) => {
  try {
    const issuerOrganization = await registerIssuerOrganizationConnection(req.params.organizationId, req.body || {});
    await writeAuditEvent('issuer-organization.connection.registered', {
      subscriptionId: issuerOrganization.subscriptionId,
      organizationId: issuerOrganization.organizationId,
      organizationName: issuerOrganization.organizationName,
      issuerConnectionId: issuerOrganization.issuerConnectionId,
      holderConnectionId: issuerOrganization.holderConnectionId
    });

    res.status(202).json({ ok: true, issuerOrganization });
  } catch (error) {
    next(error);
  }
});

async function loadSubscription(req) {
  const subscription = await getSubscriptionForUser(req.params.subscriptionId, req.user);
  if (!subscription) {
    const error = new Error('Subscriber dashboard not found.');
    error.status = 404;
    throw error;
  }
  return subscription;
}

async function loadWorkspace(subscription, workspaceId) {
  const workspace = await getWorkspaceForSubscription(subscription, workspaceId);
  if (!workspace) {
    const error = new Error('Organization workspace not found for this subscriber.');
    error.status = 404;
    throw error;
  }
  return workspace;
}

module.exports = router;
