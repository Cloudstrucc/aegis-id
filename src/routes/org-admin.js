const express = require('express');

const { requireAuthenticated } = require('../middleware/auth');
const { authorize } = require('../middleware/authorization');
const { getSubscriptionForUser } = require('../services/subscription-service');
const { getWorkspaceForSubscription } = require('../services/platform-service');
const {
  acceptCoAdminChallenge,
  createClaimDefinition,
  createOrgUnit,
  createRole,
  deleteClaimDefinition,
  deleteOrgUnit,
  deleteRole,
  grantCredentialConsent,
  issueCredential,
  markCredentialAccepted,
  reissueCredentialInvitation,
  resetAllProfileValidations,
  resetCredentialProfileValidation,
  requestCredentialConsent,
  requestCoAdmin,
  revokeCoAdmin,
  revokeCredential,
  submitAdminIdentityVerification,
  updateBranding,
  updateClaimDefinition,
  updateCredentialProfile,
  updateOrgUnit,
  updateWorkspacePolicy,
  updateRole
} = require('../services/org-admin-service');
const { writeAuditEvent } = require('../services/audit-service');

const router = express.Router();
router.use('/dashboard', requireAuthenticated);

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials', authorize('org.credentials.issue'), withOrg(async ({ subscription, workspace, req, res }) => {
  const credential = await issueCredential(workspace, subscription, req.body);
  await audit('org.credential.invited', subscription, workspace, { credentialId: credential.id });
  res.redirect(303, orgAdminPath(subscription.id, workspace.id, credential.id));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials/:credentialId/accept', authorize('org.credentials.accept'), withOrg(async ({ subscription, workspace, req, res }) => {
  await markCredentialAccepted(workspace, subscription, req.params.credentialId);
  await audit('org.credential.accepted', subscription, workspace, { credentialId: req.params.credentialId });
  res.redirect(303, orgAdminPath(subscription.id, workspace.id, req.params.credentialId));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials/:credentialId/revoke', authorize('org.credentials.revoke'), withOrg(async ({ subscription, workspace, req, res }) => {
  await revokeCredential(workspace, subscription, req.params.credentialId, req.body.reason);
  await audit('org.credential.revoked', subscription, workspace, { credentialId: req.params.credentialId });
  res.redirect(303, orgAdminPath(subscription.id, workspace.id, req.params.credentialId));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials/:credentialId/update', authorize('org.credentials.update'), withOrg(async ({ subscription, workspace, req, res }) => {
  await updateCredentialProfile(workspace, subscription, req.params.credentialId, req.body);
  await audit('org.credential.updated', subscription, workspace, { credentialId: req.params.credentialId });
  res.redirect(303, orgAdminPath(subscription.id, workspace.id, req.params.credentialId));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials/:credentialId/reset-validation', authorize('org.adminAssurance.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  await resetCredentialProfileValidation(workspace, subscription, req.params.credentialId);
  await audit('org.credential.validation.reset', subscription, workspace, { credentialId: req.params.credentialId });
  res.redirect(303, orgAdminPath(subscription.id, workspace.id, req.params.credentialId));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials/:credentialId/reinvite', authorize('org.credentials.reinvite'), withOrg(async ({ subscription, workspace, req, res }) => {
  await reissueCredentialInvitation(workspace, subscription, req.params.credentialId, req.body);
  await audit('org.credential.reinvited', subscription, workspace, { credentialId: req.params.credentialId });
  res.redirect(303, orgAdminPath(subscription.id, workspace.id, req.params.credentialId));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials/:credentialId/consent/request', authorize('org.consent.request'), withOrg(async ({ subscription, workspace, req, res }) => {
  await requestCredentialConsent(workspace, subscription, req.params.credentialId, req.body);
  await audit('org.credential.consent.requested', subscription, workspace, { credentialId: req.params.credentialId });
  res.redirect(303, orgAdminPath(subscription.id, workspace.id, req.params.credentialId));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials/:credentialId/consent/grant', authorize('org.consent.grant'), withOrg(async ({ subscription, workspace, req, res }) => {
  await grantCredentialConsent(workspace, subscription, req.params.credentialId, req.body);
  await audit('org.credential.consent.granted', subscription, workspace, { credentialId: req.params.credentialId });
  res.redirect(303, orgAdminPath(subscription.id, workspace.id, req.params.credentialId));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials/:credentialId/co-admin/request', authorize('org.coadmin.request'), withOrg(async ({ subscription, workspace, req, res }) => {
  await requestCoAdmin(workspace, subscription, req.params.credentialId);
  await audit('org.coadmin.requested', subscription, workspace, { credentialId: req.params.credentialId });
  res.redirect(303, orgAdminPath(subscription.id, workspace.id, req.params.credentialId));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/co-admin/:requestId/:side/accept', authorize('org.coadmin.accept'), withOrg(async ({ subscription, workspace, req, res }) => {
  await acceptCoAdminChallenge(workspace, subscription, req.params.requestId, req.params.side);
  await audit('org.coadmin.challenge.accepted', subscription, workspace, {
    requestId: req.params.requestId,
    side: req.params.side
  });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#credential-admin`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/credentials/:credentialId/co-admin/revoke', authorize('org.coadmin.revoke'), withOrg(async ({ subscription, workspace, req, res }) => {
  await revokeCoAdmin(workspace, subscription, req.params.credentialId);
  await audit('org.coadmin.revoked', subscription, workspace, { credentialId: req.params.credentialId });
  res.redirect(303, orgAdminPath(subscription.id, workspace.id, req.params.credentialId));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/roles', authorize('org.roles.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  await createRole(workspace, subscription, req.body);
  await audit('org.role.created', subscription, workspace, { name: req.body.name });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#roles-claims`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/roles/:roleId/delete', authorize('org.roles.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  await deleteRole(workspace, subscription, req.params.roleId);
  await audit('org.role.deleted', subscription, workspace, { roleId: req.params.roleId });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#roles-claims`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/roles/:roleId/update', authorize('org.roles.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  await updateRole(workspace, subscription, req.params.roleId, req.body);
  await audit('org.role.updated', subscription, workspace, { roleId: req.params.roleId });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#roles-claims`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/claims', authorize('org.claims.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  await createClaimDefinition(workspace, subscription, req.body);
  await audit('org.claim.created', subscription, workspace, { key: req.body.key });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#roles-claims`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/claims/:claimId/delete', authorize('org.claims.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  await deleteClaimDefinition(workspace, subscription, req.params.claimId);
  await audit('org.claim.deleted', subscription, workspace, { claimId: req.params.claimId });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#roles-claims`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/claims/:claimId/update', authorize('org.claims.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  await updateClaimDefinition(workspace, subscription, req.params.claimId, req.body);
  await audit('org.claim.updated', subscription, workspace, { claimId: req.params.claimId });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#roles-claims`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/org-units', authorize('org.units.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  await createOrgUnit(workspace, subscription, req.body);
  await audit('org.unit.created', subscription, workspace, { name: req.body.name });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#org-structure`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/org-units/:unitId/update', authorize('org.units.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  await updateOrgUnit(workspace, subscription, req.params.unitId, req.body);
  await audit('org.unit.updated', subscription, workspace, { unitId: req.params.unitId });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#org-structure`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/org-units/:unitId/delete', authorize('org.units.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  await deleteOrgUnit(workspace, subscription, req.params.unitId);
  await audit('org.unit.deleted', subscription, workspace, { unitId: req.params.unitId });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#org-structure`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/branding', authorize('org.branding.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  await updateBranding(workspace, subscription, req.body);
  await audit('org.branding.updated', subscription, workspace, { paletteId: req.body.paletteId });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#org-branding`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/identity-verification', authorize('org.adminAssurance.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  const verification = await submitAdminIdentityVerification(workspace, subscription, req.body);
  await audit('org.admin.identity.verification.submitted', subscription, workspace, {
    status: verification.status,
    provider: verification.provider
  });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#credential-admin`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/policy', authorize('org.policy.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  await updateWorkspacePolicy(workspace, subscription, req.body);
  await audit('org.policy.updated', subscription, workspace, { policyScope: req.body.policyScope });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#workspace-settings`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/profile-validations/reset-all', authorize('org.adminAssurance.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  await resetAllProfileValidations(workspace, subscription);
  await audit('org.profile-validations.reset-all', subscription, workspace);
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#workspace-settings`);
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
