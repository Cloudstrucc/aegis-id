const { listWorkspacesForSubscription } = require('./platform-service');
const { isWorkspaceAdmin } = require('./org-admin-service');
const { listSubscriptionsForUser } = require('./subscription-service');

async function canViewAdminOperations(user) {
  if (!user) {
    return false;
  }

  const subscriptions = await listSubscriptionsForUser(user);
  for (const subscription of subscriptions) {
    const workspaces = await listWorkspacesForSubscription(subscription);
    if (workspaces.some((workspace) => isWorkspaceAdmin(workspace, subscription))) {
      return true;
    }
  }
  return false;
}

async function assertAdminOperations(user) {
  if (await canViewAdminOperations(user)) {
    return;
  }

  const error = new Error('Organization administrator access is required.');
  error.status = 403;
  throw error;
}

module.exports = {
  assertAdminOperations,
  canViewAdminOperations
};
