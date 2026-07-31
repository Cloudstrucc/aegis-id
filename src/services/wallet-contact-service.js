// Challenge-gated wallet contact changes (plan Issue G / §4.3).
//
// The holder's global wallet email and phone are what email/SMS-bound credential
// invites match against, so changing them must not be a plain form submit. A
// change is staged as a challenge, approved in the wallet, and only then applied.
// This is also what blocks the "change the email, then recover the wallet"
// takeover path.

const crypto = require('node:crypto');
const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { getWalletByWalletId, normalizeEmail, normalizePhone, updateWalletContact } = require('./wallet-registry-service');
const { writeAuditEvent } = require('./audit-service');

const store = new FileJsonStore(config.paths.walletContactChallenges, []);

const CHALLENGE_TTL_MS = 15 * 60 * 1000;

function validationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function isExpired(challenge) {
  return Date.parse(challenge.expiresAt) <= Date.now();
}

async function startContactChange(walletId, input = {}) {
  const wallet = await getWalletByWalletId(walletId);
  if (!wallet) {
    throw validationError('Wallet not found.', 404);
  }
  if (wallet.contactFrozenUntil && Date.parse(wallet.contactFrozenUntil) > Date.now()) {
    throw validationError('Contact changes are temporarily frozen after a wallet recovery.', 423);
  }

  const field = input.field === 'phone' ? 'phone' : input.field === 'email' ? 'email' : null;
  if (!field) {
    throw validationError('field must be "email" or "phone".');
  }

  const value = field === 'email' ? normalizeEmail(input.value) : normalizePhone(input.value);
  if (!value) {
    throw validationError(`A new ${field} is required.`);
  }
  if (value === wallet[field]) {
    throw validationError(`That is already the ${field} on this wallet.`);
  }

  const now = new Date();
  const challenge = {
    id: crypto.randomUUID(),
    walletId: wallet.walletId,
    field,
    value,
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
    resolvedAt: null
  };

  const records = await store.read();
  records.unshift(challenge);
  await store.write(records);

  await writeAuditEvent('wallet.contact.change.requested', {
    walletId: wallet.walletId,
    challengeId: challenge.id,
    field
  });

  return publicChallenge(challenge);
}

async function resolveContactChange(challengeId, input = {}) {
  const records = await store.read();
  const index = records.findIndex((record) => record.id === challengeId);
  if (index === -1) {
    throw validationError('Contact change challenge not found.', 404);
  }

  const challenge = records[index];
  if (challenge.status !== 'pending') {
    throw validationError('This challenge has already been resolved.', 409);
  }
  if (isExpired(challenge)) {
    challenge.status = 'expired';
    challenge.resolvedAt = new Date().toISOString();
    await store.write(records);
    throw validationError('This challenge has expired. Start the change again.');
  }

  const approved = input.decision === 'approve';
  challenge.status = approved ? 'approved' : 'declined';
  challenge.resolvedAt = new Date().toISOString();
  await store.write(records);

  if (!approved) {
    await writeAuditEvent('wallet.contact.change.declined', {
      walletId: challenge.walletId,
      challengeId: challenge.id,
      field: challenge.field
    });
    return publicChallenge(challenge);
  }

  // Only an approved challenge mutates the wallet.
  await updateWalletContact(challenge.walletId, { [challenge.field]: challenge.value });
  await writeAuditEvent('wallet.contact.changed', {
    walletId: challenge.walletId,
    challengeId: challenge.id,
    field: challenge.field
  });

  return publicChallenge(challenge);
}

async function getContactChange(challengeId) {
  const records = await store.read();
  const challenge = records.find((record) => record.id === challengeId);
  return challenge ? publicChallenge(challenge) : null;
}

async function listContactChanges(walletId) {
  const records = await store.read();
  return records.filter((record) => record.walletId === walletId).map(publicChallenge);
}

// Never echo the pending value back before approval.
function publicChallenge(challenge) {
  return {
    id: challenge.id,
    walletId: challenge.walletId,
    field: challenge.field,
    status: challenge.status,
    createdAt: challenge.createdAt,
    expiresAt: challenge.expiresAt,
    resolvedAt: challenge.resolvedAt
  };
}

module.exports = {
  getContactChange,
  listContactChanges,
  resolveContactChange,
  startContactChange
};
