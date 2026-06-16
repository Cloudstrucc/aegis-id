const crypto = require('node:crypto');

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
    description: 'Standard employee credential holder.'
  },
  {
    id: 'role-contractor',
    name: 'Contractor',
    description: 'External contributor with portable proof of engagement.'
  },
  {
    id: 'role-admin-eligible',
    name: 'Admin Eligible',
    description: 'Credential holder can be nominated for co-administration.'
  }
];

const DEFAULT_INVITE_TTL_DAYS = 7;
const MAX_INVITE_TTL_DAYS = 365;

const PERSON_TYPES = [
  { id: 'employee', name: 'Employee' },
  { id: 'contractor', name: 'Contractor' },
  { id: 'administrator', name: 'Administrator' }
];

async function getOrgAdminView(workspace, subscription, query = {}) {
  const state = await getOrCreateState(workspace);
  const events = await listEvents(workspace.id);
  const credentials = state.credentials.map((credential) => decorateCredential(credential, state, events));
  const activeCount = credentials.filter((credential) => credential.status === 'active').length;
  const invitedCount = credentials.filter((credential) => credential.status === 'invited').length;
  const revokedCount = credentials.filter((credential) => credential.status === 'revoked').length;
  const coAdminCount = credentials.filter((credential) => credential.coAdminStatus === 'approved').length;
  const peopleTable = buildPeopleTable(credentials, query);

  return {
    ...state,
    palettes: PALETTES.map((palette) => ({
      ...palette,
      selected: state.branding.paletteId === palette.id
    })),
    customPaletteSelected: state.branding.paletteId === 'custom',
    credentials,
    peopleTable,
    personTypes: PERSON_TYPES,
    orgUnitOptions: buildOrgUnitOptions(state),
    orgChartNodes: buildOrgChartNodes(state),
    claimConsentOptions: state.claimDefinitions.map((claim) => ({
      ...claim,
      checked: Boolean(claim.required)
    })),
    activeCount,
    invitedCount,
    revokedCount,
    coAdminCount,
    isAdmin: isWorkspaceAdmin(workspace, subscription),
    events: events.slice(0, 25).map(decorateEvent)
  };
}

async function issueCredential(workspace, subscription, input = {}) {
  assertWorkspaceAdmin(workspace, subscription);
  const state = await getOrCreateState(workspace);
  const roleIds = normalizeArray(input.roleIds).filter((roleId) => state.roles.some((role) => role.id === roleId));
  const claims = buildClaims(state.claimDefinitions, input);
  const holderEmail = normalizeEmail(input.holderEmail || claims.email);
  if (!holderEmail) {
    throw validationError('Holder email is required.');
  }

  const now = new Date().toISOString();
  const inviteTtlDays = normalizeInviteTtlDays(input.inviteTtlDays);
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
  assertWorkspaceAdmin(workspace, subscription);
  return mutateCredential(workspace, subscription, credentialId, 'credential.accepted', (credential) => {
    if (isInviteExpired(credential)) {
      throw validationError('This invitation has expired. Issue a new invite or update the invitation window.');
    }
    credential.status = 'active';
    credential.acceptedAt = new Date().toISOString();
  });
}

async function revokeCredential(workspace, subscription, credentialId, reason = '') {
  assertWorkspaceAdmin(workspace, subscription);
  return mutateCredential(workspace, subscription, credentialId, 'credential.revoked', (credential) => {
    credential.status = 'revoked';
    credential.revokedAt = new Date().toISOString();
    credential.revocationReason = normalizeText(reason, 500);
  });
}

async function updateCredentialProfile(workspace, subscription, credentialId, input = {}) {
  assertWorkspaceAdmin(workspace, subscription);
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

async function createRole(workspace, subscription, input = {}) {
  assertWorkspaceAdmin(workspace, subscription);
  const state = await getOrCreateState(workspace);
  const role = {
    id: crypto.randomUUID(),
    name: normalizeText(input.name, 90),
    description: normalizeText(input.description, 300),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (!role.name) {
    throw validationError('Role name is required.');
  }
  state.roles.push(role);
  await writeState(state);
  await appendWorkspaceEvent(workspace, subscription, 'role.created', { roleId: role.id, name: role.name });
  return role;
}

async function deleteRole(workspace, subscription, roleId) {
  assertWorkspaceAdmin(workspace, subscription);
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
  assertWorkspaceAdmin(workspace, subscription);
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

async function deleteClaimDefinition(workspace, subscription, claimId) {
  assertWorkspaceAdmin(workspace, subscription);
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
  assertWorkspaceAdmin(workspace, subscription);
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

async function deleteOrgUnit(workspace, subscription, unitId) {
  assertWorkspaceAdmin(workspace, subscription);
  if (unitId === 'unit-root') {
    throw validationError('The root organization node cannot be deleted.');
  }

  const state = await getOrCreateState(workspace);
  const unit = state.orgUnits.find((candidate) => candidate.id === unitId);
  if (!unit) {
    throw notFound('Sub-organization not found.');
  }

  for (const credential of state.credentials) {
    if (credential.divisionId === unitId) {
      credential.divisionId = 'unit-root';
      credential.updatedAt = new Date().toISOString();
    }
  }
  for (const child of state.orgUnits) {
    if (child.parentId === unitId) {
      child.parentId = 'unit-root';
      child.updatedAt = new Date().toISOString();
    }
  }
  state.orgUnits = state.orgUnits.filter((candidate) => candidate.id !== unitId);
  await writeState(state);
  await appendWorkspaceEvent(workspace, subscription, 'orgunit.deleted', { orgUnitId: unitId, name: unit.name });
}

async function requestCredentialConsent(workspace, subscription, credentialId, input = {}) {
  assertWorkspaceAdmin(workspace, subscription);
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
  assertWorkspaceAdmin(workspace, subscription);
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
  assertWorkspaceAdmin(workspace, subscription);
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

async function requestCoAdmin(workspace, subscription, credentialId) {
  assertWorkspaceAdmin(workspace, subscription);
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
  assertWorkspaceAdmin(workspace, subscription);
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
  assertWorkspaceAdmin(workspace, subscription);
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
        .map((role) => ({ id: role.id, name: role.name, description: role.description })),
      claims: credential.claims,
      consent: normalizeConsent(credential, state),
      coAdminStatus: credential.coAdminStatus || null,
      updatedAt: credential.updatedAt
    }))
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

function decorateCredential(credential, state, events) {
  credential.consent = normalizeConsent(credential, state);
  credential.personType = normalizePersonType(credential.personType);
  credential.divisionId = normalizeOrgUnitId(state, credential.divisionId);
  const eventList = events
    .filter((event) => event.data?.credentialId === credential.id)
    .map(decorateEvent);
  const division = state.orgUnits.find((unit) => unit.id === credential.divisionId);
  const consent = credential.consent;
  return {
    ...credential,
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
  return DEFAULT_ROLES.map((role) => ({
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
  state.orgUnits = normalizeOrgUnits(state);
  state.credentials = state.credentials.map((credential) => normalizeCredential(credential, state));
}

function normalizeOrgUnits(state) {
  const units = Array.isArray(state.orgUnits) ? state.orgUnits : [];
  const root = units.find((unit) => unit.id === 'unit-root') || defaultOrgUnits(state.organizationName)[0];
  root.name = root.name || state.organizationName || 'Organization';
  root.parentId = '';
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

function buildPeopleTable(credentials, query = {}) {
  const search = normalizeText(query.peopleSearch, 120).toLowerCase();
  const status = ['all', 'invited', 'active', 'revoked'].includes(query.peopleStatus) ? query.peopleStatus : 'all';
  const personType = PERSON_TYPES.some((candidate) => candidate.id === query.peopleType) ? query.peopleType : 'all';
  const sort = ['displayName', 'holderEmail', 'status', 'divisionName', 'inviteExpiresAt', 'consent'].includes(query.peopleSort)
    ? query.peopleSort
    : 'displayName';
  const direction = query.peopleDir === 'desc' ? 'desc' : 'asc';
  const pageSize = 8;

  let rows = credentials.filter((credential) => {
    const matchesStatus = status === 'all' || credential.status === status;
    const matchesType = personType === 'all' || credential.personType === personType;
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
    return matchesStatus && matchesType && matchesSearch;
  });

  rows = rows.sort((left, right) => comparePeople(left, right, sort, direction));
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(Number.parseInt(query.peoplePage || '1', 10) || 1, 1), pageCount);
  const start = (page - 1) * pageSize;
  const pagedRows = rows.slice(start, start + pageSize);
  const filters = { peopleSearch: search, peopleStatus: status, peopleType: personType, peopleSort: sort, peopleDir: direction };

  return {
    rows: pagedRows,
    totalCount: credentials.length,
    filteredCount: rows.length,
    empty: rows.length === 0,
    search,
    status,
    personType,
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
    ]
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

function buildOrgChartNodes(state) {
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
    nodes.push({
      ...unit,
      depth,
      path: [...path, unit.name].join(' / '),
      roleLabels,
      claimLabels,
      credentialCount: state.credentials.filter((credential) => credential.divisionId === unit.id).length
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

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

function normalizeText(value = '', max = 400) {
  return String(value || '').trim().slice(0, max);
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

function addDays(value, days) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
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
  createClaimDefinition,
  createOrgUnit,
  createRole,
  deleteClaimDefinition,
  deleteOrgUnit,
  deleteRole,
  grantCredentialConsent,
  getOrgAdminView,
  getOrganizationProfile,
  issueCredential,
  markCredentialAccepted,
  requestCredentialConsent,
  requestCoAdmin,
  revokeCoAdmin,
  revokeCredential,
  updateBranding,
  updateCredentialProfile
};
