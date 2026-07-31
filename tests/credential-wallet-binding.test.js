const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Phase 4 coverage: the three invite binding modes end to end through
// org-admin-service, plus the consent fix (wallet accept must grant consent) and
// the status lookup that drives the admin modal auto-close.

const MODULES = [
  '../src/config',
  '../src/services/org-admin-service',
  '../src/services/wallet-registry-service',
  '../src/services/platform-service',
  '../src/services/audit-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withServices(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-cred-binding-'));
  const previous = { ...process.env };
  process.env.WALLET_STORE_PATH = path.join(dir, 'wallets.json');
  process.env.ORG_ADMIN_STORE_PATH = path.join(dir, 'org-admin.json');
  process.env.ORG_ADMIN_EVENT_STORE_PATH = path.join(dir, 'org-admin-events.json');
  process.env.SUBSCRIPTION_STORE_PATH = path.join(dir, 'subscriptions.json');
  process.env.SUBSCRIBER_WORKSPACE_STORE_PATH = path.join(dir, 'workspaces.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit-events.json');
  resetModules();
  try {
    await run({
      orgAdmin: require('../src/services/org-admin-service'),
      registry: require('../src/services/wallet-registry-service')
    });
  } finally {
    process.env = previous;
    resetModules();
  }
}

// The workspace owner is an administrator, so privilege checks pass naturally
// (RBAC itself is covered by the authorization tests).
const workspace = {
  id: 'ws-1',
  subscriptionId: 'sub-1',
  organization: 'VCS-613',
  ownerEmail: 'admin@vanguardcs.ca',
  members: [{ email: 'admin@vanguardcs.ca', role: 'administrator', addedAt: new Date().toISOString() }],
  platforms: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
const subscription = { id: 'sub-1', email: 'admin@vanguardcs.ca', organization: 'VCS-613' };

function issue(orgAdmin, input) {
  return orgAdmin.issueCredential(workspace, subscription, input);
}

test('MODE 1 — a wallet accepts a credential issued to a different per-org email', async () => {
  await withServices(async ({ orgAdmin, registry }) => {
    const wallet = await registry.registerWallet({
      email: 'personal@example.com',
      devicePublicKey: 'device-multi-org'
    });

    // The organization knows this holder by their work address.
    const credential = await issue(orgAdmin, {
      holderEmail: 'contractor@agency.gc.ca',
      walletId: wallet.walletId,
      displayName: 'Federal Contractor'
    });
    assert.equal(credential.bindingMode, 'wallet-id');
    assert.equal(credential.walletId, wallet.walletId);

    const accepted = await orgAdmin.acceptCredentialInvitation(workspace.id, credential.id, {
      walletId: wallet.walletId
    });

    assert.equal(accepted.status, 'active');
    assert.equal(accepted.bindingMode, 'wallet-id');
    // The consent fix: accepting in the wallet grants consent.
    assert.equal(accepted.consentStatus, 'granted');
  });
});

test('MODE 1 — a different wallet cannot accept the invitation', async () => {
  await withServices(async ({ orgAdmin, registry }) => {
    const owner = await registry.registerWallet({ email: 'owner@example.com', devicePublicKey: 'device-owner' });
    const attacker = await registry.registerWallet({ email: 'attacker@example.com', devicePublicKey: 'device-attacker' });

    const credential = await issue(orgAdmin, { holderEmail: 'owner@example.com', walletId: owner.walletId });

    await assert.rejects(
      () => orgAdmin.acceptCredentialInvitation(workspace.id, credential.id, { walletId: attacker.walletId }),
      (error) => /different wallet/i.test(error.message)
    );

    const status = await orgAdmin.getCredentialInvitationStatus(workspace.id, credential.id);
    assert.equal(status.status, 'invited', 'a rejected attempt must not activate the credential');
  });
});

test('MODE 2 — email invite binds only to the wallet that registered that email', async () => {
  await withServices(async ({ orgAdmin, registry }) => {
    const wallet = await registry.registerWallet({ email: 'staff@example.com', devicePublicKey: 'device-email' });
    const other = await registry.registerWallet({ email: 'other@example.com', devicePublicKey: 'device-other' });

    const credential = await issue(orgAdmin, { holderEmail: 'staff@example.com' });
    assert.equal(credential.bindingMode, 'email');

    await assert.rejects(
      () => orgAdmin.acceptCredentialInvitation(workspace.id, credential.id, { walletId: other.walletId }),
      (error) => /different wallet/i.test(error.message)
    );

    const accepted = await orgAdmin.acceptCredentialInvitation(workspace.id, credential.id, {
      walletId: wallet.walletId
    });
    assert.equal(accepted.status, 'active');
    assert.equal(accepted.bindingMode, 'email');
  });
});

test('MODE 2 — an email that belongs to no registered wallet cannot be accepted', async () => {
  await withServices(async ({ orgAdmin, registry }) => {
    const wallet = await registry.registerWallet({ email: 'known@example.com', devicePublicKey: 'device-known' });
    const credential = await issue(orgAdmin, { holderEmail: 'stranger@example.com' });

    await assert.rejects(
      () => orgAdmin.acceptCredentialInvitation(workspace.id, credential.id, { walletId: wallet.walletId }),
      (error) => /registered wallet contact/i.test(error.message)
    );
  });
});

test('MODE 3 — phone invite binds to the wallet that registered that number', async () => {
  await withServices(async ({ orgAdmin, registry }) => {
    const wallet = await registry.registerWallet({
      email: 'sms@example.com',
      phone: '613-555-0123',
      devicePublicKey: 'device-phone'
    });

    // Phone-only invite: no email supplied at all.
    const credential = await issue(orgAdmin, { holderPhone: '+16135550123', displayName: 'SMS Holder' });
    assert.equal(credential.bindingMode, 'phone');

    const accepted = await orgAdmin.acceptCredentialInvitation(workspace.id, credential.id, {
      walletId: wallet.walletId
    });
    assert.equal(accepted.status, 'active');
    assert.equal(accepted.bindingMode, 'phone');
  });
});

test('an invalid Wallet ID is rejected at issue time (typo protection)', async () => {
  await withServices(async ({ orgAdmin }) => {
    await assert.rejects(
      () => issue(orgAdmin, { holderEmail: 'a@example.com', walletId: 'AEG-0000-0000-0000-0001' }),
      (error) => /not valid/i.test(error.message)
    );
  });
});

test('accepting is idempotent and consent stays granted', async () => {
  await withServices(async ({ orgAdmin, registry }) => {
    const wallet = await registry.registerWallet({ email: 'idem@example.com', devicePublicKey: 'device-idem' });
    const credential = await issue(orgAdmin, { holderEmail: 'idem@example.com', walletId: wallet.walletId });

    const first = await orgAdmin.acceptCredentialInvitation(workspace.id, credential.id, { walletId: wallet.walletId });
    const second = await orgAdmin.acceptCredentialInvitation(workspace.id, credential.id, { walletId: wallet.walletId });

    assert.equal(first.acceptedAt, second.acceptedAt);
    assert.equal(second.consentStatus, 'granted');
  });
});

test('revoked credentials cannot be accepted', async () => {
  await withServices(async ({ orgAdmin, registry }) => {
    const wallet = await registry.registerWallet({ email: 'rev@example.com', devicePublicKey: 'device-rev' });
    const credential = await issue(orgAdmin, { holderEmail: 'rev@example.com', walletId: wallet.walletId });

    // Flip the stored credential to revoked.
    const statePath = process.env.ORG_ADMIN_STORE_PATH;
    const states = JSON.parse(await fs.readFile(statePath, 'utf8'));
    states[0].credentials[0].status = 'revoked';
    await fs.writeFile(statePath, JSON.stringify(states, null, 2));

    await assert.rejects(
      () => orgAdmin.acceptCredentialInvitation(workspace.id, credential.id, { walletId: wallet.walletId }),
      (error) => /revoked/i.test(error.message)
    );
  });
});

test('invitation status reports the invited to active transition for the modal', async () => {
  await withServices(async ({ orgAdmin, registry }) => {
    const wallet = await registry.registerWallet({ email: 'poll@example.com', devicePublicKey: 'device-poll' });
    const credential = await issue(orgAdmin, { holderEmail: 'poll@example.com', walletId: wallet.walletId });

    const before = await orgAdmin.getCredentialInvitationStatus(workspace.id, credential.id);
    assert.equal(before.status, 'invited');
    assert.equal(before.consentStatus, 'requested');
    assert.equal(before.expired, false);

    await orgAdmin.acceptCredentialInvitation(workspace.id, credential.id, { walletId: wallet.walletId });

    const after = await orgAdmin.getCredentialInvitationStatus(workspace.id, credential.id);
    assert.equal(after.status, 'active');
    assert.equal(after.consentStatus, 'granted');
    assert.ok(after.acceptedAt);
  });
});

test('the invite QR carries wallet_id and binding_mode for mode 1', async () => {
  await withServices(async ({ orgAdmin, registry }) => {
    const wallet = await registry.registerWallet({ email: 'qr@example.com', devicePublicKey: 'device-qr' });
    const credential = await issue(orgAdmin, { holderEmail: 'work@agency.gc.ca', walletId: wallet.walletId });

    const invitation = await orgAdmin.buildCredentialInvitation(workspace, credential);
    const url = new URL(invitation.inviteUrl.replace('aegisid://', 'https://placeholder/'));
    assert.equal(url.searchParams.get('wallet_id'), wallet.walletId);
    assert.equal(url.searchParams.get('binding_mode'), 'wallet-id');
    assert.equal(url.searchParams.get('holder_email'), 'work@agency.gc.ca');
  });
});
