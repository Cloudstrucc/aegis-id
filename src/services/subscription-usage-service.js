// What a subscription is actually using against what its plan allows.
//
// Kept in its own module because it needs both the workspace store and the
// credential store, and putting it in either would make plan-service circular.
// Nothing requires this back, so it stays a leaf.
//
// This is what the account page, the upgrade prompt and the billing admin all
// read, so the numbers a customer is shown and the numbers enforcement uses
// come from the same place.

const { listWorkspacesForSubscription } = require('./platform-service');
const { countCredentialsByWorkspace } = require('./org-admin-service');
const { effectiveEntitlement, describePrice } = require('./plan-service');

/** Remaining capacity, or null when the plan has no ceiling. */
function remaining(limit, used) {
  return limit === null ? null : Math.max(0, limit - used);
}

/**
 * A full picture of one subscription's plan, standing and usage.
 *
 * Every count is derived rather than stored, so it cannot drift from what the
 * enforcement checks see.
 */
async function summarizeUsage(subscription) {
  const entitlement = effectiveEntitlement(subscription);
  const [workspaces, credentialCounts] = await Promise.all([
    listWorkspacesForSubscription(subscription),
    countCredentialsByWorkspace()
  ]);

  const active = workspaces.filter((workspace) => workspace.status !== 'deleted');
  const perWorkspace = active.map((workspace) => {
    const used = credentialCounts.get(workspace.id) || 0;
    return {
      id: workspace.id,
      organization: workspace.organization,
      status: workspace.status || 'active',
      credentialsUsed: used,
      credentialLimit: entitlement.limits.maxCredentialsPerWorkspace,
      credentialsRemaining: remaining(entitlement.limits.maxCredentialsPerWorkspace, used),
      // True only for a capped plan that is full — a metered plan is never
      // "at capacity", it just costs more.
      atCapacity:
        entitlement.limits.maxCredentialsPerWorkspace !== null &&
        used >= entitlement.limits.maxCredentialsPerWorkspace
    };
  });

  const totalCredentials = perWorkspace.reduce((sum, workspace) => sum + workspace.credentialsUsed, 0);
  const billable = billableCredentials(entitlement.plan, totalCredentials);

  return {
    plan: entitlement.plan,
    signedUpFor: entitlement.signedUpFor,
    standing: entitlement.standing,
    // A customer whose plan is not in effect should be told, not left to work
    // out why issuing failed.
    isLimitedByStanding: !['active', 'trialing', 'grandfathered'].includes(entitlement.standing),
    trialEndsAt: entitlement.endsAt,
    priceLabel: describePrice(entitlement.plan),

    workspacesUsed: active.length,
    workspaceLimit: entitlement.limits.maxWorkspaces,
    workspacesRemaining: remaining(entitlement.limits.maxWorkspaces, active.length),
    canAddWorkspace:
      entitlement.limits.maxWorkspaces === null || active.length < entitlement.limits.maxWorkspaces,

    workspaces: perWorkspace,
    totalCredentials,
    ...billable
  };
}

/**
 * How many credentials are chargeable beyond the plan's included allowance.
 *
 * Reported for display now; Phase 5 uses the same figure when telling Stripe
 * what to bill, so the customer sees the number they are charged for.
 */
function billableCredentials(plan, totalCredentials) {
  if (!plan.perCredentialCents) {
    return { includedCredentials: null, billableCredentials: 0, estimatedOverageCents: 0 };
  }
  const included = plan.includedCredentials || 0;
  const billable = Math.max(0, totalCredentials - included);
  return {
    includedCredentials: included,
    billableCredentials: billable,
    estimatedOverageCents: billable * plan.perCredentialCents
  };
}

module.exports = { summarizeUsage };
