// Tenant resolution: which organizations a person belongs to, and what they may
// do inside each one.
//
// This sits deliberately beside `admin-access-service` rather than replacing it,
// because the two answer different questions and only one of them is about
// money:
//
//   * **admin-access-service** — may this person open *platform* settings?
//     Sign-in methods, notification delivery, registration codes, break-glass
//     and account recovery decide how the whole deployment behaves, so that gate
//     stays keyed on owning a real subscription. An invited credential holder
//     must never reach it, and that is tested.
//   * **tenant-access-service** (here) — may this person administer *this*
//     organization? Adapters, registered wallets, the organization's domain,
//     its people and its roles belong to the organization, so the answer comes
//     from membership of that organization and nothing else.
//
// Resolution is `user → membership → organization`, with no subscription in the
// path. That is what lets an invited administrator administer the organization
// that invited them without widening platform access by a single page — the
// Azure shape the product brief asks for, where a tenant administrator runs
// their own tenant and the platform operator runs the platform.

const { listAllWorkspaces, workspaceBelongsToSubscription } = require('./platform-service');
const { listSubscriptionsForUser } = require('./subscription-service');
const {
  getViewerAccessForEmail,
  isWorkspaceAdmin,
  listCredentialMembershipsForEmail
} = require('./org-admin-service');
const { getIdentity } = require('./organization-identity-service');

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeHandle(value = '') {
  return String(value || '').trim().toLowerCase();
}

/** Is this person a member of the workspace at all — by membership or credential? */
function isMemberOf(workspace, email, credentialWorkspaceIds) {
  if (normalizeEmail(workspace.ownerEmail) === email) {
    return true;
  }
  if ((workspace.members || []).some((member) => normalizeEmail(member.email) === email)) {
    return true;
  }
  return credentialWorkspaceIds.has(workspace.id);
}

function initialsFor(name = '') {
  const words = String(name || '').trim().split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (!words.length) {
    return 'OR';
  }
  return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
}

/**
 * Every organization this person belongs to, with the role that gets them in.
 *
 * `isAdmin` is the union of the two things that can make somebody an
 * administrator: workspace membership (ownership, the co-admin wallet challenge,
 * or a role assignment now that those are kept in step) and holding a role
 * marked `adminRole`. Both are checked because either alone would miss cases
 * that the product treats as administration.
 */
async function listTenantsForUser(user) {
  if (!user?.email) {
    return [];
  }

  const email = normalizeEmail(user.email);
  const [workspaces, memberships] = await Promise.all([
    listAllWorkspaces(),
    listCredentialMembershipsForEmail(email)
  ]);
  const credentialWorkspaceIds = new Set(memberships.map((membership) => membership.workspaceId));

  const tenants = [];
  for (const workspace of workspaces) {
    if (!isMemberOf(workspace, email, credentialWorkspaceIds)) {
      continue;
    }

    const identity = await getIdentity(workspace.id);
    const access = await getViewerAccessForEmail(workspace, email);
    const isOwner = normalizeEmail(workspace.ownerEmail) === email;

    tenants.push({
      workspaceId: workspace.id,
      organization: workspace.organization,
      handle: identity?.handle || null,
      initials: initialsFor(workspace.organization),
      domain: identity?.domain || null,
      isDomainVerified: Boolean(identity?.isVerified),
      displayIdentity: identity?.displayIdentity || workspace.organization,
      isOwner,
      // The membership role and the org roles are now kept in step, so either is
      // sufficient. Checked together anyway: ownership and the co-admin wallet
      // challenge write only the first, role assignment writes both.
      isAdmin: isWorkspaceAdmin(workspace, { email }) || access.canAdminister,
      roleLabel: roleLabelFor({ isOwner, access }),
      assignedRoleLabels: access.assignedRoleLabels,
      privilegeIds: access.privilegeIds,
      settingsPath: identity?.handle ? `/orgs/${identity.handle}/settings` : null,
      publicPath: identity?.handle ? `/orgs/${identity.handle}` : null,
      updatedAt: workspace.updatedAt || workspace.createdAt || null
    });
  }

  return tenants.sort((left, right) => String(left.organization).localeCompare(String(right.organization)));
}

function roleLabelFor({ isOwner, access }) {
  if (isOwner) {
    return 'Owner';
  }
  if (access.canAdminister) {
    return 'Administrator';
  }
  if (access.assignedRoleLabels?.length) {
    return access.assignedRoleLabels.join(', ');
  }
  return 'Member';
}

/** One tenant by its handle, or null if this person is not a member of it. */
async function getTenantForUser(user, handle) {
  const wanted = normalizeHandle(handle);
  if (!wanted) {
    return null;
  }
  const tenants = await listTenantsForUser(user);
  return tenants.find((tenant) => normalizeHandle(tenant.handle) === wanted) || null;
}

/**
 * The workspace record behind a tenant, for callers that need to pass it to the
 * org-admin service. Membership is re-checked here rather than trusted from the
 * caller, so this is never a way to reach a workspace by guessing a handle.
 */
async function getTenantWorkspaceForUser(user, handle) {
  const tenant = await getTenantForUser(user, handle);
  if (!tenant) {
    return null;
  }
  const workspaces = await listAllWorkspaces();
  const workspace = workspaces.find((candidate) => candidate.id === tenant.workspaceId) || null;
  return workspace ? { tenant, workspace } : null;
}

function notFound() {
  // Deliberately a 404 rather than a 403: a handle somebody is not a member of
  // should not be distinguishable from one that does not exist, or the URL
  // becomes a way to enumerate organizations.
  const error = new Error('Organization not found.');
  error.status = 404;
  return error;
}

function forbidden(organization) {
  const error = new Error(`Administrator access to ${organization} is required.`);
  error.status = 403;
  return error;
}

/** Resolve the tenant in the route and require administration of it. */
async function assertTenantAdmin(user, handle) {
  const resolved = await getTenantWorkspaceForUser(user, handle);
  if (!resolved) {
    throw notFound();
  }
  if (!resolved.tenant.isAdmin) {
    throw forbidden(resolved.tenant.organization);
  }
  return resolved;
}

/** Resolve the tenant in the route and require one privilege within it. */
async function assertTenantPrivilege(user, handle, privilegeId) {
  const resolved = await getTenantWorkspaceForUser(user, handle);
  if (!resolved) {
    throw notFound();
  }
  if (resolved.tenant.isAdmin || resolved.tenant.privilegeIds.includes(privilegeId)) {
    return resolved;
  }
  const error = new Error('This organization role does not allow that action.');
  error.status = 403;
  throw error;
}

/**
 * Which of this person's subscription ids reaches a given workspace.
 *
 * The organization-scoped surfaces resolve tenancy from the handle, but the
 * older per-organization pages (domain, root wallets) are still addressed as
 * `/organizations/:subscriptionId/:workspaceId/...`. Rather than reach those
 * pages by a path that depends on who is looking — the thing this split is
 * meant to end — the tenant URL is stable and this translates it at the edge.
 *
 * The owner's own subscription is preferred; an invited administrator reaches
 * the same workspace through their portal-account record, which is already how
 * `workspaceBelongsToSubscription` resolves membership.
 */
async function resolveSubscriptionIdForTenant(user, workspace) {
  const subscriptions = await listSubscriptionsForUser(user);
  const owning = subscriptions.find((subscription) => subscription.id === workspace.subscriptionId);
  if (owning) {
    return owning.id;
  }
  const member = subscriptions.find((subscription) => workspaceBelongsToSubscription(workspace, subscription));
  return member?.id || null;
}

/** Every organization this person administers. Drives the header and the index. */
async function listAdministeredTenants(user) {
  return (await listTenantsForUser(user)).filter((tenant) => tenant.isAdmin);
}

async function canAdministerAnyTenant(user) {
  return (await listAdministeredTenants(user)).length > 0;
}

module.exports = {
  assertTenantAdmin,
  assertTenantPrivilege,
  canAdministerAnyTenant,
  getTenantForUser,
  getTenantWorkspaceForUser,
  listAdministeredTenants,
  listTenantsForUser,
  resolveSubscriptionIdForTenant
};
