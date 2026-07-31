const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Phase 7 coverage. These tests are written around the attacks recovery has to
// resist, not just the happy path: stolen codes, SIM-swapped OTPs, replayed
// codes, change-email-then-recover, and cross-organization restore leakage.

const MODULES = [
  '../src/config',
  '../src/services/wallet-registry-service',
  '../src/services/wallet-recovery-service',
  '../src/services/wallet-contact-service',
  '../src/services/audit-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withRecovery(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-recovery-'));
  const previous = { ...process.env };
  process.env.WALLET_STORE_PATH = path.join(dir, 'wallets.json');
  process.env.WALLET_RECOVERY_CODE_STORE_PATH = path.join(dir, 'codes.json');
  process.env.WALLET_RECOVERY_REQUEST_STORE_PATH = path.join(dir, 'requests.json');
  process.env.WALLET_CONTACT_CHALLENGE_STORE_PATH = path.join(dir, 'contact.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit-events.json');
  resetModules();
  try {
    await run({
      registry: require('../src/services/wallet-registry-service'),
      recovery: require('../src/services/wallet-recovery-service'),
      contact: require('../src/services/wallet-contact-service'),
      audit: require('../src/services/audit-service'),
      dir
    });
  } finally {
    process.env = previous;
    resetModules();
  }
}

async function setupWallet(registry, recovery, overrides = {}) {
  const wallet = await registry.registerWallet({
    email: overrides.email || 'holder@example.com',
    phone: overrides.phone || '613-555-0100',
    devicePublicKey: overrides.devicePublicKey || 'old-device-key'
  });
  const codes = await recovery.generateRecoveryCodes(wallet.walletId);
  return { wallet, codes: codes.codes };
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

test('setup issues 10 single-use codes and never persists them in plaintext', async () => {
  await withRecovery(async ({ registry, recovery }) => {
    const { codes } = await setupWallet(registry, recovery);

    assert.equal(codes.length, 10);
    for (const code of codes) {
      assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    }

    const stored = await fs.readFile(process.env.WALLET_RECOVERY_CODE_STORE_PATH, 'utf8');
    for (const code of codes) {
      assert.equal(stored.includes(code), false, 'plaintext recovery code must never be stored');
    }
  });
});

test('a recovery code is single use — replay is rejected', async () => {
  await withRecovery(async ({ registry, recovery }) => {
    const { wallet, codes } = await setupWallet(registry, recovery);

    assert.equal(await recovery.redeemRecoveryCode(wallet.walletId, codes[0]), true);
    assert.equal(await recovery.redeemRecoveryCode(wallet.walletId, codes[0]), false, 'replay must fail');
    assert.equal(await recovery.getRemainingCodeCount(wallet.walletId), 9);
  });
});

test('regenerating codes invalidates the entire previous set', async () => {
  await withRecovery(async ({ registry, recovery }) => {
    const { wallet, codes } = await setupWallet(registry, recovery);
    await recovery.generateRecoveryCodes(wallet.walletId);

    assert.equal(await recovery.redeemRecoveryCode(wallet.walletId, codes[0]), false);
    assert.equal(await recovery.getRemainingCodeCount(wallet.walletId), 10);
  });
});

// ---------------------------------------------------------------------------
// Tier 1 — self-service (code + OTP). Both factors are mandatory.
// ---------------------------------------------------------------------------

test('TIER 1 — code plus OTP completes recovery and re-binds a new device key', async () => {
  await withRecovery(async ({ registry, recovery }) => {
    const { wallet, codes } = await setupWallet(registry, recovery);

    const { request, otp } = await recovery.startRecovery({ walletId: wallet.walletId });
    await recovery.verifyOtp(request.id, otp);
    await recovery.redeemCodeForRequest(request.id, codes[0]);
    const result = await recovery.completeRecovery(request.id, { devicePublicKey: 'new-device-key' });

    assert.equal(result.walletId, wallet.walletId, 'the Wallet ID is preserved across recovery');
    assert.equal(result.restoreScope, 'low-medium');
    assert.equal(result.suspendsHighAssurance, true, 'Tier 1 must suspend high assurance (R1)');
    assert.ok(result.coolingOffUntil, 'Tier 1 imposes the 24h cooling-off (R3)');
    assert.ok(result.contactFrozenUntil, 'contact edits freeze after recovery (A5)');

    const stored = JSON.parse(await fs.readFile(process.env.WALLET_STORE_PATH, 'utf8'));
    assert.equal(stored[0].devicePublicKey, 'new-device-key');
    assert.equal(stored[0].deviceKeyHistory[0].devicePublicKey, 'old-device-key');
    assert.equal(stored[0].deviceKeyHistory[0].reason, 'wallet-recovery', 'old key revoked');
  });
});

test('ATTACK — a stolen recovery code alone (no OTP) is rejected', async () => {
  await withRecovery(async ({ registry, recovery }) => {
    const { wallet, codes } = await setupWallet(registry, recovery);
    const { request } = await recovery.startRecovery({ walletId: wallet.walletId });

    await assert.rejects(
      () => recovery.redeemCodeForRequest(request.id, codes[0]),
      (error) => /Verify the code sent to your registered contact/i.test(error.message)
    );
    // The code must not have been consumed by the failed attempt.
    assert.equal(await recovery.getRemainingCodeCount(wallet.walletId), 10);
  });
});

test('ATTACK — a SIM-swapped OTP alone (no recovery code) cannot complete recovery', async () => {
  await withRecovery(async ({ registry, recovery }) => {
    const { wallet } = await setupWallet(registry, recovery);
    const { request, otp } = await recovery.startRecovery({ walletId: wallet.walletId });
    await recovery.verifyOtp(request.id, otp);

    // OTP verified, but no code redeemed and no org attestation → not approved.
    await assert.rejects(
      () => recovery.completeRecovery(request.id, { devicePublicKey: 'attacker-key' }),
      (error) => /not been approved/i.test(error.message)
    );
  });
});

test('ATTACK — a wrong recovery code is rejected and rate limited', async () => {
  await withRecovery(async ({ registry, recovery }) => {
    const { wallet } = await setupWallet(registry, recovery);
    const { request, otp } = await recovery.startRecovery({ walletId: wallet.walletId });
    await recovery.verifyOtp(request.id, otp);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await assert.rejects(() => recovery.redeemCodeForRequest(request.id, 'AAAA-BBBB'));
    }
    await assert.rejects(
      () => recovery.redeemCodeForRequest(request.id, 'AAAA-BBBB'),
      (error) => error.status === 429,
      'must lock out after repeated failures'
    );
  });
});

test('ATTACK — a wrong OTP is rejected and counted', async () => {
  await withRecovery(async ({ registry, recovery }) => {
    const { wallet } = await setupWallet(registry, recovery);
    const { request } = await recovery.startRecovery({ walletId: wallet.walletId });

    await assert.rejects(
      () => recovery.verifyOtp(request.id, '000000'),
      (error) => /not correct/i.test(error.message)
    );
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — organization attestation
// ---------------------------------------------------------------------------

test('TIER 2 — org approval restores that organization only, without codes', async () => {
  await withRecovery(async ({ registry, recovery }) => {
    const wallet = await registry.registerWallet({
      email: 'nocodes@example.com',
      devicePublicKey: 'old-key-2'
    });

    const { request, otp } = await recovery.startRecovery({ walletId: wallet.walletId });
    await recovery.verifyOtp(request.id, otp);
    await recovery.requestOrgAttestation(request.id, 'org-a');
    await recovery.approveOrgAttestation(request.id, {
      approvedBy: 'admin@org-a.gc.ca',
      idImageHash: 'hash-id',
      faceImageHash: 'hash-face',
      method: 'in-person'
    });

    const result = await recovery.completeRecovery(request.id, { devicePublicKey: 'new-key-2' });
    assert.equal(result.restoreScope, 'org');
    assert.equal(result.orgId, 'org-a', 'only the approving organization is in scope (R5)');
    assert.equal(result.suspendsHighAssurance, false, 'Tier 2 restores high assurance');
    assert.equal(result.coolingOffUntil, null, 'no cooling-off for org-attested recovery');
  });
});

test('TIER 2 — rejection terminates the request', async () => {
  await withRecovery(async ({ registry, recovery }) => {
    const wallet = await registry.registerWallet({ email: 'rej@example.com', devicePublicKey: 'k' });
    const { request, otp } = await recovery.startRecovery({ walletId: wallet.walletId });
    await recovery.verifyOtp(request.id, otp);
    await recovery.requestOrgAttestation(request.id, 'org-a');
    await recovery.rejectOrgAttestation(request.id, 'Identity could not be confirmed', 'admin@org-a.gc.ca');

    await assert.rejects(
      () => recovery.completeRecovery(request.id, { devicePublicKey: 'x' }),
      (error) => error.status === 409
    );
  });
});

test('org queue lists only requests awaiting that organization', async () => {
  await withRecovery(async ({ registry, recovery }) => {
    const wallet = await registry.registerWallet({ email: 'q@example.com', devicePublicKey: 'k' });
    const { request, otp } = await recovery.startRecovery({ walletId: wallet.walletId });
    await recovery.verifyOtp(request.id, otp);
    await recovery.requestOrgAttestation(request.id, 'org-a');

    assert.equal((await recovery.listRecoveryRequestsForOrg('org-a')).length, 1);
    assert.equal((await recovery.listRecoveryRequestsForOrg('org-b')).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

test('HARD STOP — no codes and no connected org offers no self-service path (R6)', async () => {
  await withRecovery(async ({ registry, recovery }) => {
    const wallet = await registry.registerWallet({ email: 'stuck@example.com', devicePublicKey: 'k' });

    const options = await recovery.getRecoveryOptions(wallet.walletId, { connectedOrgIds: [] });
    assert.equal(options.canUseCodes, false);
    assert.equal(options.canUseOrgAttestation, false);
    assert.equal(options.hardStop, true);
  });
});

test('ATTACK — change-email-then-recover is blocked by the post-recovery contact freeze', async () => {
  await withRecovery(async ({ registry, recovery, contact }) => {
    const { wallet, codes } = await setupWallet(registry, recovery);

    const { request, otp } = await recovery.startRecovery({ walletId: wallet.walletId });
    await recovery.verifyOtp(request.id, otp);
    await recovery.redeemCodeForRequest(request.id, codes[0]);
    await recovery.completeRecovery(request.id, { devicePublicKey: 'new-key' });

    // Immediately after recovery, contact edits must be refused.
    await assert.rejects(
      () => contact.startContactChange(wallet.walletId, { field: 'email', value: 'attacker@evil.test' }),
      (error) => error.status === 423
    );
  });
});

test('a cancelled recovery cannot be completed', async () => {
  await withRecovery(async ({ registry, recovery }) => {
    const { wallet, codes } = await setupWallet(registry, recovery);
    const { request, otp } = await recovery.startRecovery({ walletId: wallet.walletId });
    await recovery.verifyOtp(request.id, otp);
    await recovery.redeemCodeForRequest(request.id, codes[0]);

    await recovery.cancelRecovery(request.id);
    await assert.rejects(
      () => recovery.completeRecovery(request.id, { devicePublicKey: 'x' }),
      (error) => error.status === 409
    );
  });
});

test('completing a recovery twice is refused', async () => {
  await withRecovery(async ({ registry, recovery }) => {
    const { wallet, codes } = await setupWallet(registry, recovery);
    const { request, otp } = await recovery.startRecovery({ walletId: wallet.walletId });
    await recovery.verifyOtp(request.id, otp);
    await recovery.redeemCodeForRequest(request.id, codes[0]);
    await recovery.completeRecovery(request.id, { devicePublicKey: 'new-key' });

    await assert.rejects(
      () => recovery.completeRecovery(request.id, { devicePublicKey: 'another-key' }),
      (error) => error.status === 409
    );
  });
});

test('starting recovery for an unknown wallet does not disclose existence', async () => {
  await withRecovery(async ({ recovery }) => {
    await assert.rejects(
      () => recovery.startRecovery({ email: 'nobody@example.com' }),
      (error) => error.status === 404 && /If that wallet exists/i.test(error.message)
    );
  });
});

test('the whole recovery trail is recorded and the evidence chain verifies', async () => {
  await withRecovery(async ({ registry, recovery, audit }) => {
    const { wallet, codes } = await setupWallet(registry, recovery);
    const { request, otp } = await recovery.startRecovery({ walletId: wallet.walletId });
    await recovery.verifyOtp(request.id, otp);
    await recovery.redeemCodeForRequest(request.id, codes[0]);
    await recovery.completeRecovery(request.id, { devicePublicKey: 'new-key' });

    const events = (await audit.listAuditEvents()).map((event) => event.type);
    for (const expected of [
      'wallet.recovery.codes.generated',
      'wallet.recovery.initiated',
      'wallet.recovery.otp.verified',
      'wallet.recovery.code.redeemed',
      'wallet.recovery.completed'
    ]) {
      assert.ok(events.includes(expected), `missing evidence event ${expected}`);
    }

    assert.equal((await audit.verifyAuditChain()).ok, true);
  });
});
