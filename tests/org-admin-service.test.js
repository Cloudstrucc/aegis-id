const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('org admin service manages credential lifecycle, co-admin challenges, and profile branding', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vanguard-org-admin-'));
  const previousWorkspacePath = process.env.SUBSCRIBER_WORKSPACE_STORE_PATH;
  const previousOrgAdminPath = process.env.ORG_ADMIN_STORE_PATH;
  const previousOrgEventsPath = process.env.ORG_ADMIN_EVENT_STORE_PATH;
  process.env.SUBSCRIBER_WORKSPACE_STORE_PATH = path.join(tempDir, 'workspaces.json');
  process.env.ORG_ADMIN_STORE_PATH = path.join(tempDir, 'org-admin.json');
  process.env.ORG_ADMIN_EVENT_STORE_PATH = path.join(tempDir, 'org-admin-events.json');
  resetModules();

  t.after(() => {
    restoreEnv('SUBSCRIBER_WORKSPACE_STORE_PATH', previousWorkspacePath);
    restoreEnv('ORG_ADMIN_STORE_PATH', previousOrgAdminPath);
    restoreEnv('ORG_ADMIN_EVENT_STORE_PATH', previousOrgEventsPath);
    resetModules();
  });

  const workspace = {
    id: 'org-vanguard',
    subscriptionId: 'sub-vanguard',
    organization: 'Vanguard Cloud Services',
    ownerEmail: 'admin@vanguardcs.ca',
    members: [{ email: 'admin@vanguardcs.ca', role: 'administrator', addedAt: new Date().toISOString() }],
    platforms: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const subscription = { id: 'sub-vanguard', email: 'admin@vanguardcs.ca', organization: 'Vanguard Cloud Services' };
  await fs.writeFile(process.env.SUBSCRIBER_WORKSPACE_STORE_PATH, JSON.stringify([workspace], null, 2), 'utf8');

  const {
    acceptCoAdminChallenge,
    createRole,
    createOrgUnit,
    grantCredentialConsent,
    getOrganizationProfile,
    getOrgAdminView,
    issueCredential,
    markCredentialAccepted,
    requestCredentialConsent,
    requestCoAdmin,
    revokeCredential,
    submitAdminIdentityVerification,
    updateBranding,
    deleteOrgUnit
  } = require('../src/services/org-admin-service');

  const role = await createRole(workspace, subscription, {
    name: 'Privileged Operator',
    description: 'Can administer sensitive identity workflows.',
    privilegeTemplate: 'issuer'
  });
  assert.equal(role.adminRole, false);
  assert.equal(role.privilegeIds.includes('credentials.issue'), true);
  assert.equal(role.privilegeIds.includes('ledger.view.org'), true);
  await updateBranding(workspace, subscription, {
    paletteId: 'custom',
    primaryColor: '#123456',
    accentColor: '#19b97a',
    backgroundColor: '#f5f9fd',
    textColor: '#182334',
    logoDataUrl: 'data:image/png;base64,aGVsbG8='
  });
  const division = await createOrgUnit(workspace, subscription, {
    name: 'Finance',
    parentId: 'unit-root',
    roleIds: [role.id],
    claimKeys: ['department', 'assuranceLevel']
  });

  const credential = await issueCredential(workspace, subscription, {
    holderEmail: 'holder@vanguardcs.ca',
    displayName: 'Vanguard Holder',
    personType: 'contractor',
    divisionId: division.id,
    inviteTtlDays: '14',
    requestedClaimKeys: ['email', 'department'],
    roleIds: ['role-employee', role.id],
    claim_displayName: 'Vanguard Holder',
    claim_email: 'holder@vanguardcs.ca',
    claim_department: 'Security',
    claim_employmentStatus: 'active'
  });
  assert.equal(credential.status, 'invited');
  assert.equal(credential.personType, 'contractor');
  assert.equal(credential.divisionId, division.id);
  assert.equal(credential.inviteTtlDays, 14);
  assert.equal(credential.consent.requestedClaimKeys.includes('department'), true);

  await markCredentialAccepted(workspace, subscription, credential.id);
  await requestCredentialConsent(workspace, subscription, credential.id, {
    requestedClaimKeys: ['email', 'department', 'assuranceLevel']
  });
  await grantCredentialConsent(workspace, subscription, credential.id, {
    sharedClaimKeys: ['email', 'department', 'assuranceLevel'],
    consent_claim_assuranceLevel: 'LAB_SIMULATOR'
  });
  const coAdminRequest = await requestCoAdmin(workspace, subscription, credential.id);
  await acceptCoAdminChallenge(workspace, subscription, coAdminRequest.id, 'admin');
  await acceptCoAdminChallenge(workspace, subscription, coAdminRequest.id, 'holder');
  const verification = await submitAdminIdentityVerification(workspace, subscription, {
    idImageDataUrl: 'data:image/jpeg;base64,Z292ZXJubWVudC1pZA==',
    faceImageDataUrl: 'data:image/jpeg;base64,bGl2ZS1mYWNlLWNhcHR1cmU=',
    faceDetectionScore: '0.94',
    faceDetectionProvider: 'mediapipe-face-detection'
  });
  assert.equal(verification.status, 'verified');
  assert.equal(verification.captureProvider, 'mediapipe-face-detection');
  assert.equal(verification.idImageHash.length, 64);
  assert.equal(verification.faceImageHash.length, 64);

  const adminView = await getOrgAdminView(workspace, subscription);
  const activeCredential = adminView.credentials.find((item) => item.id === credential.id);
  assert.equal(activeCredential.status, 'active');
  assert.equal(activeCredential.coAdminStatus, 'approved');
  assert.equal(activeCredential.personTypeLabel, 'Contractor');
  assert.equal(activeCredential.divisionName, 'Finance');
  assert.equal(activeCredential.consentStatusLabel, 'Consent granted');
  assert.equal(adminView.orgChartNodes.some((node) => node.name === 'Finance'), true);
  assert.equal(adminView.orgChartLevels.some((level) => level.depth === 1 && level.nodes.some((node) => node.name === 'Finance')), true);
  assert.equal(adminView.orgChartData.some((node) => node.type === 'person' && node.parentId === division.id && node.modalId === activeCredential.detailModalId), true);
  assert.equal(adminView.orgChartStats.divisionCount, 1);
  assert.equal(adminView.peopleTable.filteredCount, 2);
  const financePeopleTable = await getOrgAdminView(workspace, subscription, { peopleDivision: division.id });
  assert.equal(financePeopleTable.peopleTable.filteredCount, 1);
  await assert.rejects(
    () => deleteOrgUnit(workspace, subscription, division.id),
    /This division has active users/
  );
  assert.equal(adminView.peopleTable.rows[0].isAdminProfile, true);
  assert.equal(adminView.peopleTable.rows[0].holderEmail, 'admin@vanguardcs.ca');
  assert.equal(adminView.peopleTable.rows[0].verification.status, 'verified');
  assert.equal(adminView.coAdminCount, 1);
  assert.equal(adminView.customPaletteSelected, true);
  assert.equal(adminView.canManageRoles, true);
  assert.equal(adminView.roles.some((item) => item.privilegeSummary.includes('People and credentials')), true);

  const profile = await getOrganizationProfile(workspace.id);
  assert.equal(profile.organizationName, 'Vanguard Cloud Services');
  assert.equal(profile.branding.primaryColor, '#123456');
  assert.equal(profile.credentials[0].roles.some((item) => item.name === 'Privileged Operator'), true);
  assert.equal(profile.credentials[0].claims.department, 'Security');
  assert.equal(profile.credentials[0].consent.sharedClaims.assuranceLevel, 'LAB_SIMULATOR');
  assert.equal(profile.credentials[0].divisionName, 'Finance');
  assert.equal(profile.orgUnits.some((node) => node.name === 'Finance'), true);

  const events = JSON.parse(await fs.readFile(process.env.ORG_ADMIN_EVENT_STORE_PATH, 'utf8'));
  const walletChallengeEvents = events.filter((event) => event.type === 'wallet.challenge.sent');
  assert.equal(walletChallengeEvents.length, 4);
  assert.equal(walletChallengeEvents.every((event) => event.data.immutable === true), true);
  assert.equal(walletChallengeEvents.filter((event) => String(event.data.challenge).startsWith('coadmin-')).length, 2);
  assert.equal(walletChallengeEvents.some((event) => event.data.challenge === 'claim-consent'), true);

  await revokeCredential(workspace, subscription, credential.id, 'Pilot complete');
  const revokedProfile = await getOrganizationProfile(workspace.id);
  assert.equal(revokedProfile.credentials[0].status, 'revoked');
});

test('org admin view scopes menus and credentials by assigned role privileges', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vanguard-org-admin-scope-'));
  const previousWorkspacePath = process.env.SUBSCRIBER_WORKSPACE_STORE_PATH;
  const previousOrgAdminPath = process.env.ORG_ADMIN_STORE_PATH;
  const previousOrgEventsPath = process.env.ORG_ADMIN_EVENT_STORE_PATH;
  process.env.SUBSCRIBER_WORKSPACE_STORE_PATH = path.join(tempDir, 'workspaces.json');
  process.env.ORG_ADMIN_STORE_PATH = path.join(tempDir, 'org-admin.json');
  process.env.ORG_ADMIN_EVENT_STORE_PATH = path.join(tempDir, 'org-admin-events.json');
  resetModules();

  t.after(() => {
    restoreEnv('SUBSCRIBER_WORKSPACE_STORE_PATH', previousWorkspacePath);
    restoreEnv('ORG_ADMIN_STORE_PATH', previousOrgAdminPath);
    restoreEnv('ORG_ADMIN_EVENT_STORE_PATH', previousOrgEventsPath);
    resetModules();
  });

  const workspace = {
    id: 'org-scope',
    subscriptionId: 'sub-scope',
    organization: 'Scoped Org',
    ownerEmail: 'admin@vanguardcs.ca',
    members: [{ email: 'admin@vanguardcs.ca', role: 'administrator', addedAt: new Date().toISOString() }],
    platforms: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const admin = { id: 'sub-scope', email: 'admin@vanguardcs.ca', organization: 'Scoped Org' };
  await fs.writeFile(process.env.SUBSCRIBER_WORKSPACE_STORE_PATH, JSON.stringify([workspace], null, 2), 'utf8');

  const {
    createRole,
    getOrgAdminView,
    issueCredential,
    markCredentialAccepted
  } = require('../src/services/org-admin-service');

  const auditorRole = await createRole(workspace, admin, {
    name: 'Audit Reviewer',
    description: 'Read-only ledger and credential review.',
    privilegeTemplate: 'auditor'
  });

  const auditorCredential = await issueCredential(workspace, admin, {
    holderEmail: 'auditor@vanguardcs.ca',
    displayName: 'Audit Reviewer',
    roleIds: [auditorRole.id],
    claim_email: 'auditor@vanguardcs.ca',
    claim_displayName: 'Audit Reviewer'
  });
  await markCredentialAccepted(workspace, admin, auditorCredential.id);

  const employeeCredential = await issueCredential(workspace, admin, {
    holderEmail: 'employee@vanguardcs.ca',
    displayName: 'Employee Holder',
    roleIds: ['role-employee'],
    claim_email: 'employee@vanguardcs.ca',
    claim_displayName: 'Employee Holder'
  });
  await markCredentialAccepted(workspace, admin, employeeCredential.id);

  const auditorView = await getOrgAdminView(workspace, { id: 'auditor', email: 'auditor@vanguardcs.ca' });
  assert.equal(auditorView.isAdmin, false);
  assert.equal(auditorView.canViewPeople, true);
  assert.equal(auditorView.canManagePeople, false);
  assert.equal(auditorView.canViewOrgLedger, true);
  assert.equal(auditorView.credentials.length, 2);

  const employeeView = await getOrgAdminView(workspace, { id: 'employee', email: 'employee@vanguardcs.ca' });
  assert.equal(employeeView.isAdmin, false);
  assert.equal(employeeView.canViewPeople, false);
  assert.equal(employeeView.canManagePeople, false);
  assert.equal(employeeView.canViewOrgLedger, false);
  assert.equal(employeeView.credentials.length, 1);
  assert.equal(employeeView.credentials[0].holderEmail, 'employee@vanguardcs.ca');
  assert.equal(employeeView.peopleTable.filteredCount, 1);
});

test('credential-holder memberships appear in organization access without admin mutation', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vanguard-org-membership-'));
  const previousWorkspacePath = process.env.SUBSCRIBER_WORKSPACE_STORE_PATH;
  const previousOrgAdminPath = process.env.ORG_ADMIN_STORE_PATH;
  const previousOrgEventsPath = process.env.ORG_ADMIN_EVENT_STORE_PATH;
  const previousSubscriptionPath = process.env.SUBSCRIPTION_STORE_PATH;
  process.env.SUBSCRIBER_WORKSPACE_STORE_PATH = path.join(tempDir, 'workspaces.json');
  process.env.ORG_ADMIN_STORE_PATH = path.join(tempDir, 'org-admin.json');
  process.env.ORG_ADMIN_EVENT_STORE_PATH = path.join(tempDir, 'org-admin-events.json');
  process.env.SUBSCRIPTION_STORE_PATH = path.join(tempDir, 'subscriptions.json');
  resetModules();

  t.after(() => {
    restoreEnv('SUBSCRIBER_WORKSPACE_STORE_PATH', previousWorkspacePath);
    restoreEnv('ORG_ADMIN_STORE_PATH', previousOrgAdminPath);
    restoreEnv('ORG_ADMIN_EVENT_STORE_PATH', previousOrgEventsPath);
    restoreEnv('SUBSCRIPTION_STORE_PATH', previousSubscriptionPath);
    resetModules();
  });

  const workspace = {
    id: 'org-membership',
    subscriptionId: 'sub-admin',
    organization: 'Vanguard Membership Org',
    ownerEmail: 'admin@vanguardcs.ca',
    members: [{ email: 'admin@vanguardcs.ca', role: 'administrator', addedAt: new Date().toISOString() }],
    platforms: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const admin = { id: 'sub-admin', email: 'admin@vanguardcs.ca', organization: 'Vanguard Membership Org' };
  await fs.writeFile(process.env.SUBSCRIBER_WORKSPACE_STORE_PATH, JSON.stringify([workspace], null, 2), 'utf8');

  const {
    issueCredential,
    listCredentialMembershipsForEmail
  } = require('../src/services/org-admin-service');
  const {
    ensureAccountAccessSubscription
  } = require('../src/services/subscription-service');
  const {
    listWorkspacesForSubscription
  } = require('../src/services/platform-service');

  await issueCredential(workspace, admin, {
    holderEmail: 'employee@vanguardcs.ca',
    displayName: 'Employee Holder',
    roleIds: ['role-employee'],
    claim_email: 'employee@vanguardcs.ca',
    claim_displayName: 'Employee Holder'
  });

  const memberships = await listCredentialMembershipsForEmail('employee@vanguardcs.ca');
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].workspaceId, workspace.id);
  assert.equal(memberships[0].status, 'invited');

  const accountAccess = await ensureAccountAccessSubscription({
    id: 'user-employee',
    email: 'employee@vanguardcs.ca',
    displayName: 'Employee Holder'
  });
  const workspaces = await listWorkspacesForSubscription(accountAccess, {
    membershipWorkspaceIds: memberships.map((membership) => membership.workspaceId)
  });

  assert.equal(workspaces.length, 1);
  assert.equal(workspaces[0].id, workspace.id);
  assert.equal(workspaces[0].role, 'credential-holder');
  assert.equal(workspaces[0].roleLabel, 'Credential holder');
  assert.equal(workspaces[0].canManageWorkspace, false);
  assert.equal(workspaces[0].dashboardPath, `/dashboard/${accountAccess.id}/orgs/${workspace.id}`);

  const persistedWorkspaces = JSON.parse(await fs.readFile(process.env.SUBSCRIBER_WORKSPACE_STORE_PATH, 'utf8'));
  assert.equal(
    persistedWorkspaces[0].members.some((member) => member.email === 'employee@vanguardcs.ca'),
    false
  );
});

function resetModules() {
  for (const modulePath of [
    '../src/config',
    '../src/services/platform-service',
    '../src/services/org-admin-service',
    '../src/services/subscription-service'
  ]) {
    delete require.cache[require.resolve(modulePath)];
  }
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
