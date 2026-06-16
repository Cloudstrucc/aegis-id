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
    updateBranding
  } = require('../src/services/org-admin-service');

  const role = await createRole(workspace, subscription, {
    name: 'Privileged Operator',
    description: 'Can administer sensitive identity workflows.'
  });
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

  const adminView = await getOrgAdminView(workspace, subscription);
  const activeCredential = adminView.credentials.find((item) => item.id === credential.id);
  assert.equal(activeCredential.status, 'active');
  assert.equal(activeCredential.coAdminStatus, 'approved');
  assert.equal(activeCredential.personTypeLabel, 'Contractor');
  assert.equal(activeCredential.divisionName, 'Finance');
  assert.equal(activeCredential.consentStatusLabel, 'Consent granted');
  assert.equal(adminView.orgChartNodes.some((node) => node.name === 'Finance'), true);
  assert.equal(adminView.peopleTable.filteredCount, 1);
  assert.equal(adminView.coAdminCount, 1);
  assert.equal(adminView.customPaletteSelected, true);

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

function resetModules() {
  for (const modulePath of [
    '../src/config',
    '../src/services/platform-service',
    '../src/services/org-admin-service'
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
