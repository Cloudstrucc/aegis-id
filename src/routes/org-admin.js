const express = require('express');

const { requireAuthenticated } = require('../middleware/auth');
const { getSubscriptionForUser } = require('../services/subscription-service');
const { getWorkspaceForSubscription } = require('../services/platform-service');
const {
  acceptCoAdminChallenge,
  createClaimDefinition,
  createRole,
  deleteClaimDefinition,
  deleteRole,
  issueCredential,
  markCredentialAccepted,
  requestCoAdmin,
  revokeCoAdmin,
  revokeCredential,
  updateBranding,
  updateCredentialProfile
} = require('../services/org-admin-service');
const { writeAuditEvent } = require('../services/audit-service');

const router = express.Router();
router.use('/dashboard', requireAuthenticated);

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials', withOrg(async ({ subscription, workspace, req, res }) => {
  const credential = await issueCredential(workspace, subscription, req.body);
  await audit('org.credential.invited', subscription, workspace, { credentialId: credential.id });
  res.redirect(303, orgAdminPath(subscription.id, workspace.id, credential.id));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials/:credentialId/accept', withOrg(async ({ subscription, workspace, req, res }) => {
  await markCredentialAccepted(workspace, subscription, req.params.credentialId);
  await audit('org.credential.accepted', subscription, workspace, { credentialId: req.params.credentialId });
  res.redirect(303, orgAdminPath(subscription.id, workspace.id, req.params.credentialId));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials/:credentialId/revoke', withOrg(async ({ subscription, workspace, req, res }) => {
  await revokeCredential(workspace, subscription, req.params.credentialId, req.body.reason);
  await audit('org.credential.revoked', subscription, workspace, { credentialId: req.params.credentialId });
  res.redirect(303, orgAdminPath(subscription.id, workspace.id, req.params.credentialId));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials/:credentialId/update', withOrg(async ({ subscription, workspace, req, res }) => {
  await updateCredentialProfile(workspace, subscription, req.params.credentialId, req.body);
  await audit('org.credential.updated', subscription, workspace, { credentialId: req.params.credentialId });
  res.redirect(303, orgAdminPath(subscription.id, workspace.id, req.params.credentialId));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials/:credentialId/co-admin/request', withOrg(async ({ subscription, workspace, req, res }) => {
  await requestCoAdmin(workspace, subscription, req.params.credentialId);
  await audit('org.coadmin.requested', subscription, workspace, { credentialId: req.params.credentialId });
  res.redirect(303, orgAdminPath(subscription.id, workspace.id, req.params.credentialId));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/co-admin/:requestId/:side/accept', withOrg(async ({ subscription, workspace, req, res }) => {
  await acceptCoAdminChallenge(workspace, subscription, req.params.requestId, req.params.side);
  await audit('org.coadmin.challenge.accepted', subscription, workspace, {
    requestId: req.params.requestId,
    side: req.params.side
  });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#credential-admin`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials/:credentialId/co-admin/revoke', withOrg(async ({ subscription, workspace, req, res }) => {
  await revokeCoAdmin(workspace, subscription, req.params.credentialId);
  await audit('org.coadmin.revoked', subscription, workspace, { credentialId: req.params.credentialId });
  res.redirect(303, orgAdminPath(subscription.id, workspace.id, req.params.credentialId));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/roles', withOrg(async ({ subscription, workspace, req, res }) => {
  await createRole(workspace, subscription, req.body);
  await audit('org.role.created', subscription, workspace, { name: req.body.name });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#roles-claims`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/roles/:roleId/delete', withOrg(async ({ subscription, workspace, req, res }) => {
  await deleteRole(workspace, subscription, req.params.roleId);
  await audit('org.role.deleted', subscription, workspace, { roleId: req.params.roleId });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#roles-claims`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/claims', withOrg(async ({ subscription, workspace, req, res }) => {
  await createClaimDefinition(workspace, subscription, req.body);
  await audit('org.claim.created', subscription, workspace, { key: req.body.key });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#roles-claims`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/claims/:claimId/delete', withOrg(async ({ subscription, workspace, req, res }) => {
  await deleteClaimDefinition(workspace, subscription, req.params.claimId);
  await audit('org.claim.deleted', subscription, workspace, { claimId: req.params.claimId });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#roles-claims`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/branding', withOrg(async ({ subscription, workspace, req, res }) => {
  await updateBranding(workspace, subscription, req.body);
  await audit('org.branding.updated', subscription, workspace, { paletteId: req.body.paletteId });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#org-branding`);
}));

function withOrg(handler) {
  return async (req, res, next) => {
    try {
      const subscription = await loadSubscription(req);
      const workspace = await loadWorkspace(subscription, req.params.workspaceId);
      await handler({ subscription, workspace, req, res });
    } catch (error) {
      next(error);
    }
  };
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

async function loadWorkspace(subscription, workspaceId) {
  const workspace = await getWorkspaceForSubscription(subscription, workspaceId);
  if (!workspace) {
    const error = new Error('Organization workspace not found for this subscriber.');
    error.status = 404;
    throw error;
  }
  return workspace;
}

async function audit(type, subscription, workspace, data = {}) {
  return writeAuditEvent(type, {
    subscriptionId: subscription.id,
    workspaceId: workspace.id,
    actorEmail: subscription.email,
    ...data
  });
}

function orgAdminPath(subscriptionId, workspaceId, credentialId) {
  return `/dashboard/${subscriptionId}/orgs/${workspaceId}#credential-${credentialId}`;
}

module.exports = router;
