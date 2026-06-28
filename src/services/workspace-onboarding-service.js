const { listIssuerOrganizations } = require('./issuer-organization-service');

function onboardingPath(subscriptionId, workspaceId) {
  return `/dashboard/${subscriptionId}/orgs/${workspaceId}/onboarding`;
}

async function getWorkspaceWalletOnboardingState(subscription, workspace) {
  const issuerOrganizations = await listIssuerOrganizations(subscription.id, workspace.id);
  const prioritizedInvitations = [...issuerOrganizations].sort((left, right) => {
    const leftConnected = isWalletConnected(left) ? 1 : 0;
    const rightConnected = isWalletConnected(right) ? 1 : 0;

    if (leftConnected !== rightConnected) {
      return rightConnected - leftConnected;
    }

    return Date.parse(right.updatedAt || right.createdAt || 0) - Date.parse(left.updatedAt || left.createdAt || 0);
  });
  const latestInvitation = prioritizedInvitations[0] || null;
  const connectedInvitation = prioritizedInvitations.find(isWalletConnected) || null;
  const walletSetupComplete = Boolean(connectedInvitation);

  return {
    issuerOrganizations: prioritizedInvitations,
    latestInvitation,
    connectedInvitation,
    walletSetupComplete,
    requiresWalletSetup: requiresWalletSetup(workspace) && !walletSetupComplete,
    onboardingPath: onboardingPath(subscription.id, workspace.id)
  };
}

function isWalletConnected(record) {
  return Boolean(
    record && (
      record.status === 'connected' ||
      record.issuerConnectionId ||
      record.holderConnectionId
    )
  );
}

function requiresWalletSetup(workspace) {
  return (workspace?.role || '') === 'administrator';
}

module.exports = {
  getWorkspaceWalletOnboardingState,
  isWalletConnected,
  onboardingPath,
  requiresWalletSetup
};
