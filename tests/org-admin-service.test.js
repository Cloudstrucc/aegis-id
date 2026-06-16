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
    getOrganizationProfile,
    getOrgAdminView,
    issueCredential,
    markCredentialAccepted,
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

  const credential = await issueCredential(workspace, subscription, {
    holderEmail: 'holder@vanguardcs.ca',
    displayName: 'Vanguard Holder',
    roleIds: ['role-employee', role.id],
    claim_displayName: 'Vanguard Holder',
    claim_email: 'holder@vanguardcs.ca',
    claim_department: 'Security',
    claim_employmentStatus: 'active'
  });
  assert.equal(credential.status, 'invited');

  await markCredentialAccepted(workspace, subscription, credential.id);
  const coAdminRequest = await requestCoAdmin(workspace, subscription, credential.id);
  await acceptCoAdminChallenge(workspace, subscription, coAdminRequest.id, 'admin');
  await acceptCoAdminChallenge(workspace, subscription, coAdminRequest.id, 'holder');

  const adminView = await getOrgAdminView(workspace, subscription);
  const activeCredential = adminView.credentials.find((item) => item.id === credential.id);
  assert.equal(activeCredential.status, 'active');
  assert.equal(activeCredential.coAdminStatus, 'approved');
  assert.equal(adminView.coAdminCount, 1);
  assert.equal(adminView.customPaletteSelected, true);

  const profile = await getOrganizationProfile(workspace.id);
  assert.equal(profile.organizationName, 'Vanguard Cloud Services');
  assert.equal(profile.branding.primaryColor, '#123456');
  assert.equal(profile.credentials[0].roles.some((item) => item.name === 'Privileged Operator'), true);
  assert.equal(profile.credentials[0].claims.department, 'Security');

  const events = JSON.parse(await fs.readFile(process.env.ORG_ADMIN_EVENT_STORE_PATH, 'utf8'));
  const walletChallengeEvents = events.filter((event) => event.type === 'wallet.challenge.sent');
  assert.equal(walletChallengeEvents.length, 3);
  assert.equal(walletChallengeEvents.every((event) => event.data.immutable === true), true);
  assert.equal(walletChallengeEvents.filter((event) => String(event.data.challenge).startsWith('coadmin-')).length, 2);

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
