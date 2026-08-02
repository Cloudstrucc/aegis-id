// Wallet registry — the authoritative record of registered wallets (plan §4.2).
//
// A wallet record binds a Wallet ID to a device public key and the holder's
// globally-registered contact details. Credential invites resolve to a wallet
// through one of three binding modes (plan §3.2):
//
//   mode 1 "wallet-id" — invite carries a Wallet ID (strongest). The credential's
//                        email may be any per-org address.
//   mode 2 "email"     — no Wallet ID; the invite email must equal the email the
//                        holder registered on their wallet.
//   mode 3 "phone"     — no Wallet ID; the invite phone must equal the registered
//                        phone.

const crypto = require('node:crypto');
const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { generateWalletId, parseWalletId } = require('./wallet-id');
const { writeAuditEvent } = require('./audit-service');

const store = new FileJsonStore(config.paths.wallets, []);

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase() || null;
}

// Normalize to E.164 so lookups are deterministic regardless of how the number
// was typed. Defaults to +1 (North America) for bare 10-digit numbers.
function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (!digits) {
    return null;
  }
  if (hasPlus) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  error.expose = true;
  return error;
}

async function registerWallet(input = {}) {
  const email = normalizeEmail(input.email);
  if (!email) {
    throw validationError('A wallet email is required.');
  }

  const phone = normalizePhone(input.phone);
  const devicePublicKey = String(input.devicePublicKey || '').trim();
  if (!devicePublicKey) {
    throw validationError('A device public key is required.');
  }

  const records = await store.read();

  // Re-registering the same device is idempotent — it returns the existing
  // wallet rather than minting a second Wallet ID for the same device.
  const existing = records.find((record) => record.devicePublicKey === devicePublicKey);
  if (existing) {
    return existing;
  }

  if (records.some((record) => record.email === email)) {
    throw validationError('A wallet is already registered with this email.');
  }
  if (phone && records.some((record) => record.phone === phone)) {
    throw validationError('A wallet is already registered with this phone number.');
  }

  const now = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    walletId: await mintUniqueWalletId(records),
    devicePublicKey,
    deviceKeyAlg: String(input.deviceKeyAlg || 'ES256'),
    deviceKeyHistory: [],
    email,
    phone,
    displayName: String(input.displayName || '').trim() || null,
    status: 'active',
    contactFrozenUntil: null,
    lastRecoveryAt: null,
    createdAt: now,
    updatedAt: now
  };

  records.unshift(record);
  await store.write(records);
  return record;
}

async function mintUniqueWalletId(records) {
  const taken = new Set(records.map((record) => record.walletId));
  for (;;) {
    const candidate = generateWalletId();
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

async function getWalletByWalletId(value) {
  const walletId = parseWalletId(value);
  if (!walletId) {
    return null;
  }
  const records = await store.read();
  return records.find((record) => record.walletId === walletId) || null;
}

async function getWalletByEmail(value) {
  const email = normalizeEmail(value);
  if (!email) {
    return null;
  }
  const records = await store.read();
  return records.find((record) => record.email === email) || null;
}

async function getWalletByPhone(value) {
  const phone = normalizePhone(value);
  if (!phone) {
    return null;
  }
  const records = await store.read();
  return records.find((record) => record.phone === phone) || null;
}

// Determine which binding mode a credential uses and resolve the wallet it is
// bound to. Returns { mode, wallet } — wallet is null when nothing matches.
async function resolveWalletForCredential(credential = {}) {
  // Honour the mode chosen at issue time when it is recorded, so a phone-only
  // invite is not re-resolved against a defaulted email claim.
  switch (credential.bindingMode) {
    case 'wallet-id':
      return { mode: 'wallet-id', wallet: await getWalletByWalletId(credential.walletId) };
    case 'email':
      return { mode: 'email', wallet: await getWalletByEmail(credential.holderEmail) };
    case 'phone':
      return { mode: 'phone', wallet: await getWalletByPhone(credential.holderPhone) };
    default:
      break;
  }

  if (credential.walletId) {
    return { mode: 'wallet-id', wallet: await getWalletByWalletId(credential.walletId) };
  }
  if (credential.holderEmail) {
    return { mode: 'email', wallet: await getWalletByEmail(credential.holderEmail) };
  }
  if (credential.holderPhone) {
    return { mode: 'phone', wallet: await getWalletByPhone(credential.holderPhone) };
  }
  return { mode: null, wallet: null };
}

// Authoritative server-side binding check performed when a wallet accepts a
// credential invitation.
async function assertBinding(credential = {}, presentedWalletId) {
  const presented = parseWalletId(presentedWalletId);
  if (!presented) {
    throw validationError('A valid Wallet ID is required to accept this invitation.');
  }

  const wallet = await getWalletByWalletId(presented);
  if (!wallet) {
    throw validationError('This wallet is not registered.');
  }
  if (wallet.status === 'revoked') {
    // Enforced here rather than only in the UI: this is the path every
    // credential acceptance goes through.
    throw validationError('This wallet has been withdrawn from service. Contact your administrator.');
  }

  const { mode, wallet: bound } = await resolveWalletForCredential(credential);
  if (!mode) {
    throw validationError('This invitation has no wallet binding.');
  }
  if (!bound) {
    // Modes 2/3 require the invite contact to belong to a registered wallet.
    throw validationError(
      mode === 'wallet-id'
        ? 'The Wallet ID on this invitation is not registered.'
        : 'This invitation was not addressed to a registered wallet contact.'
    );
  }
  if (bound.walletId !== wallet.walletId) {
    throw validationError('This invitation is for a different wallet.');
  }

  return { mode, wallet };
}

async function updateWalletContact(walletId, changes = {}) {
  const records = await store.read();
  const index = records.findIndex((record) => record.walletId === parseWalletId(walletId));
  if (index === -1) {
    throw validationError('Wallet not found.');
  }

  const record = records[index];
  if (record.contactFrozenUntil && Date.parse(record.contactFrozenUntil) > Date.now()) {
    const error = new Error('Contact changes are temporarily frozen after a wallet recovery.');
    error.status = 423;
    error.expose = true;
    throw error;
  }

  const email = changes.email === undefined ? record.email : normalizeEmail(changes.email);
  const phone = changes.phone === undefined ? record.phone : normalizePhone(changes.phone);

  if (email !== record.email && records.some((other) => other !== record && other.email === email)) {
    throw validationError('Another wallet is already registered with this email.');
  }
  if (phone && phone !== record.phone && records.some((other) => other !== record && other.phone === phone)) {
    throw validationError('Another wallet is already registered with this phone number.');
  }

  records[index] = { ...record, email, phone, updatedAt: new Date().toISOString() };
  await store.write(records);
  return records[index];
}

async function listWallets() {
  return store.read();
}


/**
 * Withdraw a wallet from service without erasing it.
 *
 * The record and its history stay, so the evidence chain still explains what
 * that wallet did — it simply stops being usable. This is the right answer for
 * a lost or compromised wallet: deleting it would destroy the very trail you
 * would want afterwards.
 */
async function revokeWallet(walletId, { actorEmail, reason } = {}) {
  const parsed = parseWalletId(walletId);
  const records = await store.read();
  const index = records.findIndex((record) => record.walletId === parsed);
  if (index === -1) {
    throw validationError('Wallet not found.', 404);
  }
  if (records[index].status === 'revoked') {
    return records[index];
  }

  const now = new Date().toISOString();
  records[index] = {
    ...records[index],
    status: 'revoked',
    revokedAt: now,
    revokedBy: actorEmail || null,
    revokedReason: String(reason || '').slice(0, 300),
    updatedAt: now
  };
  await store.write(records);

  await writeAuditEvent('wallet.revoked', {
    walletId: records[index].walletId,
    revokedBy: actorEmail || null,
    reason: records[index].revokedReason
  });

  return records[index];
}

/** Put a revoked wallet back into service. */
async function restoreWallet(walletId, { actorEmail } = {}) {
  const parsed = parseWalletId(walletId);
  const records = await store.read();
  const index = records.findIndex((record) => record.walletId === parsed);
  if (index === -1) {
    throw validationError('Wallet not found.', 404);
  }

  const now = new Date().toISOString();
  records[index] = {
    ...records[index],
    status: 'active',
    revokedAt: null,
    revokedBy: null,
    revokedReason: '',
    updatedAt: now
  };
  await store.write(records);

  await writeAuditEvent('wallet.restored', {
    walletId: records[index].walletId,
    restoredBy: actorEmail || null
  });

  return records[index];
}

/**
 * Erase a wallet outright.
 *
 * Only allowed for a wallet that never did anything — no credential ever bound
 * to it. That covers the case this exists for, clearing out test wallets, while
 * making it impossible to delete away a wallet whose history someone may later
 * need to account for. Anything that has been used must be revoked instead.
 */
async function deleteWallet(walletId, { actorEmail, reason, usageCount = 0 } = {}) {
  const parsed = parseWalletId(walletId);
  const records = await store.read();
  const index = records.findIndex((record) => record.walletId === parsed);
  if (index === -1) {
    throw validationError('Wallet not found.', 404);
  }

  if (usageCount > 0) {
    const error = new Error(
      'This wallet holds credentials, so it cannot be deleted. Revoke it instead — that stops it being used while keeping its history.'
    );
    error.status = 409;
    error.expose = true;
    throw error;
  }

  const removed = records[index];
  records.splice(index, 1);
  await store.write(records);

  await writeAuditEvent('wallet.deleted', {
    walletId: removed.walletId,
    email: removed.email,
    deletedBy: actorEmail || null,
    reason: String(reason || '').slice(0, 300)
  });

  return removed;
}

module.exports = {
  assertBinding,
  deleteWallet,
  restoreWallet,
  revokeWallet,
  getWalletByEmail,
  getWalletByPhone,
  getWalletByWalletId,
  listWallets,
  normalizeEmail,
  normalizePhone,
  registerWallet,
  resolveWalletForCredential,
  updateWalletContact
};
