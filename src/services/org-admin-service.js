const crypto = require('node:crypto');
const QRCode = require('qrcode');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { revokeWorkspaceMemberRole, setWorkspaceMemberRole } = require('./platform-service');

const stateStore = new FileJsonStore(config.paths.orgAdmin, []);
const eventStore = new FileJsonStore(config.paths.orgAdminEvents, []);

const PALETTES = [
  {
    id: 'vanguard',
    name: 'Vanguard Default',
    primaryColor: '#0f4fa8',
    accentColor: '#149566',
    backgroundColor: '#f3f8fc',
    textColor: '#132033'
  },
  {
    id: 'federal-blue',
    name: 'Federal Blue',
    primaryColor: '#14345c',
    accentColor: '#2d9cdb',
    backgroundColor: '#f5f8fb',
    textColor: '#111827'
  },
  {
    id: 'secure-green',
    name: 'Secure Green',
    primaryColor: '#0f5f4d',
    accentColor: '#28a77a',
    backgroundColor: '#f3fbf8',
    textColor: '#17221f'
  },
  {
    id: 'executive-slate',
    name: 'Executive Slate',
    primaryColor: '#263445',
    accentColor: '#5f8fb8',
    backgroundColor: '#f6f8fb',
    textColor: '#151c24'
  },
  {
    id: 'civic-gold',
    name: 'Civic Gold',
    primaryColor: '#24324c',
    accentColor: '#c58b2a',
    backgroundColor: '#fbf8f1',
    textColor: '#1c2230'
  }
];

const DEFAULT_CLAIMS = [
  { key: 'employeeId', label: 'Employee ID', type: 'text', required: true, defaultValue: 'VCS-10027' },
  { key: 'displayName', label: 'Display name', type: 'text', required: true, defaultValue: 'Vanguard Team Member' },
  { key: 'email', label: 'Email', type: 'email', required: true, defaultValue: 'identity@vanguardcs.ca' },
  { key: 'department', label: 'Department', type: 'text', required: true, defaultValue: 'Cloud Services' },
  { key: 'employmentStatus', label: 'Employment status', type: 'text', required: true, defaultValue: 'active' },
  { key: 'assuranceLevel', label: 'Assurance level', type: 'text', required: true, defaultValue: 'FIDO2_YUBIKEY' }
];

const DEFAULT_ROLES = [
  {
    id: 'role-employee',
    name: 'Employee',
    description: 'Standard employee credential holder.',
    adminRole: false,
    privilegeIds: ['workspace.view', 'credentials.view.own', 'claims.view.own', 'ledger.view.own']
  },
  {
    id: 'role-contractor',
    name: 'Contractor',
    description: 'External contributor with portable proof of engagement.',
    adminRole: false,
    privilegeIds: ['workspace.view', 'credentials.view.own', 'claims.view.own', 'ledger.view.own']
  },
  {
    id: 'role-admin-eligible',
    name: 'Admin Eligible',
    description: 'Credential holder can be nominated for co-administration.',
    adminRole: false,
    privilegeIds: [
      'workspace.view',
      'credentials.view.own',
      'claims.view.own',
      'ledger.view.own',
      'admin.nomination.eligible'
    ]
  }
];

const PRIVILEGE_GROUPS = [
  {
    id: 'workspace',
    name: 'Workspace',
    description: 'Baseline access to the selected organization workspace.',
    privileges: [
      {
        id: 'workspace.view',
        name: 'View workspace',
        description: 'Open the org workspace, dashboard guidance, and non-sensitive org context.'
      },
      {
        id: 'org.profile.view',
        name: 'View org profile',
        description: 'See organization name, branding, divisions, and public wallet profile details.'
      }
    ]
  },
  {
    id: 'people',
    name: 'People and credentials',
    description: 'Controls who can inspect, invite, update, and revoke credential holders.',
    privileges: [
      {
        id: 'people.view',
        name: 'View people directory',
        description: 'See all credential holders and invitation status for the org.'
      },
      {
        id: 'credentials.view.own',
        name: 'View own credential',
        description: 'See only the holder credential, roles, claims, and wallet events for this user.'
      },
      {
        id: 'credentials.view.all',
        name: 'View all credentials',
        description: 'Open credential profile and transaction details for all holders.'
      },
      {
        id: 'credentials.issue',
        name: 'Issue credentials',
        description: 'Invite employees, contractors, or admins and generate wallet QR links.'
      },
      {
        id: 'credentials.update',
        name: 'Update credentials',
        description: 'Edit holder profile fields, role assignments, consent request scope, and expiry.'
      },
      {
        id: 'credentials.revoke',
        name: 'Revoke credentials',
        description: 'Disable an issued credential and preserve the audit record.'
      }
    ]
  },
  {
    id: 'configuration',
    name: 'Claims and roles',
    description: 'Defines what credentials contain and what a role is allowed to do.',
    privileges: [
      {
        id: 'roles.view',
        name: 'View roles',
        description: 'Read the role catalog and understand what each role permits.'
      },
      {
        id: 'roles.manage',
        name: 'Manage roles',
        description: 'Create, edit, revoke, and classify roles as admin or non-admin.'
      },
      {
        id: 'roles.assign',
        name: 'Assign roles',
        description: 'Apply one or more roles to a credential holder.'
      },
      {
        id: 'claims.view.own',
        name: 'View own claims',
        description: 'See the claims shared with this organization by the holder.'
      },
      {
        id: 'claims.view.all',
        name: 'View all claims',
        description: 'Inspect credential claims across the organization.'
      },
      {
        id: 'claims.manage',
        name: 'Manage claims',
        description: 'Create, edit, and revoke claim definitions used in credentials.'
      },
      {
        id: 'claims.request',
        name: 'Request claim consent',
        description: 'Ask holders to share additional or updated claims by wallet challenge.'
      }
    ]
  },
  {
    id: 'organization',
    name: 'Org structure and branding',
    description: 'Controls divisions, wallet visual context, and issuer configuration.',
    privileges: [
      {
        id: 'orgchart.view',
        name: 'View org chart',
        description: 'See sub-organizations, divisions, inherited roles, and requested claims.'
      },
      {
        id: 'orgchart.manage',
        name: 'Manage org chart',
        description: 'Create or remove divisions and assign default roles or claims.'
      },
      {
        id: 'branding.view',
        name: 'View branding',
        description: 'Preview the palette and logo shown in the mobile wallet.'
      },
      {
        id: 'branding.manage',
        name: 'Manage branding',
        description: 'Update the logo and color palette used in the org wallet context.'
      }
    ]
  },
  {
    id: 'integrations',
    name: 'Integrations and assurance',
    description: 'Platform setup, issuer invitations, and high-assurance admin operations.',
    privileges: [
      {
        id: 'integrations.view',
        name: 'View integrations',
        description: 'See configured Verified ID, YubiKey, OIDC, SAML, Keycloak, and Okta state.'
      },
      {
        id: 'integrations.manage',
        name: 'Manage integrations',
        description: 'Open setup wizards, test providers, and create org issuer invitations.'
      },
      {
        id: 'connectedApps.view',
        name: 'View connected apps',
        description: 'See relying-party app registrations, protocol settings, and non-secret configuration.'
      },
      {
        id: 'connectedApps.manage',
        name: 'Manage connected apps',
        description: 'Create, edit, disable, and configure relying-party applications that trust Aegis ID.'
      },
      {
        id: 'connectedApps.credentials.manage',
        name: 'Manage connected app credentials',
        description: 'Generate client secrets, import certificates, and rotate application credentials.'
      },
      {
        id: 'connectedApps.logs.view',
        name: 'View connected app logs',
        description: 'Review authentication, API, and wallet challenge events for relying-party applications.'
      },
      {
        id: 'connectedApps.logs.export',
        name: 'Export connected app logs',
        description: 'Export connected app authentication, API, and wallet challenge evidence as CSV.'
      },
      {
        id: 'admin.nomination.eligible',
        name: 'Admin nomination eligible',
        description: 'Marks a holder as eligible for co-admin promotion after wallet challenges.'
      },
      {
        id: 'admin.assurance.manage',
        name: 'Manage admin assurance',
        description: 'Submit or review administrator identity assurance requirements.'
      }
    ]
  },
  {
    id: 'ledger',
    name: 'Ledger and audit',
    description: 'Evidence for wallet challenges, decisions, promotions, and revocations.',
    privileges: [
      {
        id: 'ledger.view.own',
        name: 'View own ledger',
        description: 'See wallet challenge evidence associated with this holder.'
      },
      {
        id: 'ledger.view.org',
        name: 'View org ledger',
        description: 'See wallet challenge evidence for the organization.'
      },
      {
        id: 'ledger.export',
        name: 'Export ledger',
        description: 'Prepare evidence packages for audit, legal, or management review.'
      }
    ]
  }
];

const ALL_PRIVILEGE_IDS = PRIVILEGE_GROUPS.flatMap((group) => group.privileges.map((privilege) => privilege.id));
const HOLDER_BASE_PRIVILEGES = ['workspace.view', 'org.profile.view', 'credentials.view.own', 'claims.view.own', 'ledger.view.own'];
const ADMIN_BASE_PRIVILEGES = ALL_PRIVILEGE_IDS;

const ROLE_TEMPLATES = [
  {
    id: 'employee',
    name: 'Employee holder',
    description: 'Baseline holder access to their own credential, claims, and wallet ledger.',
    adminRole: false,
    privilegeIds: ['workspace.view', 'org.profile.view', 'credentials.view.own', 'claims.view.own', 'ledger.view.own']
  },
  {
    id: 'manager',
    name: 'Department manager',
    description: 'View people, org structure, and org ledger without changing credentials.',
    adminRole: false,
    privilegeIds: [
      'workspace.view',
      'org.profile.view',
      'people.view',
      'credentials.view.own',
      'credentials.view.all',
      'claims.view.own',
      'claims.view.all',
      'orgchart.view',
      'ledger.view.own',
      'ledger.view.org'
    ]
  },
  {
    id: 'issuer',
    name: 'Credential issuer',
    description: 'Invite and update holders, request consent, and view ledger evidence.',
    adminRole: false,
    privilegeIds: [
      'workspace.view',
      'org.profile.view',
      'people.view',
      'credentials.view.own',
      'credentials.view.all',
      'credentials.issue',
      'credentials.update',
      'roles.view',
      'roles.assign',
      'claims.view.own',
      'claims.view.all',
      'claims.request',
      'orgchart.view',
      'ledger.view.own',
      'ledger.view.org'
    ]
  },
  {
    id: 'auditor',
    name: 'Auditor',
    description: 'Read-only view of people, configuration, and audit evidence.',
    adminRole: false,
    privilegeIds: [
      'workspace.view',
      'org.profile.view',
      'people.view',
      'credentials.view.own',
      'credentials.view.all',
      'roles.view',
      'claims.view.own',
      'claims.view.all',
      'orgchart.view',
      'branding.view',
      'integrations.view',
      'ledger.view.own',
      'ledger.view.org',
      'ledger.export'
    ]
  },
  {
    id: 'admin',
    name: 'Organization admin',
    description: 'Full administrator role. Use sparingly and require wallet challenge approval.',
    adminRole: true,
    privilegeIds: ADMIN_BASE_PRIVILEGES
  }
];

const DEFAULT_INVITE_TTL_DAYS = 7;
const MAX_INVITE_TTL_DAYS = 365;
const DEFAULT_LEDGER_RETENTION_DAYS = 365;
const MAX_LEDGER_RETENTION_DAYS = 3650;
const DEFAULT_ADMIN_REVALIDATION_MONTHS = 6;
const MAX_ADMIN_REVALIDATION_MONTHS = 36;

const PERSON_TYPES = [
  { id: 'employee', name: 'Employee' },
  { id: 'contractor', name: 'Contractor' },
  { id: 'administrator', name: 'Administrator' }
];

async function getOrgAdminView(workspace, subscription, query = {}, options = {}) {
  const state = await getOrCreateState(workspace);
  const events = await listEvents(workspace.id);
  const allCredentials = await Promise.all(
    state.credentials.map((credential) => decorateCredential(credential, state, events, workspace, options))
  );
  const viewer = buildViewerAccess(workspace, subscription, state);
  const credentials = viewer.canViewAllCredentials
    ? allCredentials
    : allCredentials.filter((credential) => normalizeEmail(credential.holderEmail) === viewer.email);
  const activeCount = credentials.filter((credential) => credential.status === 'active').length;
  const invitedCount = credentials.filter((credential) => credential.status === 'invited').length;
  const revokedCount = credentials.filter((credential) => credential.status === 'revoked').length;
  const coAdminCount = credentials.filter((credential) => credential.coAdminStatus === 'approved').length;
  const adminProfile = buildAdminProfile(workspace, subscription, state);
  const peopleTable = buildPeopleTable(credentials, query, viewer.canSeeAdminProfile ? adminProfile : null, state);
  const orgChartNodes = buildOrgChartNodes(state, credentials);
  const orgChartData = buildOrgChartData(state, orgChartNodes, credentials);

  return {
    ...state,
    palettes: PALETTES.map((palette) => ({
      ...palette,
      selected: state.branding.paletteId === palette.id
    })),
    customPaletteSelected: state.branding.paletteId === 'custom',
    roles: state.roles.map((role) => decorateRole(role)),
    privilegeGroups: buildPrivilegeGroups(),
    roleTemplates: ROLE_TEMPLATES.map(decorateRoleTemplate),
    credentials,
    allCredentialCount: allCredentials.length,
    peopleTable,
    personTypes: PERSON_TYPES,
    orgUnitOptions: buildOrgUnitOptions(state),
    orgChartNodes,
    orgChartLevels: buildOrgChartLevels(state),
    orgChartData,
    orgChartStats: buildOrgChartStats(state, orgChartNodes, credentials),
    orgPolicy: decorateOrgPolicy(state.policy),
    claimConsentOptions: state.claimDefinitions.map((claim) => ({
      ...claim,
      checked: Boolean(claim.required)
    })),
    activeCount,
    invitedCount,
    revokedCount,
    coAdminCount,
    adminProfile,
    isAdmin: viewer.canAdminister,
    isWorkspaceAdmin: viewer.isWorkspaceAdmin,
    viewer,
    canViewPeople: viewer.canViewPeople,
    canManagePeople: viewer.canManagePeople,
    canManageCredentials: viewer.canManageCredentials,
    canViewRoles: viewer.canViewRoles,
    canManageRoles: viewer.canManageRoles,
    canViewClaims: viewer.canViewClaims,
    canManageClaims: viewer.canManageClaims,
    canViewConfiguration: viewer.canViewRoles || viewer.canViewClaims,
    canManageConfiguration: viewer.canManageRoles || viewer.canManageClaims,
    canViewOrgChart: viewer.canViewOrgChart,
    canManageOrgChart: viewer.canManageOrgChart,
    canViewBranding: viewer.canViewBranding,
    canManageBranding: viewer.canManageBranding,
    canViewIntegrations: viewer.canViewIntegrations,
    canManageIntegrations: viewer.canManageIntegrations,
    canViewConnectedApps: viewer.canViewConnectedApps,
    canManageConnectedApps: viewer.canManageConnectedApps,
    canManageConnectedAppCredentials: viewer.canManageConnectedAppCredentials,
    canExportConnectedAppLogs: viewer.canExportConnectedAppLogs,
    canViewOrgLedger: viewer.canViewOrgLedger,
    canManageAdminAssurance: viewer.canManageAdminAssurance,
    events: viewer.canViewOrgLedger
      ? events.slice(0, 25).map(decorateEvent)
      : events
        .filter((event) => normalizeEmail(event.data?.holderEmail || event.actorEmail) === viewer.email)
        .slice(0, 25)
        .map(decorateEvent),
    bladeNavSections: buildBladeNavSections(viewer, adminProfile),
    bladeNavItems: buildBladeNavItems(viewer, adminProfile)
  };
}

async function issueCredential(workspace, subscription, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'credentials.issue');
  const state = await getOrCreateState(workspace);
  const roleIds = normalizeArray(input.roleIds).filter((roleId) => state.roles.some((role) => role.id === roleId));
  const claims = buildClaims(state.claimDefinitions, input);
  const holderEmail = normalizeEmail(input.holderEmail || claims.email);
  if (!holderEmail) {
    throw validationError('Holder email is required.');
  }

  const now = new Date().toISOString();
  const inviteTtlDays = normalizeInviteTtlDays(input.inviteTtlDays || state.policy.inviteTtlDays);
  const requestedClaimKeys = normalizeClaimSelection(state.claimDefinitions, input.requestedClaimKeys);
  const credential = {
    id: crypto.randomUUID(),
    workspaceId: workspace.id,
    organizationName: workspace.organization,
    holderEmail,
    displayName: normalizeText(input.displayName || claims.displayName || holderEmail, 180),
    personType: normalizePersonType(input.personType),
    divisionId: normalizeOrgUnitId(state, input.divisionId),
    status: 'invited',
    roleIds,
    claims: {
      ...claims,
      email: holderEmail
    },
    inviteTtlDays,
    inviteExpiresAt: addDays(now, inviteTtlDays).toISOString(),
    consent: {
      status: 'requested',
      requestedClaimKeys,
      sharedClaims: {},
      deltaClaims: [],
      requestedAt: now,
      grantedAt: null
    },
    createdBy: subscription.email,
    createdAt: now,
    updatedAt: now,
    invitedAt: now,
    coAdminRequestId: null,
    coAdminStatus: null
  };

  state.credentials.unshift(credential);
  await writeState(state);
  await appendCredentialEvent(workspace, credential, subscription, 'credential.invited', {
    holderEmail,
    roleIds,
    personType: credential.personType,
    divisionId: credential.divisionId,
    inviteExpiresAt: credential.inviteExpiresAt,
    requestedClaimKeys
  });
  await appendCredentialEvent(workspace, credential, subscription, 'wallet.challenge.sent', {
    challenge: 'credential-issuance',
    target: holderEmail,
    requestedClaimKeys,
    immutable: true
  });
  return credential;
}

async function markCredentialAccepted(workspace, subscription, credentialId) {
  await assertOrgPrivilege(workspace, subscription, 'credentials.update');
  return mutateCredential(workspace, subscription, credentialId, 'credential.accepted', (credential) => {
    if (isInviteExpired(credential)) {
      throw validationError('This invitation has expired. Issue a new invite or update the invitation window.');
    }
    credential.status = 'active';
    credential.acceptedAt = new Date().toISOString();
  });
}

async function acceptCredentialInvitation(organizationId, credentialId, input = {}) {
  const states = await stateStore.read();
  const state = states.find((record) => record.workspaceId === organizationId);
  if (!state) {
    throw notFound('Credential invitation was not found.');
  }
  normalizeState(state);

  const credential = findCredential(state, credentialId);
  const holderEmail = normalizeEmail(input.holderEmail || '');
  if (holderEmail && holderEmail !== credential.holderEmail) {
    throw validationError('Credential invite holder did not match this wallet.');
  }
  if (credential.status === 'revoked') {
    throw validationError('This credential was revoked and cannot be accepted.');
  }
  if (credential.status !== 'active' && isInviteExpired(credential)) {
    throw validationError('This invitation has expired. Ask an administrator to re-issue it.');
  }

  const now = new Date().toISOString();
  if (credential.status !== 'active') {
    credential.status = 'active';
    credential.acceptedAt = now;
    credential.acceptedBy = holderEmail || credential.holderEmail;
    credential.updatedAt = now;
    await writeState(state);
    await appendWorkspaceEvent(
      { id: organizationId, organization: state.organizationName },
      { email: holderEmail || credential.holderEmail },
      'credential.accepted.wallet',
      {
        credentialId: credential.id,
        holderEmail: credential.holderEmail,
        source: normalizeText(input.source || 'mobile-wallet', 120)
      }
    );
  }

  return {
    id: credential.id,
    organizationId,
    organizationName: state.organizationName,
    holderEmail: credential.holderEmail,
    displayName: credential.displayName,
    status: credential.status,
    acceptedAt: credential.acceptedAt || null,
    updatedAt: credential.updatedAt
  };
}

async function listCredentialMembershipsForEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    return [];
  }

  const states = await stateStore.read();
  const memberships = [];

  for (const state of states) {
    normalizeState(state);
    for (const credential of state.credentials) {
      if (normalizeEmail(credential.holderEmail) !== normalizedEmail || credential.status === 'revoked') {
        continue;
      }

      const roleLabels = normalizeArray(credential.roleIds)
        .map((roleId) => state.roles.find((role) => role.id === roleId)?.name)
        .filter(Boolean);
      memberships.push({
        workspaceId: state.workspaceId,
        organizationName: state.organizationName,
        credentialId: credential.id,
        holderEmail: credential.holderEmail,
        displayName: credential.displayName,
        personType: normalizePersonType(credential.personType),
        personTypeLabel: personTypeLabel(credential.personType),
        divisionId: credential.divisionId || null,
        status: credential.status || 'invited',
        statusLabel: statusLabel(credential.status || 'invited'),
        roleIds: normalizeArray(credential.roleIds),
        roleLabels,
        inviteExpiresAt: credential.inviteExpiresAt || null,
        acceptedAt: credential.acceptedAt || null,
        updatedAt: credential.updatedAt || credential.createdAt || null
      });
    }
  }

  return memberships.sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.acceptedAt || left.inviteExpiresAt || 0).getTime();
    const rightTime = new Date(right.updatedAt || right.acceptedAt || right.inviteExpiresAt || 0).getTime();
    return rightTime - leftTime;
  });
}

async function hasCredentialMembershipForEmail(email) {
  const memberships = await listCredentialMembershipsForEmail(email);
  return memberships.length > 0;
}

async function revokeCredential(workspace, subscription, credentialId, reason = '') {
  await assertOrgPrivilege(workspace, subscription, 'credentials.revoke');
  return mutateCredential(workspace, subscription, credentialId, 'credential.revoked', (credential) => {
    credential.status = 'revoked';
    credential.revokedAt = new Date().toISOString();
    credential.revocationReason = normalizeText(reason, 500);
  });
}

async function updateCredentialProfile(workspace, subscription, credentialId, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'credentials.update');
  const state = await getOrCreateState(workspace);
  const credential = findCredential(state, credentialId);
  credential.roleIds = normalizeArray(input.roleIds).filter((roleId) => state.roles.some((role) => role.id === roleId));
  credential.personType = normalizePersonType(input.personType || credential.personType);
  credential.divisionId = normalizeOrgUnitId(state, input.divisionId || credential.divisionId);
  credential.claims = {
    ...credential.claims,
    ...buildClaims(state.claimDefinitions, input),
    email: normalizeEmail(input.holderEmail || credential.holderEmail)
  };
  credential.holderEmail = credential.claims.email;
  credential.displayName = normalizeText(input.displayName || credential.claims.displayName || credential.holderEmail, 180);
  if (input.inviteTtlDays) {
    credential.inviteTtlDays = normalizeInviteTtlDays(input.inviteTtlDays);
    credential.inviteExpiresAt = addDays(new Date(), credential.inviteTtlDays).toISOString();
  }
  credential.consent = normalizeConsent(credential, state);
  credential.consent.requestedClaimKeys = normalizeClaimSelection(
    state.claimDefinitions,
    input.requestedClaimKeys,
    credential.consent.requestedClaimKeys
  );
  credential.updatedAt = new Date().toISOString();
  await writeState(state);
  await appendCredentialEvent(workspace, credential, subscription, 'credential.profile.updated', {
    holderEmail: credential.holderEmail,
    roleIds: credential.roleIds,
    personType: credential.personType,
    divisionId: credential.divisionId,
    claims: credential.claims,
    requestedClaimKeys: credential.consent.requestedClaimKeys
  });
  return credential;
}

async function resetCredentialProfileValidation(workspace, subscription, credentialId) {
  await assertOrgPrivilege(workspace, subscription, 'admin.assurance.manage');
  const state = await getOrCreateState(workspace);
  const credential = findCredential(state, credentialId);
  const email = normalizeEmail(credential.holderEmail);
  delete state.adminIdentityVerifications[email];
  credential.updatedAt = new Date().toISOString();
  await writeState(state);
  await appendCredentialEvent(workspace, credential, subscription, 'wallet.challenge.accepted', {
    challenge: 'reset-profile-validation',
    target: email,
    immutable: true
  });
  await appendCredentialEvent(workspace, credential, subscription, 'profile.validation.reset', {
    target: email
  });
  return credential;
}

async function reissueCredentialInvitation(workspace, subscription, credentialId, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'credentials.issue');
  return mutateCredential(workspace, subscription, credentialId, 'credential.reinvited', (credential) => {
    const inviteTtlDays = normalizeInviteTtlDays(input.inviteTtlDays || credential.inviteTtlDays);
    credential.status = 'invited';
    credential.inviteTtlDays = inviteTtlDays;
    credential.invitedAt = new Date().toISOString();
    credential.inviteExpiresAt = addDays(credential.invitedAt, inviteTtlDays).toISOString();
    credential.revokedAt = null;
    credential.revocationReason = '';
  });
}

async function createRole(workspace, subscription, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'roles.manage');
  const state = await getOrCreateState(workspace);
  const role = normalizeRoleDefinition({
    id: crypto.randomUUID(),
    name: normalizeText(input.name, 90),
    description: normalizeText(input.description, 300),
    adminRole: normalizeBoolean(input.adminRole),
    privilegeIds: normalizeRolePrivilegeInput(input),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  if (!role.name) {
    throw validationError('Role name is required.');
  }
  state.roles.push(role);
  await writeState(state);
  await appendWorkspaceEvent(workspace, subscription, 'role.created', { roleId: role.id, name: role.name });
  return role;
}

async function updateRole(workspace, subscription, roleId, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'roles.manage');
  const state = await getOrCreateState(workspace);
  const role = state.roles.find((candidate) => candidate.id === roleId);
  if (!role) {
    throw notFound('Role not found.');
  }
  const name = normalizeText(input.name || role.name, 90);
  if (!name) {
    throw validationError('Role name is required.');
  }
  role.name = name;
  role.description = normalizeText(input.description || role.description, 300);
  role.adminRole = normalizeBoolean(input.adminRole);
  role.privilegeIds = normalizeRolePrivilegeInput(input, role);
  role.updatedAt = new Date().toISOString();
  await writeState(state);
  await appendWorkspaceEvent(workspace, subscription, 'role.updated', { roleId: role.id, name: role.name });
  return role;
}

async function deleteRole(workspace, subscription, roleId) {
  await assertOrgPrivilege(workspace, subscription, 'roles.manage');
  const state = await getOrCreateState(workspace);
  const role = state.roles.find((candidate) => candidate.id === roleId);
  if (!role) {
    throw notFound('Role not found.');
  }
  state.roles = state.roles.filter((candidate) => candidate.id !== roleId);
  state.credentials = state.credentials.map((credential) => ({
    ...credential,
    roleIds: credential.roleIds.filter((candidate) => candidate !== roleId)
  }));
  state.orgUnits = state.orgUnits.map((unit) => ({
    ...unit,
    roleIds: normalizeArray(unit.roleIds).filter((candidate) => candidate !== roleId)
  }));
  await writeState(state);
  await appendWorkspaceEvent(workspace, subscription, 'role.deleted', { roleId, name: role.name });
}

async function createClaimDefinition(workspace, subscription, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'claims.manage');
  const state = await getOrCreateState(workspace);
  const key = normalizeClaimKey(input.key || input.label);
  if (!key) {
    throw validationError('Claim key is required.');
  }
  if (state.claimDefinitions.some((claim) => claim.key === key)) {
    throw validationError('Claim key already exists.');
  }

  const claim = {
    id: crypto.randomUUID(),
    key,
    label: normalizeText(input.label || key, 90),
    type: ['text', 'email', 'number', 'date'].includes(input.type) ? input.type : 'text',
    required: input.required === 'yes',
    defaultValue: normalizeText(input.defaultValue, 400),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.claimDefinitions.push(claim);
  await writeState(state);
  await appendWorkspaceEvent(workspace, subscription, 'claim.created', { key: claim.key, label: claim.label });
  return claim;
}

async function updateClaimDefinition(workspace, subscription, claimId, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'claims.manage');
  const state = await getOrCreateState(workspace);
  const claim = state.claimDefinitions.find((candidate) => candidate.id === claimId);
  if (!claim) {
    throw notFound('Claim not found.');
  }
  const key = normalizeClaimKey(input.key || claim.key);
  if (!key) {
    throw validationError('Claim key is required.');
  }
  if (state.claimDefinitions.some((candidate) => candidate.id !== claimId && candidate.key === key)) {
    throw validationError('Claim key already exists.');
  }

  const oldKey = claim.key;
  claim.key = key;
  claim.label = normalizeText(input.label || key, 90);
  claim.type = ['text', 'email', 'number', 'date'].includes(input.type) ? input.type : claim.type || 'text';
  claim.required = input.required === 'yes';
  claim.defaultValue = normalizeText(input.defaultValue, 400);
  claim.updatedAt = new Date().toISOString();

  if (oldKey !== key) {
    for (const credential of state.credentials) {
      if (Object.prototype.hasOwnProperty.call(credential.claims || {}, oldKey)) {
        credential.claims[key] = credential.claims[oldKey];
        delete credential.claims[oldKey];
      }
      credential.consent = normalizeConsent(credential, state);
      credential.consent.requestedClaimKeys = credential.consent.requestedClaimKeys.map((candidate) =>
        candidate === oldKey ? key : candidate
      );
    }
    for (const unit of state.orgUnits) {
      unit.claimKeys = normalizeArray(unit.claimKeys).map((candidate) => (candidate === oldKey ? key : candidate));
    }
  }

  await writeState(state);
  await appendWorkspaceEvent(workspace, subscription, 'claim.updated', { claimId: claim.id, key: claim.key, label: claim.label });
  return claim;
}

async function deleteClaimDefinition(workspace, subscription, claimId) {
  await assertOrgPrivilege(workspace, subscription, 'claims.manage');
  const state = await getOrCreateState(workspace);
  const claim = state.claimDefinitions.find((candidate) => candidate.id === claimId);
  if (!claim) {
    throw notFound('Claim not found.');
  }
  state.claimDefinitions = state.claimDefinitions.filter((candidate) => candidate.id !== claimId);
  for (const credential of state.credentials) {
    delete credential.claims[claim.key];
    credential.consent = normalizeConsent(credential, state);
  }
  state.orgUnits = state.orgUnits.map((unit) => ({
    ...unit,
    claimKeys: normalizeArray(unit.claimKeys).filter((candidate) => candidate !== claim.key)
  }));
  await writeState(state);
  await appendWorkspaceEvent(workspace, subscription, 'claim.deleted', { key: claim.key, label: claim.label });
}

async function createOrgUnit(workspace, subscription, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'orgchart.manage');
  const state = await getOrCreateState(workspace);
  const name = normalizeText(input.name, 120);
  if (!name) {
    throw validationError('Sub-organization name is required.');
  }

  const parentId = normalizeOrgUnitId(state, input.parentId);
  const unit = {
    id: crypto.randomUUID(),
    name,
    parentId,
    description: normalizeText(input.description, 300),
    avatarDataUrl: normalizeDataUrl(input.avatarDataUrl),
    roleIds: normalizeArray(input.roleIds).filter((roleId) => state.roles.some((role) => role.id === roleId)),
    claimKeys: normalizeClaimSelection(state.claimDefinitions, input.claimKeys, []),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.orgUnits.push(unit);
  await writeState(state);
  await appendWorkspaceEvent(workspace, subscription, 'orgunit.created', {
    orgUnitId: unit.id,
    parentId: unit.parentId,
    name: unit.name,
    roleIds: unit.roleIds,
    claimKeys: unit.claimKeys
  });
  return unit;
}

async function updateOrgUnit(workspace, subscription, unitId, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'orgchart.manage');
  const state = await getOrCreateState(workspace);
  const unit = state.orgUnits.find((candidate) => candidate.id === unitId);
  if (!unit) {
    throw notFound('Sub-organization not found.');
  }

  const name = normalizeText(input.name, 120);
  if (!name) {
    throw validationError('Sub-organization name is required.');
  }

  const parentId = unitId === 'unit-root' ? '' : normalizeOrgUnitId(state, input.parentId);
  if (parentId === unitId || isDescendantOrgUnit(state, parentId, unitId)) {
    throw validationError('A division cannot be moved beneath itself or one of its child divisions.');
  }

  unit.name = name;
  unit.parentId = parentId;
  unit.description = normalizeText(input.description, 300);
  unit.avatarDataUrl = normalizeDataUrl(input.avatarDataUrl);
  unit.roleIds = normalizeArray(input.roleIds).filter((roleId) => state.roles.some((role) => role.id === roleId));
  unit.claimKeys = normalizeClaimSelection(state.claimDefinitions, input.claimKeys, []);
  unit.updatedAt = new Date().toISOString();

  await writeState(state);
  await appendWorkspaceEvent(workspace, subscription, 'orgunit.updated', {
    orgUnitId: unit.id,
    parentId: unit.parentId,
    name: unit.name,
    roleIds: unit.roleIds,
    claimKeys: unit.claimKeys
  });
  return unit;
}

async function deleteOrgUnit(workspace, subscription, unitId) {
  await assertOrgPrivilege(workspace, subscription, 'orgchart.manage');
  if (unitId === 'unit-root') {
    throw validationError('The root organization node cannot be deleted.');
  }

  const state = await getOrCreateState(workspace);
  const unit = state.orgUnits.find((candidate) => candidate.id === unitId);
  if (!unit) {
    throw notFound('Sub-organization not found.');
  }

  const assignedCredentialCount = state.credentials.filter((credential) => credential.divisionId === unitId).length;
  if (assignedCredentialCount > 0) {
    throw validationError(
      'This division has active users. Open the People blade, filter by this division, then revoke those users or edit them to another division before deleting the node.'
    );
  }

  for (const child of state.orgUnits) {
    if (child.parentId === unitId) {
      child.parentId = unit.parentId || 'unit-root';
      child.updatedAt = new Date().toISOString();
    }
  }
  state.orgUnits = state.orgUnits.filter((candidate) => candidate.id !== unitId);
  await writeState(state);
  await appendWorkspaceEvent(workspace, subscription, 'orgunit.deleted', { orgUnitId: unitId, name: unit.name });
}

async function requestCredentialConsent(workspace, subscription, credentialId, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'claims.request');
  const state = await getOrCreateState(workspace);
  const credential = findCredential(state, credentialId);
  credential.consent = normalizeConsent(credential, state);
  credential.consent.status = 'requested';
  credential.consent.requestedClaimKeys = normalizeClaimSelection(state.claimDefinitions, input.requestedClaimKeys);
  credential.consent.requestedAt = new Date().toISOString();
  credential.consent.grantedAt = null;
  credential.updatedAt = new Date().toISOString();
  await writeState(state);
  await appendCredentialEvent(workspace, credential, subscription, 'wallet.challenge.sent', {
    challenge: 'claim-consent',
    target: credential.holderEmail,
    requestedClaimKeys: credential.consent.requestedClaimKeys,
    immutable: true
  });
  return credential.consent;
}

async function grantCredentialConsent(workspace, subscription, credentialId, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'claims.request');
  const state = await getOrCreateState(workspace);
  const credential = findCredential(state, credentialId);
  credential.consent = normalizeConsent(credential, state);
  const sharedKeys = normalizeClaimSelection(
    state.claimDefinitions,
    input.sharedClaimKeys,
    credential.consent.requestedClaimKeys
  );
  const sharedClaims = {};
  const deltaClaims = [];
  for (const key of sharedKeys) {
    const providedValue = normalizeText(input[`consent_claim_${key}`], 500);
    const value = providedValue || credential.claims[key] || '';
    sharedClaims[key] = value;
    if (providedValue && providedValue !== credential.claims[key]) {
      credential.claims[key] = providedValue;
      deltaClaims.push(key);
    }
  }
  credential.consent.status = 'granted';
  credential.consent.sharedClaims = sharedClaims;
  credential.consent.deltaClaims = deltaClaims;
  credential.consent.grantedAt = new Date().toISOString();
  credential.updatedAt = new Date().toISOString();
  await writeState(state);
  await appendCredentialEvent(workspace, credential, subscription, 'wallet.challenge.accepted', {
    challenge: 'claim-consent',
    target: credential.holderEmail,
    sharedClaimKeys: sharedKeys,
    deltaClaims,
    immutable: true
  });
  return credential.consent;
}

async function updateBranding(workspace, subscription, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'branding.manage');
  const state = await getOrCreateState(workspace);
  const selectedPalette = PALETTES.find((palette) => palette.id === input.paletteId) || PALETTES[0];
  const useCustom = input.paletteId === 'custom';
  state.branding = {
    paletteId: input.paletteId || selectedPalette.id,
    primaryColor: normalizeColor(useCustom ? input.primaryColor : selectedPalette.primaryColor, selectedPalette.primaryColor),
    accentColor: normalizeColor(useCustom ? input.accentColor : selectedPalette.accentColor, selectedPalette.accentColor),
    backgroundColor: normalizeColor(useCustom ? input.backgroundColor : selectedPalette.backgroundColor, selectedPalette.backgroundColor),
    textColor: normalizeColor(useCustom ? input.textColor : selectedPalette.textColor, selectedPalette.textColor),
    logoDataUrl: normalizeLogoDataUrl(input.logoDataUrl) || state.branding.logoDataUrl || '',
    updatedAt: new Date().toISOString()
  };
  await writeState(state);
  await appendWorkspaceEvent(workspace, subscription, 'branding.updated', {
    paletteId: state.branding.paletteId,
    hasLogo: Boolean(state.branding.logoDataUrl)
  });
  return state.branding;
}

async function submitAdminIdentityVerification(workspace, subscription, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'admin.assurance.manage');
  const state = await getOrCreateState(workspace);
  const idImage = normalizeImageEvidence(input.idImageDataUrl);
  const faceImage = normalizeImageEvidence(input.faceImageDataUrl);
  if (!idImage || !faceImage) {
    throw validationError('Upload an ID image and capture or upload a face image before submitting verification.');
  }

  const email = normalizeEmail(subscription.email);
  const now = new Date().toISOString();
  const captureScore = normalizeDetectorScore(input.faceDetectionScore);
  const score = combineLabFaceScores(estimateLabFaceMatchScore(idImage, faceImage), captureScore);
  const captureProvider = normalizeText(input.faceDetectionProvider, 80) || 'mediapipe-face-detection';
  const record = {
    email,
    status: score >= 0.85 ? 'verified' : 'review_required',
    provider: 'mock-open-source-face-match',
    captureProvider,
    assuranceLevel: score >= 0.85 ? 'lab-idv-high' : 'lab-idv-review',
    score,
    captureScore,
    idImageHash: hashEvidence(idImage),
    faceImageHash: hashEvidence(faceImage),
    submittedAt: now,
    verifiedAt: score >= 0.85 ? now : null,
    updatedAt: now
  };

  state.adminIdentityVerifications[email] = record;
  await writeState(state);
  await appendWorkspaceEvent(workspace, subscription, 'admin.identity.verification.submitted', {
    email,
    status: record.status,
    provider: record.provider,
    captureProvider: record.captureProvider,
    score: record.score
  });
  return record;
}

async function resetAllProfileValidations(workspace, subscription) {
  await assertOrgPrivilege(workspace, subscription, 'admin.assurance.manage');
  const state = await getOrCreateState(workspace);
  state.adminIdentityVerifications = {};
  await writeState(state);
  await appendWorkspaceEvent(workspace, subscription, 'wallet.challenge.accepted', {
    challenge: 'reset-all-profile-validations',
    target: 'all-users',
    immutable: true
  });
  await appendWorkspaceEvent(workspace, subscription, 'profile.validation.reset.all', {
    resetCredentialCount: state.credentials.length + 1
  });
  return { resetCredentialCount: state.credentials.length + 1 };
}

async function updateWorkspacePolicy(workspace, subscription, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'admin.assurance.manage');
  const state = await getOrCreateState(workspace);
  const nextPolicy = {
    ...state.policy
  };
  const policyScope = normalizeText(input.policyScope, 80);
  if (policyScope === 'invite-expiry' || input.inviteTtlDays !== undefined) {
    nextPolicy.inviteTtlDays = normalizeInviteTtlDays(input.inviteTtlDays);
  }
  if (policyScope === 'ledger-retention' || input.ledgerRetentionDays !== undefined) {
    nextPolicy.ledgerRetentionDays = normalizeLedgerRetentionDays(input.ledgerRetentionDays);
  }
  if (policyScope === 'admin-revalidation' || input.adminRevalidationMonths !== undefined || input.adminRevalidationEnabled !== undefined) {
    nextPolicy.adminRevalidationEnabled = normalizeBoolean(input.adminRevalidationEnabled);
    if (input.adminRevalidationMonths !== undefined) {
      nextPolicy.adminRevalidationMonths = normalizeAdminRevalidationMonths(input.adminRevalidationMonths);
    }
  }
  nextPolicy.updatedAt = new Date().toISOString();
  state.policy = normalizeOrgPolicy(nextPolicy);
  await writeState(state);
  await appendWorkspaceEvent(workspace, subscription, 'wallet.challenge.accepted', {
    challenge: 'workspace-policy-update',
    policyScope,
    immutable: true
  });
  await appendWorkspaceEvent(workspace, subscription, 'workspace.policy.updated', {
    policyScope,
    policy: state.policy
  });
  return state.policy;
}

async function requestCoAdmin(workspace, subscription, credentialId) {
  await assertOrgPrivilege(workspace, subscription, 'admin.assurance.manage');
  const state = await getOrCreateState(workspace);
  const credential = findCredential(state, credentialId);
  if (credential.status !== 'active') {
    throw validationError('Only active credential holders can be promoted to co-admin.');
  }

  const request = {
    id: crypto.randomUUID(),
    credentialId,
    holderEmail: credential.holderEmail,
    requestedBy: subscription.email,
    status: 'pending',
    adminChallenge: {
      status: 'sent',
      sentAt: new Date().toISOString()
    },
    holderChallenge: {
      status: 'sent',
      sentAt: new Date().toISOString()
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.coAdminRequests.unshift(request);
  credential.coAdminRequestId = request.id;
  credential.coAdminStatus = request.status;
  credential.updatedAt = new Date().toISOString();
  await writeState(state);
  await appendCredentialEvent(workspace, credential, subscription, 'coadmin.requested', {
    requestId: request.id,
    holderEmail: credential.holderEmail
  });
  await appendCredentialEvent(workspace, credential, subscription, 'wallet.challenge.sent', {
    challenge: 'coadmin-admin-approval',
    target: subscription.email,
    requestId: request.id,
    immutable: true
  });
  await appendCredentialEvent(workspace, credential, subscription, 'wallet.challenge.sent', {
    challenge: 'coadmin-holder-approval',
    target: credential.holderEmail,
    requestId: request.id,
    immutable: true
  });
  return request;
}

async function acceptCoAdminChallenge(workspace, subscription, requestId, side) {
  await assertOrgPrivilege(workspace, subscription, 'admin.assurance.manage');
  const state = await getOrCreateState(workspace);
  const request = findCoAdminRequest(state, requestId);
  const credential = findCredential(state, request.credentialId);
  const challengeKey = side === 'holder' ? 'holderChallenge' : 'adminChallenge';
  request[challengeKey].status = 'accepted';
  request[challengeKey].acceptedAt = new Date().toISOString();
  request.updatedAt = new Date().toISOString();
  await appendCredentialEvent(workspace, credential, subscription, 'wallet.challenge.accepted', {
    challenge: challengeKey,
    target: challengeKey === 'holderChallenge' ? credential.holderEmail : subscription.email,
    requestId,
    immutable: true
  });

  if (request.adminChallenge.status === 'accepted' && request.holderChallenge.status === 'accepted') {
    request.status = 'approved';
    request.approvedAt = new Date().toISOString();
    credential.coAdminStatus = 'approved';
    credential.updatedAt = new Date().toISOString();
    await setWorkspaceMemberRole(workspace.id, credential.holderEmail, 'administrator', {
      sourceCredentialId: credential.id
    });
    await appendCredentialEvent(workspace, credential, subscription, 'coadmin.approved', {
      requestId,
      holderEmail: credential.holderEmail
    });
  } else {
    credential.coAdminStatus = 'pending';
  }

  await writeState(state);
  return request;
}

async function revokeCoAdmin(workspace, subscription, credentialId) {
  await assertOrgPrivilege(workspace, subscription, 'admin.assurance.manage');
  const state = await getOrCreateState(workspace);
  const credential = findCredential(state, credentialId);
  if (!credential.coAdminRequestId) {
    throw validationError('This credential holder is not a co-admin.');
  }
  const request = findCoAdminRequest(state, credential.coAdminRequestId);
  request.status = 'revoked';
  request.revokedAt = new Date().toISOString();
  request.updatedAt = new Date().toISOString();
  credential.coAdminStatus = 'revoked';
  credential.updatedAt = new Date().toISOString();
  await revokeWorkspaceMemberRole(workspace.id, credential.holderEmail, 'administrator');
  await writeState(state);
  await appendCredentialEvent(workspace, credential, subscription, 'coadmin.revoked', {
    requestId: request.id,
    holderEmail: credential.holderEmail
  });
}

async function getOrganizationProfile(organizationId) {
  const state = await getOrCreateState({ id: organizationId });
  return {
    organizationId,
    organizationName: state.organizationName,
    branding: state.branding,
    roles: state.roles,
    claimDefinitions: state.claimDefinitions,
    orgUnits: buildOrgChartNodes(state),
    credentials: state.credentials.map((credential) => ({
      id: credential.id,
      holderEmail: credential.holderEmail,
      displayName: credential.displayName,
      personType: credential.personType,
      divisionId: credential.divisionId,
      divisionName: state.orgUnits.find((unit) => unit.id === credential.divisionId)?.name || state.organizationName,
      status: credential.status,
      inviteTtlDays: credential.inviteTtlDays,
      inviteExpiresAt: credential.inviteExpiresAt,
      inviteExpired: isInviteExpired(credential),
      roles: credential.roleIds
        .map((roleId) => state.roles.find((role) => role.id === roleId))
        .filter(Boolean)
        .map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          adminRole: Boolean(role.adminRole),
          privilegeIds: role.privilegeIds || []
        })),
      claims: credential.claims,
      consent: normalizeConsent(credential, state),
      coAdminStatus: credential.coAdminStatus || null,
      updatedAt: credential.updatedAt
    }))
  };
}

async function getOrganizationBranding(organizationId) {
  const states = await stateStore.read();
  const state = states.find((record) => record.workspaceId === organizationId);
  if (!state) {
    return null;
  }
  normalizeState(state);
  return state.branding;
}

async function getCredentialInvitationView(organizationId, credentialId, options = {}) {
  const states = await stateStore.read();
  const publicBaseUrl = (options.publicBaseUrl || config.app.publicBaseUrl).replace(/\/$/, '');
  const state = states.find((record) => record.workspaceId === organizationId);
  if (!state) {
    throw notFound('Credential invitation was not found.');
  }
  normalizeState(state);
  const credential = findCredential(state, credentialId);
  const invitePath = `/wallet/credential-invitations/${encodeURIComponent(credential.id)}?organizationId=${encodeURIComponent(organizationId)}`;
  const portalParams = new URLSearchParams({
    email: credential.holderEmail,
    returnTo: invitePath
  });
  const invitation = await buildCredentialInvitation(
    { id: organizationId, organization: state.organizationName },
    credential,
    { ...options, publicBaseUrl }
  );
  return {
    organizationId,
    organizationName: state.organizationName,
    credentialId: credential.id,
    displayName: credential.displayName,
    holderEmail: credential.holderEmail,
    inviteExpiresLabel: formatDate(credential.inviteExpiresAt),
    inviteExpired: isInviteExpired(credential),
    status: credential.status,
    portalRegisterUrl: `${publicBaseUrl}/auth/register?${portalParams.toString()}`,
    portalLoginUrl: `${publicBaseUrl}/auth/login?${portalParams.toString()}`,
    ...invitation
  };
}

async function getOrCreateState(workspace) {
  const states = await stateStore.read();
  let state = states.find((record) => record.workspaceId === workspace.id);
  if (state) {
    state.organizationName = workspace.organization || state.organizationName;
    state.roles = state.roles || defaultRoles();
    state.claimDefinitions = state.claimDefinitions || defaultClaims();
    state.credentials = state.credentials || [];
    state.coAdminRequests = state.coAdminRequests || [];
    state.branding = state.branding || defaultBranding();
    state.orgUnits = state.orgUnits || defaultOrgUnits(state.organizationName);
    state.adminIdentityVerifications = state.adminIdentityVerifications || {};
    state.policy = state.policy || defaultOrgPolicy();
    normalizeState(state);
    return state;
  }

  state = {
    workspaceId: workspace.id,
    organizationName: workspace.organization || 'Organization',
    roles: defaultRoles(),
    claimDefinitions: defaultClaims(),
    orgUnits: defaultOrgUnits(workspace.organization || 'Organization'),
    credentials: [],
    coAdminRequests: [],
    adminIdentityVerifications: {},
    policy: defaultOrgPolicy(),
    branding: defaultBranding(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  states.push(state);
  await stateStore.write(states);
  return state;
}

async function writeState(nextState) {
  const states = await stateStore.read();
  const index = states.findIndex((record) => record.workspaceId === nextState.workspaceId);
  nextState.updatedAt = new Date().toISOString();
  if (index === -1) {
    states.push(nextState);
  } else {
    states[index] = nextState;
  }
  await stateStore.write(states);
}

async function mutateCredential(workspace, subscription, credentialId, eventType, mutate) {
  const state = await getOrCreateState(workspace);
  const credential = findCredential(state, credentialId);
  mutate(credential);
  credential.updatedAt = new Date().toISOString();
  await writeState(state);
  await appendCredentialEvent(workspace, credential, subscription, eventType, {
    holderEmail: credential.holderEmail,
    status: credential.status
  });
  return credential;
}

async function appendCredentialEvent(workspace, credential, subscription, type, data = {}) {
  return appendWorkspaceEvent(workspace, subscription, type, {
    credentialId: credential.id,
    holderEmail: credential.holderEmail,
    ...data
  });
}

async function appendWorkspaceEvent(workspace, subscription, type, data = {}) {
  return eventStore.append({
    id: crypto.randomUUID(),
    workspaceId: workspace.id,
    organizationName: workspace.organization,
    type,
    actorEmail: subscription.email,
    data,
    createdAt: new Date().toISOString()
  });
}

async function listEvents(workspaceId) {
  const events = await eventStore.read();
  return events
    .filter((event) => event.workspaceId === workspaceId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

async function decorateCredential(credential, state, events, workspace, options = {}) {
  credential.consent = normalizeConsent(credential, state);
  credential.personType = normalizePersonType(credential.personType);
  credential.divisionId = normalizeOrgUnitId(state, credential.divisionId);
  const eventList = events
    .filter((event) => event.data?.credentialId === credential.id)
    .map(decorateEvent);
  const division = state.orgUnits.find((unit) => unit.id === credential.divisionId);
  const consent = credential.consent;
  const invitation = await buildCredentialInvitation(workspace, credential, options);
  return {
    ...credential,
    ...invitation,
    isAdminProfile: false,
    detailModalId: `credential-detail-${credential.id}`,
    editModalId: `credential-edit-${credential.id}`,
    inviteModalId: `credential-invite-${credential.id}`,
    revokeModalId: `credential-revoke-${credential.id}`,
    statusLabel: statusLabel(credential.status),
    personTypeLabel: personTypeLabel(credential.personType),
    divisionName: division?.name || state.organizationName,
    inviteExpired: isInviteExpired(credential),
    inviteExpiresLabel: formatDate(credential.inviteExpiresAt),
    consentStatusLabel: consentStatusLabel(consent.status),
    requestedClaimLabels: consent.requestedClaimKeys
      .map((key) => state.claimDefinitions.find((claim) => claim.key === key)?.label || key)
      .filter(Boolean),
    sharedClaimFields: Object.keys(consent.sharedClaims || {}).map((key) => ({
      key,
      label: state.claimDefinitions.find((claim) => claim.key === key)?.label || key,
      value: consent.sharedClaims[key] || ''
    })),
    deltaClaimLabels: (consent.deltaClaims || []).map(
      (key) => state.claimDefinitions.find((claim) => claim.key === key)?.label || key
    ),
    roleLabels: credential.roleIds.map((roleId) => state.roles.find((role) => role.id === roleId)?.name).filter(Boolean),
    availableRoles: state.roles.map((role) => ({
      ...role,
      checked: credential.roleIds.includes(role.id)
    })),
    divisionOptions: buildOrgUnitOptions(state, credential.divisionId),
    personTypeOptions: PERSON_TYPES.map((personType) => ({
      ...personType,
      selected: personType.id === credential.personType
    })),
    claimFields: state.claimDefinitions.map((claim) => ({
      ...claim,
      value: credential.claims[claim.key] || ''
    })),
    consentClaimFields: state.claimDefinitions.map((claim) => ({
      ...claim,
      value: credential.claims[claim.key] || claim.defaultValue || '',
      checked: consent.requestedClaimKeys.includes(claim.key),
      shared: Object.prototype.hasOwnProperty.call(consent.sharedClaims || {}, claim.key)
    })),
    events: eventList
  };
}

function decorateEvent(event) {
  return {
    ...event,
    title: event.type.replace(/\./g, ' '),
    details: JSON.stringify(event.data || {}, null, 2)
  };
}

function buildClaims(claimDefinitions, input) {
  return Object.fromEntries(
    claimDefinitions.map((claim) => {
      const value = input[`claim_${claim.key}`] || claim.defaultValue || '';
      return [claim.key, normalizeText(value, 500)];
    })
  );
}

function findCredential(state, credentialId) {
  const credential = state.credentials.find((candidate) => candidate.id === credentialId);
  if (!credential) {
    throw notFound('Credential not found.');
  }
  return credential;
}

function findCoAdminRequest(state, requestId) {
  const request = state.coAdminRequests.find((candidate) => candidate.id === requestId);
  if (!request) {
    throw notFound('Co-admin request not found.');
  }
  return request;
}

function assertWorkspaceAdmin(workspace, subscription) {
  if (!isWorkspaceAdmin(workspace, subscription)) {
    const error = new Error('Organization administrator access is required.');
    error.status = 403;
    throw error;
  }
}

async function assertOrgPrivilege(workspace, subscription, privilegeId) {
  if (isWorkspaceAdmin(workspace, subscription)) {
    return;
  }
  const state = await getOrCreateState(workspace);
  const viewer = buildViewerAccess(workspace, subscription, state);
  if (viewer.privilegeIds.includes(privilegeId)) {
    return;
  }
  const error = new Error('This organization role does not allow that action.');
  error.status = 403;
  throw error;
}

function isWorkspaceAdmin(workspace, subscription) {
  const email = normalizeEmail(subscription.email);
  if (normalizeEmail(workspace.ownerEmail) === email) {
    return true;
  }
  return (workspace.members || []).some(
    (member) => normalizeEmail(member.email) === email && member.role === 'administrator' && !member.revokedAt
  );
}

function defaultRoles() {
  return DEFAULT_ROLES.map((role) => normalizeRoleDefinition({
    ...role,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
}

function defaultClaims() {
  return DEFAULT_CLAIMS.map((claim) => ({
    id: crypto.randomUUID(),
    ...claim,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
}

function defaultBranding() {
  return {
    paletteId: PALETTES[0].id,
    primaryColor: PALETTES[0].primaryColor,
    accentColor: PALETTES[0].accentColor,
    backgroundColor: PALETTES[0].backgroundColor,
    textColor: PALETTES[0].textColor,
    logoDataUrl: '',
    updatedAt: new Date().toISOString()
  };
}

function defaultOrgPolicy() {
  return {
    inviteTtlDays: DEFAULT_INVITE_TTL_DAYS,
    ledgerRetentionDays: DEFAULT_LEDGER_RETENTION_DAYS,
    adminRevalidationEnabled: true,
    adminRevalidationMonths: DEFAULT_ADMIN_REVALIDATION_MONTHS,
    updatedAt: new Date().toISOString()
  };
}

function defaultOrgUnits(organizationName) {
  const now = new Date().toISOString();
  return [
    {
      id: 'unit-root',
      name: organizationName || 'Organization',
      parentId: '',
      description: 'Top-level organization.',
      roleIds: DEFAULT_ROLES.map((role) => role.id),
      claimKeys: DEFAULT_CLAIMS.map((claim) => claim.key),
      createdAt: now,
      updatedAt: now
    }
  ];
}

function normalizeState(state) {
  state.roles = normalizeRoleDefinitions(state.roles);
  state.orgUnits = normalizeOrgUnits(state);
  state.credentials = state.credentials.map((credential) => normalizeCredential(credential, state));
  state.adminIdentityVerifications = normalizeAdminIdentityVerifications(state.adminIdentityVerifications);
  state.policy = normalizeOrgPolicy(state.policy);
}

function normalizeOrgPolicy(policy = {}) {
  return {
    inviteTtlDays: normalizeInviteTtlDays(policy.inviteTtlDays),
    ledgerRetentionDays: normalizeLedgerRetentionDays(policy.ledgerRetentionDays),
    adminRevalidationEnabled: policy.adminRevalidationEnabled === undefined ? true : normalizeBoolean(policy.adminRevalidationEnabled),
    adminRevalidationMonths: normalizeAdminRevalidationMonths(policy.adminRevalidationMonths),
    updatedAt: policy.updatedAt || new Date().toISOString()
  };
}

function decorateOrgPolicy(policy = defaultOrgPolicy()) {
  const normalized = normalizeOrgPolicy(policy);
  return {
    ...normalized,
    inviteTtlLabel: `${normalized.inviteTtlDays} day${normalized.inviteTtlDays === 1 ? '' : 's'}`,
    ledgerRetentionLabel: `${normalized.ledgerRetentionDays} day${normalized.ledgerRetentionDays === 1 ? '' : 's'}`,
    adminRevalidationLabel: normalized.adminRevalidationEnabled
      ? `${normalized.adminRevalidationMonths} month${normalized.adminRevalidationMonths === 1 ? '' : 's'}`
      : 'Off'
  };
}

function normalizeRoleDefinitions(roles = []) {
  const source = Array.isArray(roles) && roles.length > 0 ? roles : DEFAULT_ROLES;
  return source.map((role) => normalizeRoleDefinition(role));
}

function normalizeRoleDefinition(role = {}) {
  const adminRole = normalizeBoolean(role.adminRole || role.isAdminRole);
  const privilegeIds = normalizePrivilegeIds(role.privilegeIds || defaultPrivilegesForRole(role), adminRole);
  return {
    id: normalizeText(role.id, 120) || crypto.randomUUID(),
    name: normalizeText(role.name, 90) || 'Role',
    description: normalizeText(role.description, 300),
    adminRole,
    privilegeIds,
    createdAt: role.createdAt || new Date().toISOString(),
    updatedAt: role.updatedAt || role.createdAt || new Date().toISOString()
  };
}

function defaultPrivilegesForRole(role = {}) {
  const normalizedName = normalizeText(role.name, 90).toLowerCase();
  const matchingTemplate = ROLE_TEMPLATES.find((template) => normalizedName.includes(template.id) || normalizedName === template.name.toLowerCase());
  if (matchingTemplate) {
    return matchingTemplate.privilegeIds;
  }
  if (normalizedName.includes('auditor')) {
    return ROLE_TEMPLATES.find((template) => template.id === 'auditor').privilegeIds;
  }
  if (normalizedName.includes('issuer') || normalizedName.includes('operator')) {
    return ROLE_TEMPLATES.find((template) => template.id === 'issuer').privilegeIds;
  }
  return HOLDER_BASE_PRIVILEGES;
}

function normalizeRolePrivilegeInput(input = {}, existingRole = null) {
  const adminRole = normalizeBoolean(input.adminRole);
  const selected = normalizeArray(input.privilegeIds).filter((privilegeId) => ALL_PRIVILEGE_IDS.includes(privilegeId));
  if (selected.length > 0) {
    return normalizePrivilegeIds(selected, adminRole);
  }

  const template = ROLE_TEMPLATES.find((candidate) => candidate.id === input.privilegeTemplate);
  if (template) {
    return normalizePrivilegeIds(template.privilegeIds, adminRole || template.adminRole);
  }

  if (existingRole?.privilegeIds?.length) {
    return normalizePrivilegeIds(existingRole.privilegeIds, adminRole);
  }

  return normalizePrivilegeIds(HOLDER_BASE_PRIVILEGES, adminRole);
}

function normalizePrivilegeIds(value = [], adminRole = false) {
  const selected = normalizeArray(value).filter((privilegeId) => ALL_PRIVILEGE_IDS.includes(privilegeId));
  const base = adminRole ? ADMIN_BASE_PRIVILEGES : HOLDER_BASE_PRIVILEGES;
  return [...new Set([...base, ...selected])];
}

function decorateRole(role = {}) {
  const normalized = normalizeRoleDefinition(role);
  return {
    ...normalized,
    adminRoleLabel: normalized.adminRole ? 'Admin role' : 'Scoped role',
    privilegeCount: normalized.privilegeIds.length,
    privilegeSummary: summarizePrivileges(normalized.privilegeIds),
    privilegeGroups: buildPrivilegeGroups(normalized.privilegeIds)
  };
}

function decorateRoleTemplate(template = {}) {
  return {
    ...template,
    adminRoleValue: template.adminRole ? 'true' : 'false',
    privilegeCsv: normalizePrivilegeIds(template.privilegeIds, template.adminRole).join(',')
  };
}

function buildPrivilegeGroups(selectedIds = []) {
  const selected = new Set(selectedIds);
  return PRIVILEGE_GROUPS.map((group) => ({
    ...group,
    privileges: group.privileges.map((privilege) => ({
      ...privilege,
      checked: selected.has(privilege.id)
    }))
  }));
}

function summarizePrivileges(privilegeIds = []) {
  const selected = new Set(privilegeIds);
  const groupNames = PRIVILEGE_GROUPS
    .filter((group) => group.privileges.some((privilege) => selected.has(privilege.id)))
    .map((group) => group.name);
  if (groupNames.length === 0) {
    return 'No privileges selected';
  }
  return groupNames.slice(0, 3).join(', ') + (groupNames.length > 3 ? ` +${groupNames.length - 3} more` : '');
}

function buildViewerAccess(workspace, subscription, state) {
  const email = normalizeEmail(subscription.email);
  const isOwner = normalizeEmail(workspace.ownerEmail) === email;
  const isAdminMember = isWorkspaceAdmin(workspace, subscription);
  const holderCredentials = state.credentials.filter(
    (credential) => normalizeEmail(credential.holderEmail) === email && credential.status !== 'revoked'
  );
  const assignedRoles = holderCredentials
    .flatMap((credential) => normalizeArray(credential.roleIds))
    .map((roleId) => state.roles.find((role) => role.id === roleId))
    .filter(Boolean)
    .map((role) => normalizeRoleDefinition(role));

  const privileges = new Set(HOLDER_BASE_PRIVILEGES);
  if (isAdminMember) {
    for (const privilegeId of ADMIN_BASE_PRIVILEGES) {
      privileges.add(privilegeId);
    }
  }
  for (const role of assignedRoles) {
    const rolePrivileges = role.adminRole ? ADMIN_BASE_PRIVILEGES : role.privilegeIds;
    for (const privilegeId of rolePrivileges) {
      privileges.add(privilegeId);
    }
  }

  const has = (privilegeId) => privileges.has(privilegeId);
  const hasAny = (privilegeIds) => privilegeIds.some((privilegeId) => privileges.has(privilegeId));
  const canAdminister = isAdminMember || assignedRoles.some((role) => role.adminRole);
  const canManagePeople = hasAny(['credentials.issue', 'credentials.update', 'credentials.revoke', 'roles.assign']);
  const canViewPeople = canManagePeople || hasAny(['people.view', 'credentials.view.all']);
  const canViewAllCredentials = canViewPeople || canAdminister;
  const canManageCredentials = hasAny(['credentials.issue', 'credentials.update', 'credentials.revoke']);
  const canViewRoles = hasAny(['roles.view', 'roles.manage', 'roles.assign']);
  const canManageRoles = has('roles.manage');
  const canViewClaims = hasAny(['claims.view.all', 'claims.manage', 'claims.request']);
  const canManageClaims = has('claims.manage');
  const canViewOrgChart = hasAny(['orgchart.view', 'orgchart.manage']);
  const canManageOrgChart = has('orgchart.manage');
  const canViewBranding = hasAny(['branding.view', 'branding.manage']);
  const canManageBranding = has('branding.manage');
  const canViewIntegrations = hasAny(['integrations.view', 'integrations.manage']);
  const canManageIntegrations = has('integrations.manage');
  const canViewConnectedApps = hasAny(['connectedApps.view', 'connectedApps.manage', 'connectedApps.logs.view']);
  const canManageConnectedApps = has('connectedApps.manage');
  const canManageConnectedAppCredentials = hasAny(['connectedApps.manage', 'connectedApps.credentials.manage']);
  const canExportConnectedAppLogs = has('connectedApps.logs.export');
  const canViewOrgLedger = has('ledger.view.org');
  const canManageAdminAssurance = has('admin.assurance.manage');

  return {
    email,
    isOwner,
    isWorkspaceAdmin: isAdminMember,
    canAdminister,
    assignedRoles,
    assignedRoleLabels: assignedRoles.map((role) => role.name),
    holderCredentialCount: holderCredentials.length,
    privilegeIds: [...privileges],
    privilegeSummary: summarizePrivileges([...privileges]),
    canSeeAdminProfile: canAdminister || canViewPeople,
    canViewAllCredentials,
    canViewPeople,
    canManagePeople,
    canManageCredentials,
    canViewRoles,
    canManageRoles,
    canViewClaims,
    canManageClaims,
    canViewConfiguration: canViewRoles || canViewClaims,
    canManageConfiguration: canManageRoles || canManageClaims,
    canViewOrgChart,
    canManageOrgChart,
    canViewBranding,
    canManageBranding,
    canViewIntegrations,
    canManageIntegrations,
    canViewConnectedApps,
    canManageConnectedApps,
    canManageConnectedAppCredentials,
    canExportConnectedAppLogs,
    canViewOrgLedger,
    canManageAdminAssurance,
    modeLabel: canAdminister ? 'Administrator workspace' : canViewPeople ? 'Privileged contributor workspace' : 'Credential holder workspace',
    nextActionTitle: canAdminister
      ? 'Review people, claims, roles, and integrations from the blade menu.'
      : canManagePeople
        ? 'Start with People to manage holder invitations assigned to your role.'
        : 'Start with My Credential to review your claims, roles, and wallet activity.',
    nextActionAdvice: canAdminister
      ? 'Use roles for privileges, claims for data, and integrations for systems. Keep admin roles narrow and use wallet challenges for high-risk changes.'
      : canViewPeople
        ? 'You can see more than a standard holder, but some configuration actions remain hidden unless your role includes those privileges.'
        : 'Your view is intentionally limited to your own credential, consented claims, and ledger evidence for this organization.'
  };
}

function buildBladeNavSections(viewer, adminProfile = null) {
  const sections = [
    {
      label: 'Overview',
      items: [
        {
          key: 'dashboard',
          href: '#dashboard-overview',
          label: 'Dashboard',
          description: 'Home',
          icon: '01',
          visible: true
        },
        {
          key: 'people',
          href: '#credential-admin',
          label: viewer.canViewAllCredentials ? 'People' : 'My credential',
          description: viewer.canViewAllCredentials ? 'Users' : 'Mine',
          icon: '02',
          visible: true
        },
        {
          key: 'credentials',
          href: '#credentials-issuance',
          label: 'Credentials',
          description: 'Issue',
          icon: '03',
          visible: viewer.canManageCredentials
        }
      ]
    },
    {
      label: 'Configuration',
      items: [
        {
          key: 'roles',
          href: '#roles-management',
          label: 'Roles',
          description: 'RBAC',
          icon: '04',
          visible: viewer.canViewRoles
        },
        {
          key: 'claims',
          href: '#claims-management',
          label: 'Claims',
          description: 'Data',
          icon: '05',
          visible: viewer.canViewClaims
        },
        {
          key: 'org-structure',
          href: '#org-structure',
          label: 'Org chart',
          description: 'Units',
          icon: '06',
          visible: viewer.canViewOrgChart
        },
        {
          key: 'branding',
          href: '#org-branding',
          label: 'Branding',
          description: 'Theme',
          icon: '07',
          visible: viewer.canViewBranding
        }
      ]
    },
    {
      label: 'Assurance',
      items: [
        {
          key: 'connected-apps',
          href: '#connected-apps',
          label: 'Connected apps',
          description: 'Relying parties',
          icon: '08',
          visible: viewer.canViewConnectedApps
        },
        {
          key: 'platforms',
          href: '#identity-platforms',
          label: 'Integrations',
          description: 'IdP',
          icon: '09',
          visible: viewer.canViewIntegrations
        },
        {
          key: 'issuer-orgs',
          href: '#issuer-orgs',
          label: 'Issuer orgs',
          description: 'Wallet',
          icon: '10',
          visible: viewer.canViewIntegrations
        },
        {
          key: 'wallet-events',
          href: '#wallet-challenge-events',
          label: 'Wallet events',
          description: 'Audit',
          icon: '11',
          visible: true
        },
        {
          key: 'ledger',
          href: '#external-wallet-ledger',
          label: viewer.canViewOrgLedger ? 'App ledger' : 'My ledger',
          description: 'Apps',
          icon: '12',
          visible: true
        },
        {
          key: 'admin-verification',
          href: '#admin-verification',
          label: 'Admin verification',
          description: 'IDV',
          icon: '13',
          statusTone: adminProfile?.isVerified ? 'success' : 'warning',
          statusLabel: adminProfile?.isVerified ? 'Profile validated' : 'Verification required',
          visible: viewer.canManageAdminAssurance
        },
        {
          key: 'settings',
          href: '#workspace-settings',
          label: 'Settings',
          description: 'Policy',
          icon: '14',
          visible: viewer.canAdminister
        }
      ]
    }
  ];

  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.visible)
    }))
    .filter((section) => section.items.length > 0);
}

function buildBladeNavItems(viewer, adminProfile = null) {
  return buildBladeNavSections(viewer, adminProfile).flatMap((section) => section.items);
}

function normalizeOrgUnits(state) {
  const units = Array.isArray(state.orgUnits) ? state.orgUnits : [];
  const root = units.find((unit) => unit.id === 'unit-root') || defaultOrgUnits(state.organizationName)[0];
  root.name = root.name || state.organizationName || 'Organization';
  root.parentId = '';
  root.avatarDataUrl = normalizeDataUrl(root.avatarDataUrl);
  root.roleIds = normalizeArray(root.roleIds).filter((roleId) => state.roles.some((role) => role.id === roleId));
  root.claimKeys = normalizeClaimSelection(state.claimDefinitions, root.claimKeys, state.claimDefinitions.map((claim) => claim.key));

  const seen = new Set(['unit-root']);
  const normalized = [root];
  for (const unit of units) {
    if (!unit || unit.id === 'unit-root' || seen.has(unit.id)) {
      continue;
    }
    seen.add(unit.id);
    normalized.push({
      id: unit.id,
      name: normalizeText(unit.name, 120) || 'Division',
      parentId: units.some((candidate) => candidate.id === unit.parentId) ? unit.parentId : 'unit-root',
      description: normalizeText(unit.description, 300),
      avatarDataUrl: normalizeDataUrl(unit.avatarDataUrl),
      roleIds: normalizeArray(unit.roleIds).filter((roleId) => state.roles.some((role) => role.id === roleId)),
      claimKeys: normalizeClaimSelection(state.claimDefinitions, unit.claimKeys, []),
      createdAt: unit.createdAt || new Date().toISOString(),
      updatedAt: unit.updatedAt || new Date().toISOString()
    });
  }
  return normalized;
}

function normalizeCredential(credential, state) {
  const now = new Date().toISOString();
  credential.personType = normalizePersonType(credential.personType);
  credential.divisionId = normalizeOrgUnitId(state, credential.divisionId);
  credential.inviteTtlDays = normalizeInviteTtlDays(credential.inviteTtlDays);
  credential.inviteExpiresAt =
    credential.inviteExpiresAt || addDays(credential.invitedAt || credential.createdAt || now, credential.inviteTtlDays).toISOString();
  credential.consent = normalizeConsent(credential, state);
  return credential;
}

function normalizeAdminIdentityVerifications(value = {}) {
  const normalized = {};
  for (const [email, record] of Object.entries(value || {})) {
    const normalizedEmail = normalizeEmail(email || record?.email);
    if (!normalizedEmail) {
      continue;
    }
    normalized[normalizedEmail] = {
      email: normalizedEmail,
      status: ['pending', 'verified', 'review_required', 'revoked'].includes(record.status) ? record.status : 'pending',
      provider: normalizeText(record.provider || 'mock-open-source-face-match', 120),
      assuranceLevel: normalizeText(record.assuranceLevel || 'unverified', 120),
      score: typeof record.score === 'number' ? record.score : null,
      idImageHash: normalizeText(record.idImageHash, 160),
      faceImageHash: normalizeText(record.faceImageHash, 160),
      submittedAt: record.submittedAt || null,
      verifiedAt: record.verifiedAt || null,
      updatedAt: record.updatedAt || record.submittedAt || new Date().toISOString()
    };
  }
  return normalized;
}

function normalizeConsent(credential, state) {
  const existing = credential.consent || {};
  const fallbackRequested = normalizeClaimSelection(state.claimDefinitions, existing.requestedClaimKeys);
  const sharedClaims = {};
  for (const key of Object.keys(existing.sharedClaims || {})) {
    if (state.claimDefinitions.some((claim) => claim.key === key)) {
      sharedClaims[key] = normalizeText(existing.sharedClaims[key], 500);
    }
  }
  return {
    status: ['requested', 'granted', 'revoked'].includes(existing.status) ? existing.status : 'requested',
    requestedClaimKeys: normalizeClaimSelection(state.claimDefinitions, existing.requestedClaimKeys, fallbackRequested),
    sharedClaims,
    deltaClaims: normalizeArray(existing.deltaClaims).filter((key) => state.claimDefinitions.some((claim) => claim.key === key)),
    requestedAt: existing.requestedAt || credential.invitedAt || credential.createdAt || new Date().toISOString(),
    grantedAt: existing.grantedAt || null
  };
}

function buildPeopleTable(credentials, query = {}, adminProfile = null, state = null) {
  const search = normalizeText(query.peopleSearch, 120).toLowerCase();
  const status = ['all', 'invited', 'active', 'revoked'].includes(query.peopleStatus) ? query.peopleStatus : 'all';
  const personType = PERSON_TYPES.some((candidate) => candidate.id === query.peopleType) ? query.peopleType : 'all';
  const division = state?.orgUnits?.some((candidate) => candidate.id === query.peopleDivision) ? query.peopleDivision : 'all';
  const sort = ['displayName', 'holderEmail', 'status', 'divisionName', 'inviteExpiresAt', 'consent'].includes(query.peopleSort)
    ? query.peopleSort
    : 'displayName';
  const direction = query.peopleDir === 'desc' ? 'desc' : 'asc';
  const pageSize = 8;

  let credentialRows = credentials.filter((credential) => {
    const matchesStatus = status === 'all' || credential.status === status;
    const matchesType = personType === 'all' || credential.personType === personType;
    const matchesDivision = division === 'all' || credential.divisionId === division;
    const searchable = [
      credential.displayName,
      credential.holderEmail,
      credential.divisionName,
      credential.statusLabel,
      credential.roleLabels.join(' ')
    ]
      .join(' ')
      .toLowerCase();
    const matchesSearch = !search || searchable.includes(search);
    return matchesStatus && matchesType && matchesDivision && matchesSearch;
  });

  credentialRows = credentialRows.sort((left, right) => comparePeople(left, right, sort, direction));
  const adminRow = adminProfile && adminMatchesPeopleFilters(adminProfile, { search, status, personType, division }) ? adminProfile : null;
  const rows = adminRow ? [adminRow, ...credentialRows] : credentialRows;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(Number.parseInt(query.peoplePage || '1', 10) || 1, 1), pageCount);
  const start = (page - 1) * pageSize;
  const pagedRows = rows.slice(start, start + pageSize);
  const filters = { peopleSearch: search, peopleStatus: status, peopleType: personType, peopleDivision: division, peopleSort: sort, peopleDir: direction };

  return {
    rows: pagedRows,
    totalCount: credentials.length + (adminProfile ? 1 : 0),
    filteredCount: rows.length,
    empty: rows.length === 0,
    search,
    status,
    personType,
    division,
    sort,
    direction,
    page,
    pageCount,
    pageSummary: `${rows.length === 0 ? 0 : start + 1}-${Math.min(start + pageSize, rows.length)} of ${rows.length}`,
    hasPrevious: page > 1,
    hasNext: page < pageCount,
    previousUrl: buildPeopleUrl(filters, { peoplePage: page - 1 }),
    nextUrl: buildPeopleUrl(filters, { peoplePage: page + 1 }),
    sortLinks: {
      displayName: buildPeopleUrl(filters, nextSort(sort, direction, 'displayName')),
      holderEmail: buildPeopleUrl(filters, nextSort(sort, direction, 'holderEmail')),
      status: buildPeopleUrl(filters, nextSort(sort, direction, 'status')),
      divisionName: buildPeopleUrl(filters, nextSort(sort, direction, 'divisionName')),
      inviteExpiresAt: buildPeopleUrl(filters, nextSort(sort, direction, 'inviteExpiresAt')),
      consent: buildPeopleUrl(filters, nextSort(sort, direction, 'consent'))
    },
    statusOptions: [
      { value: 'all', label: 'All statuses', selected: status === 'all' },
      { value: 'invited', label: 'Invited', selected: status === 'invited' },
      { value: 'active', label: 'Active', selected: status === 'active' },
      { value: 'revoked', label: 'Revoked', selected: status === 'revoked' }
    ],
    personTypeOptions: [
      { value: 'all', label: 'All people', selected: personType === 'all' },
      ...PERSON_TYPES.map((candidate) => ({
        value: candidate.id,
        label: candidate.name,
        selected: personType === candidate.id
      }))
    ],
    divisionOptions: [
      { value: 'all', label: 'All divisions', selected: division === 'all' },
      ...(state
        ? buildOrgUnitOptions(state, division).map((unit) => ({
            value: unit.id,
            label: unit.indentedName,
            selected: division === unit.id
          }))
        : [])
    ]
  };
}

function adminMatchesPeopleFilters(adminProfile, filters) {
  const matchesStatus = filters.status === 'all' || filters.status === adminProfile.status;
  const matchesType = filters.personType === 'all' || filters.personType === adminProfile.personType;
  const matchesDivision = filters.division === 'all' || filters.division === adminProfile.divisionId;
  const searchable = [
    adminProfile.displayName,
    adminProfile.holderEmail,
    adminProfile.divisionName,
    adminProfile.statusLabel,
    adminProfile.roleLabels.join(' ')
  ]
    .join(' ')
    .toLowerCase();
  const matchesSearch = !filters.search || searchable.includes(filters.search);
  return matchesStatus && matchesType && matchesDivision && matchesSearch;
}

function buildAdminProfile(workspace, subscription, state) {
  const email = normalizeEmail(subscription.email);
  const membership = (workspace.members || []).find((member) => normalizeEmail(member.email) === email);
  const registeredAt = membership?.addedAt || subscription.createdAt || workspace.createdAt || state.createdAt || new Date().toISOString();
  const verification = state.adminIdentityVerifications[email] || {
    email,
    status: 'pending',
    provider: 'mock-open-source-face-match',
    assuranceLevel: 'unverified',
    score: null,
    submittedAt: null,
    verifiedAt: null
  };
  const daysOpen = Math.max(0, Math.floor((Date.now() - new Date(registeredAt).getTime()) / (24 * 60 * 60 * 1000)));
  const daysRemaining = Math.max(0, 30 - daysOpen);
  const isVerified = verification.status === 'verified';
  const policy = normalizeOrgPolicy(state.policy);
  const verifiedAt = verification.verifiedAt || verification.updatedAt || null;
  const nextValidationAt = policy.adminRevalidationEnabled && verifiedAt
    ? addMonths(verifiedAt, policy.adminRevalidationMonths).toISOString()
    : null;

  return {
    id: `admin-${crypto.createHash('sha1').update(email).digest('hex').slice(0, 12)}`,
    isAdminProfile: true,
    isOwnerAdmin: normalizeEmail(workspace.ownerEmail) === email,
    detailModalId: 'admin-profile-detail',
    editModalId: 'admin-identity-verification',
    inviteModalId: 'admin-identity-verification',
    revokeModalId: '',
    displayName: subscription.role || 'Organization administrator',
    holderEmail: email,
    personType: 'administrator',
    personTypeLabel: 'Administrator',
    divisionId: 'unit-root',
    divisionName: workspace.organization || state.organizationName,
    roleLabels: [normalizeEmail(workspace.ownerEmail) === email ? 'Original Subscriber' : 'Co-admin', 'Organization Admin'],
    status: 'active',
    statusLabel: isVerified ? 'Admin / Validated' : 'Admin / Verification Due',
    statusClass: isVerified ? 'active' : 'invited',
    inviteExpiresLabel: 'Not applicable',
    inviteExpired: false,
    consentStatusLabel: isVerified ? 'Profile validated' : 'ID verification due',
    verification,
    isVerified,
    verificationStatusLabel: isVerified ? 'Profile validated' : 'Verification required',
    verificationDaysRemaining: daysRemaining,
    verificationDeadlineLabel: formatDate(addDays(registeredAt, 30).toISOString()),
    lastValidatedLabel: verifiedAt ? formatDateTime(verifiedAt) : 'Not validated yet',
    nextValidationDueLabel: nextValidationAt ? formatDate(nextValidationAt) : 'Re-validation disabled',
    revalidationEnabled: policy.adminRevalidationEnabled,
    revalidationMonths: policy.adminRevalidationMonths,
    showVerificationBanner: !isVerified,
    createdAt: registeredAt
  };
}

async function buildCredentialInvitation(workspace, credential, options = {}) {
  const publicBaseUrl = (options.publicBaseUrl || config.app.publicBaseUrl).replace(/\/$/, '');
  const walletParams = new URLSearchParams({
    organization_id: workspace.id,
    organization_name: workspace.organization || credential.organizationName || 'Vanguard organization',
    credential_id: credential.id,
    holder_email: credential.holderEmail,
    expires_at: credential.inviteExpiresAt || '',
    vanguard_web_app_url: publicBaseUrl
  });
  const inviteUrl = `aegisid://credential-invite?${walletParams.toString()}`;
  const webInviteUrl = `${publicBaseUrl}/wallet/credential-invitations/${encodeURIComponent(credential.id)}?organizationId=${encodeURIComponent(workspace.id)}`;
  const invitePayload = {
    credentialId: credential.id,
    holderEmail: credential.holderEmail,
    organizationId: workspace.id,
    organizationName: workspace.organization || credential.organizationName || 'Vanguard organization',
    personType: credential.personType,
    roleIds: credential.roleIds || [],
    requestedClaimKeys: credential.consent?.requestedClaimKeys || credential.requestedClaimKeys || [],
    expiresAt: credential.inviteExpiresAt || '',
    inviteUrl,
    webInviteUrl
  };
  return {
    inviteUrl,
    webInviteUrl,
    inviteQrCodeDataUrl: await QRCode.toDataURL(inviteUrl, { margin: 1, width: 360 }),
    invitePayloadJson: JSON.stringify(invitePayload, null, 2)
  };
}

function comparePeople(left, right, sort, direction) {
  const leftValue = peopleSortValue(left, sort);
  const rightValue = peopleSortValue(right, sort);
  const comparison = String(leftValue).localeCompare(String(rightValue), undefined, { sensitivity: 'base' });
  return direction === 'desc' ? comparison * -1 : comparison;
}

function peopleSortValue(credential, sort) {
  if (sort === 'consent') {
    return credential.consent?.status || '';
  }
  return credential[sort] || '';
}

function nextSort(currentSort, currentDirection, nextColumn) {
  return {
    peopleSort: nextColumn,
    peopleDir: currentSort === nextColumn && currentDirection === 'asc' ? 'desc' : 'asc',
    peoplePage: 1
  };
}

function buildPeopleUrl(filters, overrides = {}) {
  const params = new URLSearchParams();
  const merged = { ...filters, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== null && value !== '' && value !== 'all') {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return `${query ? `?${query}` : '?'}#people-directory`;
}

function buildOrgUnitOptions(state, selectedId = '') {
  return buildOrgChartNodes(state).map((unit) => ({
    ...unit,
    selected: (selectedId || 'unit-root') === unit.id,
    indentedName: `${'-- '.repeat(unit.depth)}${unit.name}`
  }));
}

function buildOrgUnitOptionsForUnits(units = [], excludedId = '', selectedId = '') {
  const childrenByParent = new Map();
  for (const unit of units) {
    const parent = unit.parentId || '';
    if (!childrenByParent.has(parent)) {
      childrenByParent.set(parent, []);
    }
    childrenByParent.get(parent).push(unit);
  }

  const excluded = new Set();
  const markExcluded = (unitId) => {
    if (!unitId || excluded.has(unitId)) {
      return;
    }
    excluded.add(unitId);
    for (const child of childrenByParent.get(unitId) || []) {
      markExcluded(child.id);
    }
  };
  markExcluded(excludedId);

  const options = [];
  const visit = (unit, depth) => {
    if (!excluded.has(unit.id)) {
      options.push({
        id: unit.id,
        name: unit.name,
        depth,
        selected: (selectedId || 'unit-root') === unit.id,
        indentedName: `${'-- '.repeat(depth)}${unit.name}`
      });
      for (const child of (childrenByParent.get(unit.id) || []).sort((left, right) => left.name.localeCompare(right.name))) {
        visit(child, depth + 1);
      }
    }
  };

  const root = units.find((unit) => unit.id === 'unit-root') || units[0];
  if (root) {
    visit(root, 0);
  }
  return options;
}

function buildOrgChartNodes(state, decoratedCredentials = []) {
  const childrenByParent = new Map();
  for (const unit of state.orgUnits) {
    const parent = unit.parentId || '';
    if (!childrenByParent.has(parent)) {
      childrenByParent.set(parent, []);
    }
    childrenByParent.get(parent).push(unit);
  }

  const nodes = [];
  const visit = (unit, depth, path) => {
    const roleLabels = normalizeArray(unit.roleIds)
      .map((roleId) => state.roles.find((role) => role.id === roleId)?.name)
      .filter(Boolean);
    const claimLabels = normalizeArray(unit.claimKeys)
      .map((key) => state.claimDefinitions.find((claim) => claim.key === key)?.label || key)
      .filter(Boolean);
    const people = decoratedCredentials
      .filter((credential) => credential.divisionId === unit.id)
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .map((credential) => ({
        id: credential.id,
        displayName: credential.displayName,
        holderEmail: credential.holderEmail,
        personTypeLabel: credential.personTypeLabel,
        status: credential.status,
        statusLabel: credential.statusLabel,
        roleLabels: credential.roleLabels,
        detailModalId: credential.detailModalId,
        initials: initialsFromName(credential.displayName || credential.holderEmail)
      }));
    nodes.push({
      ...unit,
      depth,
      path: [...path, unit.name].join(' / '),
      initials: initialsFromName(unit.name),
      avatarDataUrl: normalizeDataUrl(unit.avatarDataUrl),
      roleLabels,
      claimLabels,
      availableRoles: state.roles.map((role) => ({
        ...role,
        checked: normalizeArray(unit.roleIds).includes(role.id)
      })),
      availableClaims: state.claimDefinitions.map((claim) => ({
        ...claim,
        checked: normalizeArray(unit.claimKeys).includes(claim.key)
      })),
      parentOptions: buildOrgUnitOptionsForUnits(state.orgUnits, unit.id, unit.parentId || 'unit-root'),
      credentialCount: state.credentials.filter((credential) => credential.divisionId === unit.id).length,
      people,
      hasPeople: people.length > 0,
      detailModalId: `org-unit-detail-${unit.id}`,
      updateModalId: `org-unit-detail-${unit.id}`,
      canDelete: unit.id !== 'unit-root' && people.length === 0,
      deleteBlocked: unit.id !== 'unit-root' && people.length > 0,
      peopleFilterUrl: buildPeopleUrl({ peopleDivision: unit.id }, { peoplePage: 1 })
    });
    for (const child of (childrenByParent.get(unit.id) || []).sort((left, right) => left.name.localeCompare(right.name))) {
      visit(child, depth + 1, [...path, unit.name]);
    }
  };

  const root = state.orgUnits.find((unit) => unit.id === 'unit-root') || state.orgUnits[0];
  if (root) {
    visit(root, 0, []);
  }
  return nodes;
}

function buildOrgChartData(state, orgChartNodes, credentials) {
  const divisionNodes = orgChartNodes.map((unit) => ({
    id: unit.id,
    parentId: unit.parentId || '',
    type: 'division',
    name: unit.name,
    path: unit.path,
    description: unit.description || (unit.id === 'unit-root' ? 'Root organization' : ''),
    initials: unit.initials,
    avatarDataUrl: unit.avatarDataUrl,
    credentialCount: unit.credentialCount,
    roleLabels: unit.roleLabels,
    claimLabels: unit.claimLabels,
    modalId: unit.detailModalId,
    depth: unit.depth
  }));

  const personNodes = credentials.map((credential) => ({
    id: `person-${credential.id}`,
    parentId: normalizeOrgUnitId(state, credential.divisionId),
    type: 'person',
    name: credential.displayName,
    path: credential.holderEmail,
    description: credential.personTypeLabel,
    initials: initialsFromName(credential.displayName || credential.holderEmail),
    status: credential.status,
    statusLabel: credential.statusLabel,
    roleLabels: credential.roleLabels,
    claimLabels: [],
    modalId: credential.detailModalId,
    credentialId: credential.id
  }));

  return [...divisionNodes, ...personNodes];
}

function buildOrgChartStats(state, orgChartNodes, credentials) {
  return {
    divisionCount: Math.max(0, orgChartNodes.length - 1),
    holderCount: credentials.length,
    roleCount: state.roles.length,
    inheritedClaimCount: state.claimDefinitions.length
  };
}

function buildOrgChartLevels(state) {
  const levels = [];
  for (const node of buildOrgChartNodes(state)) {
    if (!levels[node.depth]) {
      levels[node.depth] = [];
    }
    levels[node.depth].push(node);
  }
  return levels.map((nodes, index) => ({
    depth: index,
    nodes
  }));
}

function isDescendantOrgUnit(state, candidateId, ancestorId) {
  let current = state.orgUnits.find((unit) => unit.id === candidateId);
  while (current) {
    if (current.parentId === ancestorId) {
      return true;
    }
    current = state.orgUnits.find((unit) => unit.id === current.parentId);
  }
  return false;
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 'yes' || value === 'on' || value === '1';
}

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

function normalizeText(value = '', max = 400) {
  return String(value || '').trim().slice(0, max);
}

function normalizeDataUrl(value = '') {
  const text = normalizeText(value, 1200000);
  return /^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(text) ? text : '';
}

function initialsFromName(value = '') {
  const words = normalizeText(value, 120)
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) {
    return 'ID';
  }
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function normalizeClaimKey(value = '') {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 60);
}

function normalizeClaimSelection(claimDefinitions, value, fallback) {
  const requested = normalizeArray(value).filter((key) => claimDefinitions.some((claim) => claim.key === key));
  if (requested.length > 0) {
    return [...new Set(requested)];
  }
  if (Array.isArray(fallback)) {
    return fallback.filter((key) => claimDefinitions.some((claim) => claim.key === key));
  }
  return claimDefinitions.filter((claim) => claim.required).map((claim) => claim.key);
}

function normalizePersonType(value = '') {
  const normalized = String(value || '').trim();
  return PERSON_TYPES.some((personType) => personType.id === normalized) ? normalized : 'employee';
}

function personTypeLabel(value = '') {
  return PERSON_TYPES.find((personType) => personType.id === value)?.name || 'Employee';
}

function normalizeOrgUnitId(state, value = '') {
  const normalized = String(value || '').trim();
  return state.orgUnits.some((unit) => unit.id === normalized) ? normalized : 'unit-root';
}

function normalizeInviteTtlDays(value) {
  const parsed = Number.parseInt(value || String(DEFAULT_INVITE_TTL_DAYS), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_INVITE_TTL_DAYS;
  }
  return Math.min(parsed, MAX_INVITE_TTL_DAYS);
}

function normalizeLedgerRetentionDays(value) {
  const parsed = Number.parseInt(value || String(DEFAULT_LEDGER_RETENTION_DAYS), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_LEDGER_RETENTION_DAYS;
  }
  return Math.min(parsed, MAX_LEDGER_RETENTION_DAYS);
}

function normalizeAdminRevalidationMonths(value) {
  const parsed = Number.parseInt(value || String(DEFAULT_ADMIN_REVALIDATION_MONTHS), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_ADMIN_REVALIDATION_MONTHS;
  }
  return Math.min(parsed, MAX_ADMIN_REVALIDATION_MONTHS);
}

function addDays(value, days) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function addMonths(value, months) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date;
}

function isInviteExpired(credential) {
  if (credential.status !== 'invited' || !credential.inviteExpiresAt) {
    return false;
  }
  return new Date(credential.inviteExpiresAt).getTime() < Date.now();
}

function consentStatusLabel(status) {
  return (
    {
      requested: 'Consent requested',
      granted: 'Consent granted',
      revoked: 'Consent revoked'
    }[status] || 'Consent requested'
  );
}

function formatDate(value) {
  if (!value) {
    return 'Not set';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Not set';
  }
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) {
    return 'Not set';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Not set';
  }
  return date.toISOString().replace('T', ' ').slice(0, 16);
}

function normalizeColor(value = '', fallback = '#0f4fa8') {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function normalizeLogoDataUrl(value = '') {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(text) && text.length < 900000 ? text : '';
}

function normalizeImageEvidence(value = '') {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(text) && text.length < 900000 ? text : '';
}

function hashEvidence(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function estimateLabFaceMatchScore(idImage, faceImage) {
  if (!idImage || !faceImage) {
    return 0;
  }
  const entropy = hashEvidence(`${idImage.slice(0, 80)}:${faceImage.slice(-80)}`);
  const decimal = Number.parseInt(entropy.slice(0, 2), 16) / 255;
  return Number((0.91 + decimal * 0.08).toFixed(2));
}

function normalizeDetectorScore(value) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.round(Math.min(0.99, Math.max(0, parsed)) * 100) / 100;
}

function combineLabFaceScores(matchScore, captureScore) {
  if (!captureScore) {
    return matchScore;
  }
  return Math.round((matchScore * 0.72 + captureScore * 0.28) * 100) / 100;
}

function statusLabel(status) {
  return (
    {
      invited: 'Invited',
      active: 'Accepted / Active',
      revoked: 'Revoked'
    }[status] || status
  );
}

function validationError(message) {
  const error = new Error(message);
  error.status = 422;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

module.exports = {
  acceptCoAdminChallenge,
  assertOrgPrivilege,
  createClaimDefinition,
  createOrgUnit,
  createRole,
  deleteClaimDefinition,
  deleteOrgUnit,
  deleteRole,
  grantCredentialConsent,
  getCredentialInvitationView,
  hasCredentialMembershipForEmail,
  isWorkspaceAdmin,
  listCredentialMembershipsForEmail,
  getOrgAdminView,
  getOrganizationBranding,
  getOrganizationProfile,
  acceptCredentialInvitation,
  issueCredential,
  markCredentialAccepted,
  reissueCredentialInvitation,
  resetAllProfileValidations,
  resetCredentialProfileValidation,
  requestCredentialConsent,
  requestCoAdmin,
  revokeCoAdmin,
  revokeCredential,
  submitAdminIdentityVerification,
  updateBranding,
  updateClaimDefinition,
  updateCredentialProfile,
  updateOrgUnit,
  updateWorkspacePolicy,
  updateRole
};
