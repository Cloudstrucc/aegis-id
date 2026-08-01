// Builds the signed-in landing view: the subscriptions a user owns plus the
// organizations they hold a credential in.
//
// This is what an authenticated user sees at "/", so it lives in a service
// rather than a route handler and is shared by both entry points.

const {
  ensureAccountAccessSubscription,
  isAccountAccessSubscription,
  listSubscriptionsForUser
} = require('./subscription-service');
const { listWorkspacesForSubscription } = require('./platform-service');
const { listCredentialMembershipsForEmail } = require('./org-admin-service');

function uniqueWorkspaceIds(memberships = []) {
  return [...new Set(memberships.map((membership) => membership.workspaceId).filter(Boolean))];
}

/**
 * Returns either `{ redirectTo }` — when the user has nothing to choose between
 * and should go straight to their organization — or `{ view }` with the model
 * for the landing page.
 */
async function buildAccountLanding(user) {
  const subscriptions = (await listSubscriptionsForUser(user)).filter(
    (subscription) => !isAccountAccessSubscription(subscription)
  );
  const credentialMemberships = await listCredentialMembershipsForEmail(user.email);
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
    const accountAccessSubscription = await ensureAccountAccessSubscription(user);
    const workspaces = await listWorkspacesForSubscription(accountAccessSubscription, {
      membershipWorkspaceIds
    });

    // A credential holder who owns no subscription has exactly one destination,
    // so send them there instead of showing a list of one.
    if (subscriptions.length === 0) {
      return { redirectTo: `/organizations/${accountAccessSubscription.id}` };
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

  return {
    view: {
      title: 'Home',
      description: 'Your Vanguard Cloud Services - Aegis ID organizations and subscriptions.',
      user,
      organizations,
      hasOrganizations: organizations.length > 0
    }
  };
}

module.exports = { buildAccountLanding };
