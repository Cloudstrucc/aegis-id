// Who may reach the platform-wide administration area.
//
// Two different populations sign in here, and only one of them is a customer:
//
//   * **Subscribers** — they chose a plan, they own a subscription, and the
//     organizations under it are theirs. Platform settings are theirs to set.
//   * **Credential holders** — they exist only because an organization invited
//     them. They get a `portal-account` subscription record so they have
//     somewhere to sign in to, but they bought nothing and administer nothing.
//
// The second group must never reach /admin. Sign-in methods, notification
// delivery, wallet revocation and registration codes are platform-wide, so an
// invited holder deciding how everybody signs in would be a plain privilege
// escalation. Filtering those placeholder records out is what makes that
// explicit rather than incidental.

const { listWorkspacesForSubscription } = require('./platform-service');
const { isWorkspaceAdmin } = require('./org-admin-service');
const { isAccountAccessSubscription, listSubscriptionsForUser } = require('./subscription-service');

/**
 * A subscription the user actually holds, as opposed to the placeholder created
 * so an invited credential holder has somewhere to sign in.
 */
function isOwnedSubscription(subscription) {
  return !isAccountAccessSubscription(subscription);
}

/** The subscriptions this user owns and administers at least one workspace in. */
async function listAdministeredSubscriptions(user) {
  if (!user) {
    return [];
  }

  const owned = (await listSubscriptionsForUser(user)).filter(isOwnedSubscription);
  const administered = [];
  for (const subscription of owned) {
    const workspaces = await listWorkspacesForSubscription(subscription);
    if (workspaces.some((workspace) => isWorkspaceAdmin(workspace, subscription))) {
      administered.push(subscription);
    }
  }
  return administered;
}

async function canViewAdminOperations(user) {
  return (await listAdministeredSubscriptions(user)).length > 0;
}

async function assertAdminOperations(user) {
  if (await canViewAdminOperations(user)) {
    return;
  }

  const error = new Error(
    'Platform administration is available to subscribers who administer their own organization.'
  );
  error.status = 403;
  throw error;
}

module.exports = {
  assertAdminOperations,
  canViewAdminOperations,
  isOwnedSubscription,
  listAdministeredSubscriptions
};
