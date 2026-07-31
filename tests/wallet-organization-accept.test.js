const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Regression coverage for the "QR scan hangs on the local holder" defect:
// organization invitations must be created and accepted WITHOUT any ACA-Py agent,
// so the flow works on deployments where the Aries lab is not running.

const MODULES = [
  '../src/config',
  '../src/services/issuer-organization-service',
  '../src/adapters/aries/aries-lab-adapter'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withIsolatedStore(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-org-invite-'));
  const previous = { ...process.env };
  process.env.ISSUER_ORG_STORE_PATH = path.join(dir, 'issuer-organizations.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit-events.json');
  process.env.PUBLIC_BASE_URL = 'https://aegis.test';
  process.env.WALLET_CHALLENGE_STORE_PATH = path.join(dir, 'wallet-challenges.json');
  delete process.env.ARIES_ORG_INVITATION_MODE; // default = product path
  resetModules();
  try {
    await run(require('../src/services/issuer-organization-service'));
  } finally {
    process.env = previous;
    resetModules();
  }
}

const subscription = { id: 'sub-1', organization: 'VCS-613', email: 'admin@vanguardcs.ca' };
const workspace = { id: 'ws-1', organization: 'VCS-613', role: 'administrator' };

test('organization invitation is created without contacting ACA-Py', async () => {
  await withIsolatedStore(async (service) => {
    // If the product path ever calls the lab adapter this throws and fails the test.
    const labAdapter = require('../src/adapters/aries/aries-lab-adapter');
    labAdapter.createOutOfBandInvitation = async () => {
      throw new Error('ACA-Py must not be called on the product path');
    };

    const record = await service.createIssuerOrganizationInvitation(subscription, workspace);

    assert.equal(record.mode, 'product');
    assert.match(record.invitationUrl, /^aegisid:\/\/org-invite\?/);
    assert.ok(record.qrCodeDataUrl.startsWith('data:image/png;base64,'));
    assert.equal(record.status, 'invitation-created');

    const url = new URL(record.invitationUrl);
    assert.equal(url.searchParams.get('organization_id'), 'ws-1');
    assert.equal(url.searchParams.get('organization_name'), 'VCS-613');
    assert.equal(url.searchParams.get('vanguard_web_app_url'), 'https://aegis.test');
  });
});

test('accepting an organization invitation connects the wallet with no ACA-Py', async () => {
  await withIsolatedStore(async (service) => {
    const invitation = await service.createIssuerOrganizationInvitation(subscription, workspace);

    const accepted = await service.acceptOrganizationInvitation(invitation.id, {
      walletId: 'AEG-4K7P-2M9X-QT3B'
    });

    assert.equal(accepted.status, 'connected');
    assert.equal(accepted.walletId, 'AEG-4K7P-2M9X-QT3B');
    assert.ok(accepted.acceptedAt);

    // A product-path connection must appear as connected everywhere, including
    // the wallet-challenge surfaces. Requiring an issuerConnectionId here hid it
    // from the OIDC demo, which then reported "no connected issuing org found".
    const connected = await service.listConnectedIssuerOrganizations();
    assert.equal(connected.length, 1);
    assert.equal(connected[0].organizationId, 'ws-1');
    assert.equal(connected[0].issuerConnectionId, null, 'no DIDComm channel on the product path');

    const all = await service.listIssuerOrganizations('sub-1', 'ws-1');
    assert.equal(all[0].status, 'connected');
  });
});

test('re-accepting the same invitation is idempotent (rescan does not duplicate)', async () => {
  await withIsolatedStore(async (service) => {
    const invitation = await service.createIssuerOrganizationInvitation(subscription, workspace);
    const first = await service.acceptOrganizationInvitation(invitation.id, { walletId: 'AEG-1111-2222-3333' });
    const second = await service.acceptOrganizationInvitation(invitation.id, { walletId: 'AEG-1111-2222-3333' });

    assert.equal(first.acceptedAt, second.acceptedAt, 'acceptedAt is preserved');
    const all = await service.listIssuerOrganizations('sub-1', 'ws-1');
    assert.equal(all.length, 1, 'no duplicate records');
  });
});

test('a different wallet cannot hijack an already-bound invitation', async () => {
  await withIsolatedStore(async (service) => {
    const invitation = await service.createIssuerOrganizationInvitation(subscription, workspace);
    await service.acceptOrganizationInvitation(invitation.id, { walletId: 'AEG-1111-2222-3333' });

    await assert.rejects(
      () => service.acceptOrganizationInvitation(invitation.id, { walletId: 'AEG-9999-8888-7777' }),
      (error) => error.status === 409
    );
  });
});

test('unknown invitation returns 404', async () => {
  await withIsolatedStore(async (service) => {
    await assert.rejects(
      () => service.acceptOrganizationInvitation('does-not-exist', { walletId: 'AEG-1111-2222-3333' }),
      (error) => error.status === 404
    );
  });
});

test('a product-path organization can receive a wallet challenge with no ACA-Py', async () => {
  await withIsolatedStore(async (service) => {
    const invitation = await service.createIssuerOrganizationInvitation(subscription, workspace);
    await service.acceptOrganizationInvitation(invitation.id, { walletId: 'AEG-1111-2222-3333' });

    // Fresh module instance so it binds to this test's isolated stores.
    delete require.cache[require.resolve('../src/services/wallet-challenge-service')];
    const { createExternalWalletChallenge } = require('../src/services/wallet-challenge-service');

    const challenge = await createExternalWalletChallenge({
      appName: 'OIDC demo',
      subject: 'holder@example.com',
      organizationId: 'ws-1',
      action: 'approve'
    });

    // Previously this threw "a wallet issuer connection is required", which is
    // what made the OIDC wallet gate unusable after a product-path connect.
    assert.equal(challenge.organizationId, 'ws-1');
    assert.equal(challenge.status, 'sent');
    assert.equal(challenge.delivery.status, 'api-pending', 'wallet collects it by polling');

    delete require.cache[require.resolve('../src/services/wallet-challenge-service')];
  });
});

test('a product-path wallet can poll for its challenge by organization', async () => {
  await withIsolatedStore(async (service) => {
    const invitation = await service.createIssuerOrganizationInvitation(subscription, workspace);
    await service.acceptOrganizationInvitation(invitation.id, { walletId: 'AEG-1111-2222-3333' });

    delete require.cache[require.resolve('../src/services/wallet-challenge-service')];
    const {
      createExternalWalletChallenge,
      listPendingExternalWalletChallenges
    } = require('../src/services/wallet-challenge-service');

    await createExternalWalletChallenge({
      appName: 'OIDC demo',
      subject: 'holder@example.com',
      organizationId: 'ws-1',
      action: 'approve'
    });

    // Polling by organization must find it. Filtering on connectionId alone made
    // product-path challenges undeliverable: the wallet has no connection id.
    const byOrg = await listPendingExternalWalletChallenges({ organizationId: 'ws-1' });
    assert.equal(byOrg.length, 1);
    assert.equal(byOrg[0].organizationId, 'ws-1');

    // A different organization must not see it.
    const otherOrg = await listPendingExternalWalletChallenges({ organizationId: 'ws-other' });
    assert.equal(otherOrg.length, 0);

    // The legacy string argument still behaves as a connectionId filter.
    const byConnection = await listPendingExternalWalletChallenges('some-didcomm-id');
    assert.equal(byConnection.length, 0);

    delete require.cache[require.resolve('../src/services/wallet-challenge-service')];
  });
});
