// Who may reach the platform-wide administration area.
//
// Three populations sign in here, and only one of them runs the installation:
//
//   * **The deployment operator** — whoever runs this copy of Aegis ID.
//     Sign-in methods, the mail and SMS transport, registration codes that
//     grant a paid plan without payment, break-glass redemption, and the
//     registers that list every wallet, domain and delivered message on the
//     installation. All of it is deployment-wide.
//   * **Subscribers** — they chose a plan and own the organizations under it.
//     Theirs is organization scope: `/orgs/<handle>/settings`, their own
//     wallets, their own people, their own domain. Not the deployment.
//   * **Credential holders** — they exist only because an organization invited
//     them. They get a `portal-account` subscription record so they have
//     somewhere to sign in to, but they bought nothing and administer nothing.
//
// This gate used to admit anyone in the first *two* groups, on the reasoning
// that a subscriber who administers their own organization is an
// administrator. That holds for an installation with one customer on it. On a
// hosted installation it meant every paying customer could open
// /admin/wallets and read every other customer's holders — their Wallet IDs,
// their email addresses and their phone numbers — and /admin/notifications
// and see who had been sent what. Nothing was misconfigured; the scope was
// simply wrong.
//
// Organization scope is unchanged and is where a subscriber administers their
// own organization. Every equivalent exists there already:
// `/orgs/<handle>/settings/wallets` lists the wallets holding a credential
// from that organization, and the domain is claimed and proven at
// `/organizations/<id>/<workspace>/domain`.

const config = require('../config');
const { listWorkspacesForSubscription } = require('./platform-service');
const { isWorkspaceAdmin } = require('./org-admin-service');
const {
  isAccountAccessSubscription,
  listSubscriptions,
  listSubscriptionsForUser
} = require('./subscription-service');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * A subscription the user actually holds, as opposed to the placeholder created
 * so an invited credential holder has somewhere to sign in.
 */
function isOwnedSubscription(subscription) {
  return !isAccountAccessSubscription(subscription);
}

/**
 * The subscriptions this user owns and administers at least one workspace in.
 *
 * Still what it was, and still the right question for organization scope —
 * `approver-recovery-service` asks it to find a user's own root wallets. It is
 * no longer, on its own, the answer to "may this person administer the
 * platform".
 */
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

/**
 * The account to treat as the operator when none is configured.
 *
 * The owner of the oldest subscription that administers an organization: on
 * every installation that exists today that is the person who stood it up, and
 * it is a fact about the data rather than a guess about a name. It is
 * deterministic, it cannot be acquired later by signing up, and
 * `PLATFORM_OPERATOR_EMAILS` overrides it entirely.
 *
 * The alternative — refusing everybody until the variable is set — locks the
 * operator of a running installation out of the settings they need in order to
 * notice that it happened.
 */
async function inferDeploymentOperatorEmail() {
  const owned = (await listSubscriptions())
    .filter(isOwnedSubscription)
    .sort((left, right) => Date.parse(left.createdAt || 0) - Date.parse(right.createdAt || 0));

  for (const subscription of owned) {
    const workspaces = await listWorkspacesForSubscription(subscription);
    if (workspaces.some((workspace) => isWorkspaceAdmin(workspace, subscription))) {
      return normalizeEmail(subscription.email);
    }
  }
  return null;
}

/** Whether this deployment names its operators rather than inferring one. */
function hasConfiguredOperators() {
  return config.app.platformOperatorEmails.length > 0;
}

async function isPlatformOperator(user) {
  const email = normalizeEmail(user?.email);
  if (!email) {
    return false;
  }

  if (hasConfiguredOperators()) {
    return config.app.platformOperatorEmails.includes(email);
  }

  // Cheap test first: a credential holder and a subscriber with no
  // organization are both out either way, and this avoids reading every
  // subscription on the installation to answer for them.
  const administered = await listAdministeredSubscriptions(user);
  if (administered.length === 0) {
    return false;
  }

  return (await inferDeploymentOperatorEmail()) === email;
}

/**
 * Kept under its old name because it is still the platform gate and every
 * `adminAnyWorkspace` policy reaches it. What changed is the answer.
 */
async function canViewAdminOperations(user) {
  return isPlatformOperator(user);
}

async function assertAdminOperations(user) {
  if (await canViewAdminOperations(user)) {
    return;
  }

  const error = new Error(
    'Platform administration is for the operator of this deployment. ' +
      'Your own organization is administered from its settings page.'
  );
  error.status = 403;
  throw error;
}

module.exports = {
  assertAdminOperations,
  canViewAdminOperations,
  hasConfiguredOperators,
  inferDeploymentOperatorEmail,
  isOwnedSubscription,
  isPlatformOperator,
  listAdministeredSubscriptions
};
