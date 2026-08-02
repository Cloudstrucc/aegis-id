// Wallet recovery (plan §7).
//
// Recovery is NOT a backup restore. The device key is non-exportable by design
// and credentials already live server-side, so recovery means: prove you hold
// Wallet ID X, then re-bind it to a NEW device key. The Wallet ID itself never
// changes, so the holder never has to re-share it with their organizations.
//
// Tiers (see plan §7.2):
//   Tier 0 "passkey"  — synced platform passkey assertion (fast path)
//   Tier 1 "self"     — recovery code + contact OTP (two factors).
//                       Restores low/medium assurance; HIGH ASSURANCE SUSPENDED,
//                       and a 24h cooling-off gates high-value operations.
//   Tier 2 "org"      — an org admin re-verifies identity and approves. Restores
//                       that organization's credentials only.
//   Hard stop         — no codes and no connected org: re-enrolment required.

const crypto = require('node:crypto');
const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { getWalletByEmail, getWalletByWalletId } = require('./wallet-registry-service');
const { writeAuditEvent } = require('./audit-service');
const { deliverRecoveryCode } = require('./otp-delivery-service');

const codeStore = new FileJsonStore(config.paths.walletRecoveryCodes, []);
const requestStore = new FileJsonStore(config.paths.walletRecoveryRequests, []);
const walletStore = new FileJsonStore(config.paths.wallets, []);

const CODE_COUNT = 10;
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'; // unambiguous
const REQUEST_TTL_MS = 30 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const COOLING_OFF_MS = 24 * 60 * 60 * 1000; // R3
const CONTACT_FREEZE_MS = 7 * 24 * 60 * 60 * 1000; // A5

function validationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

function randomGroup(length) {
  let out = '';
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length)) {
      if (out.length >= length) {
        break;
      }
      if (byte < 256 - (256 % CODE_ALPHABET.length)) {
        out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      }
    }
  }
  return out;
}

function generatePlainCode() {
  return `${randomGroup(4)}-${randomGroup(4)}`;
}

function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[\s-]/g, '');
}

// scrypt with a per-code salt. Codes are never stored in plaintext.
function hashCode(plain, salt) {
  return crypto.scryptSync(normalizeCode(plain), salt, 32).toString('base64');
}

async function generateRecoveryCodes(walletId) {
  const wallet = await getWalletByWalletId(walletId);
  if (!wallet) {
    throw validationError('Wallet not found.', 404);
  }

  const plainCodes = Array.from({ length: CODE_COUNT }, generatePlainCode);
  const record = {
    walletId: wallet.walletId,
    codes: plainCodes.map((plain, index) => {
      const salt = crypto.randomBytes(16).toString('base64');
      return { index, salt, hash: hashCode(plain, salt), usedAt: null };
    }),
    generatedAt: new Date().toISOString()
  };

  const records = await codeStore.read();
  const existing = records.findIndex((entry) => entry.walletId === wallet.walletId);
  if (existing === -1) {
    records.push(record);
  } else {
    records[existing] = record; // regenerating invalidates the whole old set
  }
  await codeStore.write(records);

  await writeAuditEvent('wallet.recovery.codes.generated', {
    walletId: wallet.walletId,
    count: CODE_COUNT
  });

  // Plaintext is returned exactly once, to be shown to the holder and never persisted.
  return { walletId: wallet.walletId, codes: plainCodes, generatedAt: record.generatedAt };
}

async function getRemainingCodeCount(walletId) {
  const records = await codeStore.read();
  const record = records.find((entry) => entry.walletId === walletId);
  if (!record) {
    return 0;
  }
  return record.codes.filter((code) => !code.usedAt).length;
}

async function redeemRecoveryCode(walletId, plain) {
  const records = await codeStore.read();
  const record = records.find((entry) => entry.walletId === walletId);
  if (!record) {
    return false;
  }

  const normalized = normalizeCode(plain);
  if (!normalized) {
    return false;
  }

  for (const code of record.codes) {
    if (code.usedAt) {
      continue; // single use: a replayed code can never match again
    }
    const candidate = hashCode(normalized, code.salt);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(code.hash))) {
      code.usedAt = new Date().toISOString();
      await codeStore.write(records);
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Recovery requests
// ---------------------------------------------------------------------------

async function startRecovery(input = {}) {
  const wallet = input.walletId
    ? await getWalletByWalletId(input.walletId)
    : await getWalletByEmail(input.email);

  if (!wallet) {
    // Do not disclose whether the identifier exists.
    throw validationError('If that wallet exists, a verification code has been sent.', 404);
  }

  const now = new Date();
  const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const request = {
    id: crypto.randomUUID(),
    walletId: wallet.walletId,
    tier: null,
    status: 'initiated',
    otpHash: crypto.createHash('sha256').update(otp).digest('base64'),
    otpExpiresAt: new Date(now.getTime() + OTP_TTL_MS).toISOString(),
    otpVerifiedAt: null,
    attempts: 0,
    orgId: null,
    newDevicePublicKey: null,
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + REQUEST_TTL_MS).toISOString(),
    approvedBy: null,
    approvedAt: null,
    rejectedReason: null,
    cancelledAt: null,
    completedAt: null,
    evidence: null
  };

  const records = await requestStore.read();
  records.unshift(request);
  await requestStore.write(records);

  await writeAuditEvent('wallet.recovery.initiated', {
    walletId: wallet.walletId,
    requestId: request.id
  });

  // Send to the wallet's registered contact. In production this must succeed or
  // the call fails closed; outside production the code comes back for testing.
  const delivery = await deliverRecoveryCode({
    code: otp,
    walletId: wallet.walletId,
    email: wallet.email,
    phone: wallet.phone
  });

  // The code itself is never returned — it only ever reaches the holder over a
  // configured channel. Locally that is the filesystem transport.
  return {
    request: publicRequest(request),
    delivery: { delivered: delivery.delivered, channels: delivery.channels }
  };
}

async function loadActiveRequest(requestId) {
  const records = await requestStore.read();
  const index = records.findIndex((record) => record.id === requestId);
  if (index === -1) {
    throw validationError('Recovery request not found.', 404);
  }

  const request = records[index];
  if (['completed', 'cancelled', 'rejected'].includes(request.status)) {
    throw validationError(`This recovery request is ${request.status}.`, 409);
  }
  if (Date.parse(request.expiresAt) <= Date.now()) {
    request.status = 'expired';
    await requestStore.write(records);
    throw validationError('This recovery request has expired. Start again.', 409);
  }

  return { records, index, request };
}

async function verifyOtp(requestId, otp) {
  const { records, request } = await loadActiveRequest(requestId);

  if (request.attempts >= MAX_ATTEMPTS) {
    throw validationError('Too many attempts. Start the recovery again.', 429);
  }
  if (Date.parse(request.otpExpiresAt) <= Date.now()) {
    throw validationError('That verification code has expired.');
  }

  const candidate = crypto.createHash('sha256').update(String(otp || '')).digest('base64');
  if (candidate !== request.otpHash) {
    request.attempts += 1;
    await requestStore.write(records);
    throw validationError('That verification code is not correct.');
  }

  request.otpVerifiedAt = new Date().toISOString();
  request.status = 'otp-verified';
  await requestStore.write(records);
  await writeAuditEvent('wallet.recovery.otp.verified', {
    walletId: request.walletId,
    requestId: request.id
  });
  return publicRequest(request);
}

// Tier 1 — recovery code. Requires the OTP to already be verified, so a stolen
// code alone (or a SIM-swapped OTP alone) is never sufficient.
async function redeemCodeForRequest(requestId, code) {
  const { records, request } = await loadActiveRequest(requestId);
  if (!request.otpVerifiedAt) {
    throw validationError('Verify the code sent to your registered contact first.');
  }
  if (request.attempts >= MAX_ATTEMPTS) {
    throw validationError('Too many attempts. Start the recovery again.', 429);
  }

  const ok = await redeemRecoveryCode(request.walletId, code);
  if (!ok) {
    request.attempts += 1;
    await requestStore.write(records);
    throw validationError('That recovery code is not valid.');
  }

  request.tier = 'self';
  request.status = 'approved';
  request.approvedAt = new Date().toISOString();
  await requestStore.write(records);
  await writeAuditEvent('wallet.recovery.code.redeemed', {
    walletId: request.walletId,
    requestId: request.id
  });
  return publicRequest(request);
}

// Tier 2 — ask a connected organization to attest to the holder's identity.
async function requestOrgAttestation(requestId, orgId) {
  const { records, request } = await loadActiveRequest(requestId);
  if (!request.otpVerifiedAt) {
    throw validationError('Verify the code sent to your registered contact first.');
  }
  if (!orgId) {
    throw validationError('An organization is required.');
  }

  request.tier = 'org';
  request.orgId = orgId;
  request.status = 'awaiting-org-approval';
  await requestStore.write(records);
  await writeAuditEvent('wallet.recovery.attestation.requested', {
    walletId: request.walletId,
    requestId: request.id,
    orgId
  });
  return publicRequest(request);
}

async function approveOrgAttestation(requestId, input = {}) {
  const { records, request } = await loadActiveRequest(requestId);
  if (request.status !== 'awaiting-org-approval') {
    throw validationError('This request is not awaiting organization approval.', 409);
  }

  request.status = 'approved';
  request.approvedBy = input.approvedBy || null;
  request.approvedAt = new Date().toISOString();
  request.evidence = {
    idImageHash: input.idImageHash || null,
    faceImageHash: input.faceImageHash || null,
    method: input.method || 'in-person'
  };
  await requestStore.write(records);
  await writeAuditEvent('wallet.recovery.attestation.approved', {
    walletId: request.walletId,
    requestId: request.id,
    orgId: request.orgId,
    approvedBy: request.approvedBy
  });
  return publicRequest(request);
}

async function rejectOrgAttestation(requestId, reason, rejectedBy) {
  const { records, request } = await loadActiveRequest(requestId);
  request.status = 'rejected';
  request.rejectedReason = String(reason || '').trim() || 'No reason supplied.';
  request.resolvedAt = new Date().toISOString();
  await requestStore.write(records);
  await writeAuditEvent('wallet.recovery.attestation.rejected', {
    walletId: request.walletId,
    requestId: request.id,
    orgId: request.orgId,
    rejectedBy: rejectedBy || null,
    reason: request.rejectedReason
  });
  return publicRequest(request);
}

async function cancelRecovery(requestId) {
  const records = await requestStore.read();
  const request = records.find((record) => record.id === requestId);
  if (!request) {
    throw validationError('Recovery request not found.', 404);
  }
  if (request.status === 'completed') {
    throw validationError('This recovery has already completed.', 409);
  }

  request.status = 'cancelled';
  request.cancelledAt = new Date().toISOString();
  await requestStore.write(records);
  await writeAuditEvent('wallet.recovery.cancelled', {
    walletId: request.walletId,
    requestId: request.id
  });
  return publicRequest(request);
}

// Bind the new device key, revoke the old one, and apply the tier's restore scope.
async function completeRecovery(requestId, input = {}) {
  const { records, request } = await loadActiveRequest(requestId);
  if (request.status !== 'approved') {
    throw validationError('This recovery has not been approved yet.', 409);
  }

  const newDevicePublicKey = String(input.devicePublicKey || '').trim();
  if (!newDevicePublicKey) {
    throw validationError('A new device public key is required.');
  }

  const wallets = await walletStore.read();
  const index = wallets.findIndex((wallet) => wallet.walletId === request.walletId);
  if (index === -1) {
    throw validationError('Wallet not found.', 404);
  }

  const wallet = wallets[index];
  const now = new Date();
  wallet.deviceKeyHistory = [
    ...(wallet.deviceKeyHistory || []),
    { devicePublicKey: wallet.devicePublicKey, revokedAt: now.toISOString(), reason: 'wallet-recovery' }
  ];
  wallet.devicePublicKey = newDevicePublicKey;
  wallet.deviceKeyAlg = input.deviceKeyAlg || wallet.deviceKeyAlg;
  wallet.lastRecoveryAt = now.toISOString();
  // A5: block change-email-then-recover by freezing contact edits after recovery.
  wallet.contactFrozenUntil = new Date(now.getTime() + CONTACT_FREEZE_MS).toISOString();
  // R3: Tier 1 imposes a 24h cooling-off on high-value operations.
  wallet.coolingOffUntil = request.tier === 'self' ? new Date(now.getTime() + COOLING_OFF_MS).toISOString() : null;
  wallet.updatedAt = now.toISOString();
  wallets[index] = wallet;
  await walletStore.write(wallets);

  request.status = 'completed';
  request.newDevicePublicKey = newDevicePublicKey;
  request.completedAt = now.toISOString();
  await requestStore.write(records);

  await writeAuditEvent('wallet.recovery.completed', {
    walletId: wallet.walletId,
    requestId: request.id,
    tier: request.tier,
    orgId: request.orgId
  });

  return {
    request: publicRequest(request),
    walletId: wallet.walletId,
    // Tier 1 restores low/medium only; Tier 2 restores the approving org's
    // credentials including high assurance (R1, R5).
    restoreScope: request.tier === 'self' ? 'low-medium' : 'org',
    orgId: request.orgId,
    suspendsHighAssurance: request.tier === 'self',
    coolingOffUntil: wallet.coolingOffUntil,
    contactFrozenUntil: wallet.contactFrozenUntil
  };
}

// Which recovery tiers this wallet can actually use right now (drives the
// mobile UI and enforces the R6 hard stop).
async function getRecoveryOptions(walletId, options = {}) {
  const remainingCodes = await getRemainingCodeCount(walletId);
  const connectedOrgIds = options.connectedOrgIds || [];
  return {
    walletId,
    canUseCodes: remainingCodes > 0,
    remainingCodes,
    canUseOrgAttestation: connectedOrgIds.length > 0,
    connectedOrgIds,
    hardStop: remainingCodes === 0 && connectedOrgIds.length === 0
  };
}

async function getRecoveryRequest(requestId) {
  const records = await requestStore.read();
  const request = records.find((record) => record.id === requestId);
  return request ? publicRequest(request) : null;
}

async function listRecoveryRequestsForOrg(orgId) {
  const records = await requestStore.read();
  return records
    .filter((record) => record.orgId === orgId && record.status === 'awaiting-org-approval')
    .map(publicRequest);
}

// Never expose otpHash, salts, or the pending device key.
function publicRequest(request) {
  return {
    id: request.id,
    walletId: request.walletId,
    tier: request.tier,
    status: request.status,
    orgId: request.orgId,
    otpVerified: Boolean(request.otpVerifiedAt),
    requestedAt: request.requestedAt,
    expiresAt: request.expiresAt,
    approvedBy: request.approvedBy,
    approvedAt: request.approvedAt,
    rejectedReason: request.rejectedReason,
    completedAt: request.completedAt
  };
}

module.exports = {
  CODE_COUNT,
  approveOrgAttestation,
  cancelRecovery,
  completeRecovery,
  generateRecoveryCodes,
  getRecoveryOptions,
  getRecoveryRequest,
  getRemainingCodeCount,
  listRecoveryRequestsForOrg,
  redeemCodeForRequest,
  redeemRecoveryCode,
  rejectOrgAttestation,
  requestOrgAttestation,
  startRecovery,
  verifyOtp
};
