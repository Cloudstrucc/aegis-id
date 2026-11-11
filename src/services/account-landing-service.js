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
const {
  countCredentialsByWorkspace,
  listBrandingByWorkspace,
  listCredentialMembershipsForEmail,
  readLogoScale
} = require('./org-admin-service');
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
/**
 * The logo and palette to draw an organization's mark with.
 *
 * First workspace that has a logo wins; a subscription with several
 * organizations under it is drawn by the first one that has said what it looks
 * like. Empty strings rather than nulls, because the template tests them.
 */
function brandMark(workspaceIds, branding) {
  for (const workspaceId of workspaceIds) {
    const record = branding.get(workspaceId);
    if (record && record.logoDataUrl) {
      return {
        logoDataUrl: record.logoDataUrl,
        // The panel's own trim: this is the 40px plate.
        logoScale: readLogoScale(record, 'panel'),
        primaryColor: record.primaryColor || '',
        accentColor: record.accentColor || ''
      };
    }
  }
  const first = workspaceIds.map((id) => branding.get(id)).find(Boolean);
  return {
    logoDataUrl: '',
    logoScale: 82,
    primaryColor: first?.primaryColor || '',
    accentColor: first?.accentColor || ''
  };
}

function summariseMemberships(memberships, destination, branding) {
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
    ...brandMark([entry.workspaceId], branding),
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
function describeEntitlement(subscriptions, workspaceCounts, session, issuedTotal = 0) {
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
      // Nothing has been used yet, so there is nothing to meter.
      capacity: null,
      credentials: null,
      createNote: describeCreateNote(plan, null),
      endsOn: null,
      otherSubscriptions: 0
    };
  }

  const { plan, signedUpFor, standing, endsAt } = effectiveEntitlement(primary);
  const used = workspaceCounts.get(primary.id) ?? null;
  const capacity = describeCapacity(plan, used);
  const credentials = describeCredentialAllowance(plan, issuedTotal);

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
    // The meter already says how many organizations of how many, so the list
    // underneath does not say it again.
    rows: limitRows(plan, used).filter((row) => !(capacity && row.label === 'Organizations')),
    capacity,
    credentials,
    createNote: describeCreateNote(plan, used),
    endsOn: formatDate(endsAt),
    otherSubscriptions: Math.max(0, subscriptions.length - 1)
  };
}

/**
 * Organizations used against organizations allowed, as a figure and a bar.
 *
 * The one number on this panel that moves as the account is used, so it is
 * drawn rather than listed. A plan with no ceiling has no bar — a meter that
 * can never fill says nothing, and an unlimited plan showing 3% used reads as
 * a limit the customer does not have.
 */
function describeCapacity(plan, used) {
  if (used === null || plan.maxWorkspaces === null) {
    return null;
  }
  const allowed = Math.max(1, plan.maxWorkspaces);
  return {
    label: `${used} of ${plan.maxWorkspaces}`,
    percent: Math.min(100, Math.round((used / allowed) * 100)),
    isFull: used >= plan.maxWorkspaces
  };
}

/**
 * Credentials issued against what the plan allows.
 *
 * A metered plan has no ceiling by design — the customer pays for what they
 * issue rather than being cut off — so it gets a figure and no bar. A bar that
 * can never fill would read as a limit they do not have.
 */
function describeCredentialAllowance(plan, issued) {
  const allowance = plan.maxCredentialsPerWorkspace;
  if (allowance === null) {
    return {
      issued,
      label: plan.includedCredentials
        ? `${plan.includedCredentials} included, then $${(plan.perCredentialCents / 100).toFixed(0)} each`
        : 'no limit on this plan',
      percent: null,
      isFull: false
    };
  }
  return {
    issued,
    label: `of ${allowance} per organization`,
    percent: Math.min(100, Math.round((issued / Math.max(1, allowance)) * 100)),
    isFull: issued >= allowance
  };
}

/** What the row that creates the next organization says underneath itself. */
function describeCreateNote(plan, used) {
  if (plan.maxWorkspaces === null) {
    return 'Your plan has no organization limit.';
  }
  if (used !== null && used >= plan.maxWorkspaces) {
    return `The ${plan.label} plan includes ${plan.maxWorkspaces === 1 ? 'one' : plan.maxWorkspaces}. Compare plans to add more.`;
  }
  const remaining = used === null ? plan.maxWorkspaces : plan.maxWorkspaces - used;
  return `${remaining} more included on the ${plan.label} plan.`;
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
  // One read of every organization's state, shared by all of them below. The
  // panel says how many credentials have actually been issued against what the
  // plan allows, and a figure that is not the real one is worse there than no
  // figure at all.
  const credentialCounts = await countCredentialsByWorkspace();
  // The organization's own logo and palette, so a tile shows the mark its
  // holders recognise rather than a letter on the platform's gradient.
  const branding = await listBrandingByWorkspace();
  const organizations = [];
  const workspaceCounts = new Map();

  for (const subscription of subscriptions) {
    const workspaces = await listWorkspacesForSubscription(subscription);
    workspaceCounts.set(subscription.id, workspaces.length);
    const { plan, standing } = effectiveEntitlement(subscription);
    const issued = workspaces.reduce(
      (total, workspace) => total + (credentialCounts.get(workspace.id) || 0),
      0
    );
    organizations.push({
      ...brandMark(workspaces.map((workspace) => workspace.id), branding),
      issued,
      issuedSummary: `${issued} credential${issued === 1 ? '' : 's'} issued`,
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
      `/organizations/${accountAccessSubscription.id}`,
      branding
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
      entitlement: describeEntitlement(
        subscriptions,
        workspaceCounts,
        session,
        organizations.reduce((total, entry) => total + entry.issued, 0)
      )
    }
  };
}

module.exports = { buildAccountLanding };
