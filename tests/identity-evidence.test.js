const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MODULES = ['../src/config', '../src/services/audit-service', '../src/services/identity-evidence'];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withIsolatedLedger(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-identity-evidence-'));
  const previous = { ...process.env };
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit-events.json');
  process.env.AUDIT_SIGNING_ENABLED = 'false';
  process.env.AUDIT_ANCHOR_MODE = 'none';
  process.env.AUDIT_CHAIN_ENABLED = 'true';
  resetModules();
  try {
    const identity = require('../src/services/identity-evidence');
    const { listAuditEvents, verifyAuditChain } = require('../src/services/audit-service');
    await run({ identity, listAuditEvents, verifyAuditChain });
  } finally {
    process.env = previous;
    resetModules();
  }
}

test('onboarding + authentication helpers write typed, chained evidence', async () => {
  await withIsolatedLedger(async ({ identity, listAuditEvents, verifyAuditChain }) => {
    await identity.recordIdentityProofed({
      subject: 'entra:tenant-1:user-1',
      officer: 'officer@agency.gc.ca',
      method: 'in-person',
      idImageHash: 'hash-id',
      faceImageHash: 'hash-face'
    });
    await identity.recordAuthenticatorBound({
      subject: 'entra:tenant-1:user-1',
      credentialId: 'cred-public-1',
      aaguid: 'yubikey-5',
      type: 'yubikey',
      boundBy: 'officer@agency.gc.ca'
    });
    await identity.recordWalletEnrolled({ subject: 'entra:tenant-1:user-1', walletId: 'wallet-1' });
    await identity.recordIdentityAuthenticated({
      subject: 'entra:tenant-1:user-1',
      amr: ['fido'],
      acr: 'urn:vanguard:aegis-id:auth:upstream-entra',
      authTime: '2026-07-30T09:00:00.000Z',
      tenant: 'tenant-1'
    });

    const events = await listAuditEvents();
    const types = events.map((event) => event.type).sort();
    assert.deepEqual(types, [
      'authenticator.bound',
      'identity.authenticated',
      'identity.proofed',
      'wallet.enrolled'
    ]);

    // The whole onboarding + login trail is one verifiable chain.
    assert.deepEqual(await verifyAuditChain(), { ok: true, count: 4 });
  });
});

test('recordTaaAcceptance captures Indy write-agreement evidence', async () => {
  await withIsolatedLedger(async ({ identity, listAuditEvents }) => {
    await identity.recordTaaAcceptance({
      network: 'candy-prod',
      version: '1.0',
      digest: 'sha256-of-taa-text',
      mechanism: 'service_agreement',
      approver: 'legal@vanguardcs.ca'
    });
    const [event] = await listAuditEvents();
    assert.equal(event.type, 'taa.accepted');
    assert.equal(event.data.network, 'candy-prod');
    assert.equal(event.data.mechanism, 'service_agreement');
  });
});
