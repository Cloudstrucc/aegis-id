const express = require('express');

const { requireAuthenticated } = require('../middleware/auth');
const { authorize } = require('../middleware/authorization');
const { getSubscriptionForUser } = require('../services/subscription-service');
const { getWorkspaceForSubscription } = require('../services/platform-service');
const {
  createConnectedApp,
  createConnectedAppSecret,
  deleteConnectedApp,
  exportConnectedAppLogsCsv,
  importConnectedAppCertificate,
  revealConnectedAppSecret,
  revokeConnectedAppSecret,
  setConnectedAppStatus,
  updateConnectedApp
} = require('../services/connected-app-service');
const { writeAuditEvent } = require('../services/audit-service');

const router = express.Router();
router.use('/dashboard', requireAuthenticated);

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/connected-apps', authorize('connectedApps.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  const app = await createConnectedApp(workspace, subscription, req.body);
  await audit('connected_app.created', subscription, workspace, { appId: app.id, clientId: app.clientId });
  res.redirect(303, connectedAppsPath(subscription.id, workspace.id, app.id));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/connected-apps/:appId/update', authorize('connectedApps.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  const app = await updateConnectedApp(workspace, subscription, req.params.appId, req.body);
  await audit('connected_app.updated', subscription, workspace, { appId: app.id, clientId: app.clientId });
  res.redirect(303, connectedAppsPath(subscription.id, workspace.id, app.id));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/connected-apps/:appId/status', authorize('connectedApps.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  const app = await setConnectedAppStatus(workspace, subscription, req.params.appId, req.body.status);
  await audit('connected_app.status.changed', subscription, workspace, { appId: app.id, clientId: app.clientId, status: app.status });
  res.redirect(303, connectedAppsPath(subscription.id, workspace.id, app.id));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/connected-apps/:appId/delete', authorize('connectedApps.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  const app = await deleteConnectedApp(workspace, subscription, req.params.appId);
  await audit('connected_app.deleted', subscription, workspace, { appId: app.id, clientId: app.clientId });
  res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}#connected-apps`);
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/connected-apps/:appId/secrets', authorize('connectedApps.credentials.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  const result = await createConnectedAppSecret(workspace, subscription, req.params.appId, req.body);
  req.session.connectedAppSecret = {
    appId: result.app.id,
    secretId: result.secret.id,
    value: result.secret.value,
    expiresAt: result.secret.expiresAt
  };
  await audit('connected_app.secret.created', subscription, workspace, { appId: result.app.id, secretId: result.secret.id });
  res.redirect(303, connectedAppsPath(subscription.id, workspace.id, result.app.id));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/connected-apps/:appId/secrets/:secretId/reveal', authorize('connectedApps.credentials.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  const pending = req.session.connectedAppSecretRevealRequest;
  const acceptedChallengeId = pending &&
    pending.appId === req.params.appId &&
    pending.secretId === req.params.secretId &&
    Date.parse(pending.expiresAt || '') > Date.now()
    ? pending.challengeId
    : '';
  const result = await revealConnectedAppSecret(workspace, subscription, req.params.appId, req.params.secretId, {
    acceptedChallengeId,
    reason: req.body.reason
  });
  if (result.status === 'revealed') {
    req.session.connectedAppSecretReveal = {
      appId: result.app.id,
      secretId: result.secret.id,
      value: result.secret.value,
      expiresAt: result.secret.revealExpiresAt
    };
    delete req.session.connectedAppSecretRevealRequest;
    await audit('connected_app.secret.revealed', subscription, workspace, { appId: result.app.id, secretId: result.secret.id, walletChallengeId: result.challenge.id });
  } else {
    req.session.connectedAppSecretRevealRequest = {
      appId: result.app.id,
      secretId: result.secret.id,
      challengeId: result.challenge.id,
      expiresAt: result.challenge.expiresAt
    };
    await audit('connected_app.secret.reveal_challenge_sent', subscription, workspace, { appId: result.app.id, secretId: result.secret.id, walletChallengeId: result.challenge.id });
  }
  res.redirect(303, connectedAppsPath(subscription.id, workspace.id, result.app.id));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/connected-apps/:appId/secrets/:secretId/revoke', authorize('connectedApps.credentials.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  const app = await revokeConnectedAppSecret(workspace, subscription, req.params.appId, req.params.secretId);
  await audit('connected_app.secret.revoked', subscription, workspace, { appId: app.id, secretId: req.params.secretId });
  res.redirect(303, connectedAppsPath(subscription.id, workspace.id, app.id));
}));

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/admin/connected-apps/:appId/certificates', authorize('connectedApps.credentials.manage'), withOrg(async ({ subscription, workspace, req, res }) => {
  const app = await importConnectedAppCertificate(workspace, subscription, req.params.appId, req.body);
  await audit('connected_app.certificate.imported', subscription, workspace, { appId: app.id });
  res.redirect(303, connectedAppsPath(subscription.id, workspace.id, app.id));
}));

router.get('/dashboard/:subscriptionId/orgs/:workspaceId/admin/connected-apps/:appId/logs.csv', authorize('connectedApps.logs.export'), withOrg(async ({ workspace, req, res }) => {
  const csv = await exportConnectedAppLogsCsv({
    workspaceId: workspace.id,
    appId: req.params.appId,
    category: req.query.category,
    search: req.query.search
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="aegis-connected-app-${req.params.appId}-logs.csv"`);
  res.send(csv);
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

function connectedAppsPath(subscriptionId, workspaceId, appId) {
  return `/dashboard/${subscriptionId}/orgs/${workspaceId}?connectedAppId=${encodeURIComponent(appId)}#connected-apps`;
}

module.exports = router;
