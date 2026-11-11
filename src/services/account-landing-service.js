// Builds the signed-in landing view: the organizations a user administers, the
// ones they hold a credential in, and — for somebody who has neither yet —
// what creating one would give them and what it would be limited to.
//
// This is what an authenticated user sees at "/", so it lives in a service
// rather than a route handler and is shared by both entry points.
//
// Two things this page has to be careful about:
//
// A person who has just registered has no subscription record at all, so there
// is no plan to read a limit from. Saying nothing leaves them on an empty page
// with a button; claiming a plan they have not got would be a lie. What is
// true is that creating an organization starts a subscription on a known plan,
// so that plan is described as prospective — `isProspective` — and the view
// says "would" rather than "does".
//
// And a credential holder's organizations are not the same thing as the ones
// they administer. They are listed separately, under their own heading, rather
// than folded into one grid where an invitation looks like a workspace the
// person owns.

const {
  ensureAccountAccessSubscription,
  isAccountAccessSubscription,
  listSubscriptionsForUser
} = require('./subscription-service');
const { listWorkspacesForSubscription } = require('./platform-service');
const { listCredentialMembershipsForEmail } = require('./org-admin-service');
const {
  describeHeadlinePrice,
  effectiveEntitlement,
  getPlan,
  DEFAULT_PLAN_ID
} = require('./plan-service');
const { intendedPlan } = require('./signup-intent-service');

function uniqueWorkspaceIds(memberships = []) {
  return [...new Set(memberships.map((membership) => membership.workspaceId).filter(Boolean))];
}

/** First letter of an organization name, for the tile mark. */
function markFor(name) {
  const trimmed = String(name || '').trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : '?';
}

function formatDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * The organizations a person belongs to because somebody invited them, one
 * entry per organization rather than one per credential.
 *
 * A holder can carry several credentials in the same organization — an
 * employee badge and a contractor badge — and three tiles for one company
 * would read as three companies.
 */
function summariseMemberships(memberships, destination) {
  const byWorkspace = new Map();

  for (const membership of memberships) {
    const key = membership.workspaceId || membership.organizationName;
    const existing = byWorkspace.get(key);
    const entry = existing || {
      workspaceId: membership.workspaceId,
      organizationName: membership.organizationName || 'Organization',
      mark: markFor(membership.organizationName),
      credentialCount: 0,
      roleLabels: [],
      // Accepted anywhere in the organization outranks a second invitation
      // that is still outstanding: the person is already a member.
      isAccepted: false,
      organizationsPath: destination
    };

    entry.credentialCount += 1;
    entry.isAccepted = entry.isAccepted || membership.status === 'accepted';
    for (const role of membership.roleLabels || []) {
      if (!entry.roleLabels.includes(role)) {
        entry.roleLabels.push(role);
      }
    }

    byWorkspace.set(key, entry);
  }

  return [...byWorkspace.values()].map((entry) => ({
    ...entry,
    statusLabel: entry.isAccepted ? 'Member' : 'Invited',
    statusKey: entry.isAccepted ? 'accepted' : 'invited',
    roleSummary: entry.roleLabels.length > 0 ? entry.roleLabels.join(', ') : 'No role assigned yet',
    credentialSummary: `${entry.credentialCount} credential${entry.credentialCount === 1 ? '' : 's'}`
  }));
}

const STANDING_LABELS = Object.freeze({
  trialing: 'Trial active',
  'trial-expired': 'Trial expired',
  active: 'Active',
  grandfathered: 'Active',
  'past-due': 'Payment past due',
  unpaid: 'Not paid for yet',
  lapsed: 'Lapsed'
});

/**
 * What this person is entitled to right now, in the words the page says it in.
 *
 * With no subscription there is nothing to read, so the plan that creating one
 * would start is described instead — `intendedPlan` is the same value
 * `/subscribe` will actually use, so the page and the form cannot disagree.
 */
function describeEntitlement(subscriptions, workspaceCounts, session) {
  const primary = subscriptions[0] || null;

  if (!primary) {
    const plan = intendedPlan(session) || getPlan(DEFAULT_PLAN_ID);
    return {
      isProspective: true,
      planLabel: plan.label,
      planBlurb: plan.blurb,
      price: describeHeadlinePrice(plan),
      standingLabel: 'Not started',
      standingKey: 'invited',
      organizationName: null,
      rows: limitRows(plan, null),
      endsOn: null,
      otherSubscriptions: 0
    };
  }

  const { plan, signedUpFor, standing, endsAt } = effectiveEntitlement(primary);
  const used = workspaceCounts.get(primary.id) ?? null;

  return {
    isProspective: false,
    planLabel: plan.label,
    planBlurb: plan.blurb,
    price: describeHeadlinePrice(plan),
    standingLabel: STANDING_LABELS[standing] || 'Active',
    standingKey: standing === 'active' || standing === 'grandfathered' || standing === 'trialing' ? 'accepted' : 'invited',
    // Named so somebody with two subscriptions can tell which one this is.
    organizationName: primary.organization || null,
    // Only worth saying when the two differ — otherwise it reads as a downgrade
    // notice to somebody whose plan is working exactly as bought.
    signedUpForLabel: signedUpFor.id === plan.id ? null : signedUpFor.label,
    rows: limitRows(plan, used),
    endsOn: formatDate(endsAt),
    otherSubscriptions: Math.max(0, subscriptions.length - 1)
  };
}

/**
 * The same limits `describeLimits` states, worded for a narrow column.
 *
 * That helper writes for the pricing page, where "5 credentials per
 * organization" stands on its own. Here it sits beside the label
 * "Credentials" and under a row that already says how many organizations
 * there are, so it repeats both of them and wraps onto a second line doing it.
 */
function limitRows(plan, used) {
  const organizations =
    plan.maxWorkspaces === null
      ? used === null
        ? 'No limit'
        : `${used} created, no limit`
      : used === null
        ? `${plan.maxWorkspaces} included`
        : `${used} of ${plan.maxWorkspaces} created`;

  const credentials =
    plan.maxCredentialsPerWorkspace === null
      ? plan.includedCredentials
        ? `${plan.includedCredentials} included, then $${(plan.perCredentialCents / 100).toFixed(0)} each`
        : 'No limit'
      : `${plan.maxCredentialsPerWorkspace} per organization`;

  return [
    { label: 'Organizations', value: organizations },
    { label: 'Credentials', value: credentials },
    { label: 'Your own domain', value: plan.customDomain ? 'Included' : 'Enterprise plan only' },
    { label: 'Price', value: describeHeadlinePrice(plan) }
  ];
}

/**
 * What an organization is for, said once.
 *
 * The page these appear on is the one a person reaches straight after
 * registering, where the only honest question is "what is this for?" — so the
 * tiles describe capabilities rather than selling a tier.
 */
const ORGANIZATION_CAPABILITIES = Object.freeze([
  {
    icon: 'badge',
    title: 'Issue credentials',
    body: 'Invite people, assign roles and claims, and issue credentials their wallet holds. Revoke one and it stops working everywhere it was accepted.'
  },
  {
    icon: 'plug',
    title: 'Connect your applications',
    body: 'Aegis-issued OIDC and OAuth for your own apps, and adapters for Entra, Keycloak, Okta and SAML when sign-in should come from somewhere else.'
  },
  {
    icon: 'chain',
    title: 'Wallet-approved actions',
    body: 'Raise a challenge and have it approved or declined from a wallet. Both answers are recorded on an evidence chain you can read back.'
  },
  {
    icon: 'globe',
    title: 'An identity of your own',
    body: 'A permanent handle, a public organization page, and a domain you can prove with a DNS record. Root wallets keep recovery in your hands.'
  }
]);

/**
 * Returns `{ view }` with the model for the landing page.
 *
 * It no longer short-circuits a credential holder straight into their
 * organization: this page is also where somebody creates an organization of
 * their own, and a holder who was sent past it could not reach that.
 */
async function buildAccountLanding(user, { session } = {}) {
  const subscriptions = (await listSubscriptionsForUser(user)).filter(
    (subscription) => !isAccountAccessSubscription(subscription)
  );
  const credentialMemberships = await listCredentialMembershipsForEmail(user.email);
  const membershipWorkspaceIds = uniqueWorkspaceIds(credentialMemberships);
  const organizations = [];
  const workspaceCounts = new Map();

  for (const subscription of subscriptions) {
    const workspaces = await listWorkspacesForSubscription(subscription);
    workspaceCounts.set(subscription.id, workspaces.length);
    const { plan, standing } = effectiveEntitlement(subscription);
    organizations.push({
      subscription,
      workspaces,
      hasWorkspaces: workspaces.length > 0,
      mark: markFor(subscription.organization),
      planLabel: plan.label,
      statusLabel: STANDING_LABELS[standing] || 'Active',
      statusKey: standing === 'active' || standing === 'grandfathered' || standing === 'trialing' ? 'accepted' : 'invited',
      workspaceSummary:
        workspaces.length > 0
          ? `${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'}`
          : 'No workspace registered yet',
      organizationsPath: `/organizations/${subscription.id}`
    });
  }

  let memberships = [];
  if (credentialMemberships.length > 0) {
    const accountAccessSubscription = await ensureAccountAccessSubscription(user);
    // Loaded for its side effect on the portal subscription's own view: the
    // destination below is the page that lists them in full.
    await listWorkspacesForSubscription(accountAccessSubscription, { membershipWorkspaceIds });
    memberships = summariseMemberships(
      credentialMemberships,
      `/organizations/${accountAccessSubscription.id}`
    );
  }

  return {
    view: {
      title: 'Home',
      description: 'Your Aegis ID organizations and subscriptions.',
      user,
      organizations,
      hasOrganizations: organizations.length > 0,
      memberships,
      hasMemberships: memberships.length > 0,
      capabilities: ORGANIZATION_CAPABILITIES,
      entitlement: describeEntitlement(subscriptions, workspaceCounts, session)
    }
  };
}

module.exports = { buildAccountLanding };
