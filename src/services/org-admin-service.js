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

async function getOrgAdminView(workspace, subscription) {
  const state = await getOrCreateState(workspace);
  const events = await listEvents(workspace.id);
  const credentials = state.credentials.map((credential) => decorateCredential(credential, state, events));
  const activeCount = credentials.filter((credential) => credential.status === 'active').length;
  const invitedCount = credentials.filter((credential) => credential.status === 'invited').length;
  const revokedCount = credentials.filter((credential) => credential.status === 'revoked').length;
  const coAdminCount = credentials.filter((credential) => credential.coAdminStatus === 'approved').length;

  return {
    ...state,
    palettes: PALETTES.map((palette) => ({
      ...palette,
      selected: state.branding.paletteId === palette.id
    })),
    customPaletteSelected: state.branding.paletteId === 'custom',
    credentials,
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
  const credential = {
    id: crypto.randomUUID(),
    workspaceId: workspace.id,
    organizationName: workspace.organization,
    holderEmail,
    displayName: normalizeText(input.displayName || claims.displayName || holderEmail, 180),
    status: 'invited',
    roleIds,
    claims: {
      ...claims,
      email: holderEmail
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
    roleIds
  });
  await appendCredentialEvent(workspace, credential, subscription, 'wallet.challenge.sent', {
    challenge: 'credential-issuance',
    target: holderEmail,
    immutable: true
  });
  return credential;
}

async function markCredentialAccepted(workspace, subscription, credentialId) {
  assertWorkspaceAdmin(workspace, subscription);
  return mutateCredential(workspace, subscription, credentialId, 'credential.accepted', (credential) => {
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
  credential.claims = {
    ...credential.claims,
    ...buildClaims(state.claimDefinitions, input),
    email: normalizeEmail(input.holderEmail || credential.holderEmail)
  };
  credential.holderEmail = credential.claims.email;
  credential.displayName = normalizeText(input.displayName || credential.claims.displayName || credential.holderEmail, 180);
  credential.updatedAt = new Date().toISOString();
  await writeState(state);
  await appendCredentialEvent(workspace, credential, subscription, 'credential.profile.updated', {
    holderEmail: credential.holderEmail,
    roleIds: credential.roleIds,
    claims: credential.claims
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
  }
  await writeState(state);
  await appendWorkspaceEvent(workspace, subscription, 'claim.deleted', { key: claim.key, label: claim.label });
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
    credentials: state.credentials.map((credential) => ({
      id: credential.id,
      holderEmail: credential.holderEmail,
      displayName: credential.displayName,
      status: credential.status,
      roles: credential.roleIds
        .map((roleId) => state.roles.find((role) => role.id === roleId))
        .filter(Boolean)
        .map((role) => ({ id: role.id, name: role.name, description: role.description })),
      claims: credential.claims,
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
    return state;
  }

  state = {
    workspaceId: workspace.id,
    organizationName: workspace.organization || 'Organization',
    roles: defaultRoles(),
    claimDefinitions: defaultClaims(),
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
  const eventList = events
    .filter((event) => event.data?.credentialId === credential.id)
    .map(decorateEvent);
  return {
    ...credential,
    statusLabel: statusLabel(credential.status),
    roleLabels: credential.roleIds.map((roleId) => state.roles.find((role) => role.id === roleId)?.name).filter(Boolean),
    availableRoles: state.roles.map((role) => ({
      ...role,
      checked: credential.roleIds.includes(role.id)
    })),
    claimFields: state.claimDefinitions.map((claim) => ({
      ...claim,
      value: credential.claims[claim.key] || ''
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
  createRole,
  deleteClaimDefinition,
  deleteRole,
  getOrgAdminView,
  getOrganizationProfile,
  issueCredential,
  markCredentialAccepted,
  requestCoAdmin,
  revokeCoAdmin,
  revokeCredential,
  updateBranding,
  updateCredentialProfile
};
