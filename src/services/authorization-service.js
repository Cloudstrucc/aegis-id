const POLICY_TYPES = new Set([
  'public',
  'anonymous',
  'authenticated',
  'adminAnyWorkspace',
  'subscription',
  'orgPrivilege',
  'external'
]);

const POLICIES = Object.freeze({
  'public.home': policy('public.home', 'public', 'page', 'read', {
    description: 'Anonymous landing page and static product content.'
  }),
  'admin.health.view': policy('admin.health.view', 'adminAnyWorkspace', 'health', 'read', {
    description: 'Human-readable service health dashboard for organization administrators.'
  }),
  'auth.register': policy('auth.register', 'anonymous', 'user', 'create', {
    fields: ['displayName', 'email', 'phone', 'organization', 'plan', 'interest', 'preferredMfa']
  }),
  'auth.login': policy('auth.login', 'anonymous', 'session', 'create', {
    fields: ['email', 'password']
  }),
  'auth.secondFactor': policy('auth.secondFactor', 'anonymous', 'session', 'verify', {
    fields: ['code', 'method']
  }),
  'auth.passkey': policy('auth.passkey', 'anonymous', 'session-passkey', 'verify'),
  'auth.logout': policy('auth.logout', 'authenticated', 'session', 'delete'),
  'account.view': policy('account.view', 'authenticated', 'account', 'read'),
  'subscription.create': policy('subscription.create', 'authenticated', 'subscription', 'create', {
    fields: ['organization', 'plan', 'interest', 'notes', 'consent']
  }),
  'workspace.view': policy('workspace.view', 'subscription', 'workspace', 'read'),
  'workspace.register': policy('workspace.register', 'subscription', 'workspace', 'create', {
    fields: ['organization', 'role']
  }),
  'workspace.manage': policy('workspace.manage', 'subscription', 'workspace', 'update'),
  'platform.view': policy('platform.view', 'orgPrivilege', 'integration', 'read', {
    privilegeId: 'integrations.view'
  }),
  'platform.configure': policy('platform.configure', 'orgPrivilege', 'integration', 'update', {
    privilegeId: 'integrations.manage',
    fields: ['stepIndex', 'testMode']
  }),
  'platform.test': policy('platform.test', 'orgPrivilege', 'integration', 'execute', {
    privilegeId: 'integrations.manage'
  }),
  'connectedApps.view': policy('connectedApps.view', 'orgPrivilege', 'connected-app', 'read', {
    privilegeId: 'connectedApps.view'
  }),
  'connectedApps.manage': policy('connectedApps.manage', 'orgPrivilege', 'connected-app', 'manage', {
    privilegeId: 'connectedApps.manage',
    fields: [
      'name',
      'description',
      'redirectUris',
      'postLogoutRedirectUris',
      'grantTypes',
      'scopes',
      'claimKeys',
      'onboardingMode',
      'walletChallengePolicy',
      'tokenEndpointAuthMethod'
    ]
  }),
  'connectedApps.credentials.manage': policy('connectedApps.credentials.manage', 'orgPrivilege', 'connected-app-credential', 'manage', {
    privilegeId: 'connectedApps.credentials.manage',
    fields: ['label', 'expiresAt', 'certificatePem']
  }),
  'connectedApps.logs.export': policy('connectedApps.logs.export', 'orgPrivilege', 'connected-app-log', 'export', {
    privilegeId: 'connectedApps.logs.export'
  }),
  'developerApiDocs.view': policy('developerApiDocs.view', 'authenticated', 'developer-api-docs', 'read'),
  'issuerOrganization.invite': policy('issuerOrganization.invite', 'orgPrivilege', 'issuer-organization', 'create', {
    privilegeId: 'integrations.manage'
  }),
  'org.credentials.issue': policy('org.credentials.issue', 'orgPrivilege', 'credential', 'create', {
    privilegeId: 'credentials.issue',
    fields: ['holderEmail', 'displayName', 'personType', 'divisionId', 'roleIds', 'requestedClaimKeys', 'inviteTtlDays']
  }),
  'org.credentials.accept': policy('org.credentials.accept', 'orgPrivilege', 'credential', 'update', {
    privilegeId: 'credentials.update'
  }),
  'org.credentials.update': policy('org.credentials.update', 'orgPrivilege', 'credential', 'update', {
    privilegeId: 'credentials.update'
  }),
  'org.credentials.reinvite': policy('org.credentials.reinvite', 'orgPrivilege', 'credential', 'update', {
    privilegeId: 'credentials.issue'
  }),
  'org.credentials.revoke': policy('org.credentials.revoke', 'orgPrivilege', 'credential', 'delete', {
    privilegeId: 'credentials.revoke',
    fields: ['reason']
  }),
  'org.consent.request': policy('org.consent.request', 'orgPrivilege', 'claim-consent', 'create', {
    privilegeId: 'claims.request',
    fields: ['requestedClaimKeys']
  }),
  'org.consent.grant': policy('org.consent.grant', 'orgPrivilege', 'claim-consent', 'update', {
    privilegeId: 'claims.request',
    fields: ['sharedClaimKeys']
  }),
  'org.coadmin.request': policy('org.coadmin.request', 'orgPrivilege', 'co-admin', 'create', {
    privilegeId: 'admin.assurance.manage'
  }),
  'org.coadmin.accept': policy('org.coadmin.accept', 'orgPrivilege', 'co-admin', 'approve', {
    privilegeId: 'admin.assurance.manage'
  }),
  'org.coadmin.revoke': policy('org.coadmin.revoke', 'orgPrivilege', 'co-admin', 'delete', {
    privilegeId: 'admin.assurance.manage'
  }),
  'org.roles.manage': policy('org.roles.manage', 'orgPrivilege', 'role', 'manage', {
    privilegeId: 'roles.manage',
    fields: ['name', 'description', 'adminRole', 'privilegeIds', 'privilegeTemplate']
  }),
  'org.claims.manage': policy('org.claims.manage', 'orgPrivilege', 'claim', 'manage', {
    privilegeId: 'claims.manage',
    fields: ['key', 'label', 'type', 'required', 'defaultValue']
  }),
  'org.units.manage': policy('org.units.manage', 'orgPrivilege', 'org-unit', 'manage', {
    privilegeId: 'orgchart.manage',
    fields: ['name', 'parentId', 'description', 'roleIds', 'claimKeys', 'avatarDataUrl']
  }),
  'org.branding.manage': policy('org.branding.manage', 'orgPrivilege', 'branding', 'update', {
    privilegeId: 'branding.manage',
    fields: ['paletteId', 'primaryColor', 'accentColor', 'backgroundColor', 'textColor', 'logoDataUrl']
  }),
  'org.adminAssurance.manage': policy('org.adminAssurance.manage', 'orgPrivilege', 'admin-assurance', 'manage', {
    privilegeId: 'admin.assurance.manage'
  }),
  'org.policy.manage': policy('org.policy.manage', 'orgPrivilege', 'workspace-policy', 'update', {
    privilegeId: 'admin.assurance.manage',
    fields: ['policyScope', 'inviteTtlDays', 'ledgerRetentionDays', 'adminRevalidationEnabled', 'adminRevalidationMonths']
  }),
  'oidcDemo.use': policy('oidcDemo.use', 'authenticated', 'oidc-demo', 'execute'),
  'api.verifiedId.issue': policy('api.verifiedId.issue', 'external', 'verified-id-issuance', 'create', {
    description: 'Demo/API issuance request. Protect with deployment-level API controls before production use.'
  }),
  'api.verifiedId.present': policy('api.verifiedId.present', 'external', 'verified-id-presentation', 'create'),
  'api.verifiedId.callback': policy('api.verifiedId.callback', 'external', 'verified-id-callback', 'update', {
    description: 'Callback guarded by VID_CALLBACK_API_KEY when configured.'
  }),
  'api.aries.lab': policy('api.aries.lab', 'external', 'aries-lab', 'execute', {
    description: 'Lab-only ACA-Py integration surface.'
  }),
  'api.wallet.mobile': policy('api.wallet.mobile', 'external', 'mobile-wallet', 'execute', {
    description: 'Mobile wallet API surface. Requests are scoped by invitation/challenge payloads.'
  }),
  'api.walletChallenge.external': policy('api.walletChallenge.external', 'external', 'wallet-challenge', 'execute', {
    description: 'External app challenge API. Production deployments should pair this with client authentication.'
  }),
  'api.oidcProvider.external': policy('api.oidcProvider.external', 'external', 'oidc-provider', 'execute'),
  'api.connectedApps.oauth': policy('api.connectedApps.oauth', 'external', 'connected-app-oauth', 'execute', {
    description: 'OIDC/OAuth endpoints used by registered relying-party applications.'
  }),
  'api.connectedApps.client': policy('api.connectedApps.client', 'external', 'connected-app-api', 'execute', {
    description: 'Client-authenticated API endpoints for connected relying-party applications.'
  })
});

function policy(id, type, resource, operation, options = {}) {
  if (!POLICY_TYPES.has(type)) {
    throw new Error(`Unknown policy type: ${type}`);
  }

  return Object.freeze({
    id,
    type,
    resource,
    operation,
    privilegeId: options.privilegeId || null,
    fields: Object.freeze(options.fields || []),
    description: options.description || ''
  });
}

function getPolicy(policyId) {
  return POLICIES[policyId] || null;
}

function requirePolicy(policyId) {
  const selected = getPolicy(policyId);
  if (!selected) {
    throw new Error(`Unknown authorization policy: ${policyId}`);
  }
  return selected;
}

function listPolicies() {
  return Object.values(POLICIES);
}

function isExternalPolicy(policyId) {
  return requirePolicy(policyId).type === 'external';
}

module.exports = {
  getPolicy,
  isExternalPolicy,
  listPolicies,
  requirePolicy
};
