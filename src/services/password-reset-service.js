// Password recovery.
//
// Two rules shape everything here:
//
//   1. Never reveal whether an address has an account. Every request path
//      returns the same result, so the endpoint cannot be used to enumerate
//      users. That is why requestPasswordReset resolves successfully even when
//      no account matched.
//   2. Tokens are single-use and stored only as a hash, so a leaked store does
//      not hand over the ability to reset anyone's password.

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { deliverMessage } = require('./otp-delivery-service');
const { writeAuditEvent } = require('./audit-service');

const resetStore = new FileJsonStore(config.paths.passwordResets, []);
const userStore = new FileJsonStore(config.paths.users, []);

const TOKEN_TTL_MS = 30 * 60 * 1000;
const TOKEN_TTL_MINUTES = TOKEN_TTL_MS / 60000;

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

// scrypt with a per-token salt, matching how wallet recovery codes are stored.
function hashToken(plain, salt) {
  return crypto.scryptSync(plain, salt, 32).toString('base64');
}

function matchesToken(plain, record) {
  const candidate = Buffer.from(hashToken(plain, record.salt));
  const stored = Buffer.from(record.hash);
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

async function pruneExpired(records) {
  const now = Date.now();
  return records.filter((record) => !record.usedAt && new Date(record.expiresAt).getTime() > now);
}

/**
 * Start a reset. Always resolves the same way whether or not the address is
 * known — the caller must not branch on the result to tell the user anything
 * different.
 */
async function requestPasswordReset(emailInput, { baseUrl, context = {} } = {}) {
  const email = normalizeEmail(emailInput);
  const users = await userStore.read();
  const user = users.find((entry) => normalizeEmail(entry.email) === email);

  if (!user) {
    await writeAuditEvent('auth.password-reset.requested', {
      email,
      matched: false,
      ...context
    });
    return { requested: true };
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const salt = crypto.randomBytes(16).toString('base64');
  const now = new Date();

  const records = await pruneExpired(await resetStore.read());
  // Only the newest request for an account stays live, so an attacker cannot
  // farm a pile of valid tokens by asking repeatedly.
  const others = records.filter((record) => record.userId !== user.id);
  others.push({
    id: crypto.randomUUID(),
    userId: user.id,
    salt,
    hash: hashToken(token, salt),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS).toISOString(),
    usedAt: null
  });
  await resetStore.write(others);

  const resetUrl = `${String(baseUrl || config.app.publicBaseUrl).replace(/\/$/, '')}/auth/reset/${token}`;
  const delivery = await deliverMessage({
    type: 'password-reset',
    email: user.email,
    phone: user.phone,
    variables: { resetUrl, expiresInMinutes: TOKEN_TTL_MINUTES },
    context: { userId: user.id }
  });

  await writeAuditEvent('auth.password-reset.requested', {
    userId: user.id,
    email: user.email,
    matched: true,
    delivered: delivery.delivered,
    ...context
  });

  return { requested: true };
}

/** Resolve a token to its account, or null. Never throws on a bad token. */
async function resolveResetToken(token) {
  if (!token) {
    return null;
  }
  const records = await resetStore.read();
  const now = Date.now();
  const record = records.find(
    (entry) => !entry.usedAt && new Date(entry.expiresAt).getTime() > now && matchesToken(token, entry)
  );
  if (!record) {
    return null;
  }
  const users = await userStore.read();
  const user = users.find((entry) => entry.id === record.userId);
  return user ? { record, user } : null;
}

/**
 * Complete a reset. Consumes the token, sets the new password, and stamps
 * sessionsValidFrom so every session issued before now stops being accepted.
 */
async function completePasswordReset(token, newPassword, { context = {} } = {}) {
  const resolved = await resolveResetToken(token);
  if (!resolved) {
    const error = new Error('This reset link is no longer valid. Request a new one.');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const password = String(newPassword || '');
  if (password.length < 10) {
    const error = new Error('Use at least 10 characters.');
    error.status = 422;
    error.expose = true;
    throw error;
  }

  const now = new Date().toISOString();

  const records = await resetStore.read();
  const index = records.findIndex((entry) => entry.id === resolved.record.id);
  if (index === -1 || records[index].usedAt) {
    // Someone consumed it between resolve and write.
    const error = new Error('This reset link has already been used.');
    error.status = 400;
    error.expose = true;
    throw error;
  }
  records[index].usedAt = now;
  await resetStore.write(records);

  const users = await userStore.read();
  const userIndex = users.findIndex((entry) => entry.id === resolved.user.id);
  users[userIndex].passwordHash = await bcrypt.hash(password, 12);
  users[userIndex].updatedAt = now;
  // Existing sessions were established before the password changed, and the
  // whole point of a reset is that the previous holder loses access.
  users[userIndex].sessionsValidFrom = now;
  users[userIndex].pendingSecondFactor = null;
  await userStore.write(users);

  await writeAuditEvent('auth.password-reset.completed', {
    userId: resolved.user.id,
    email: resolved.user.email,
    ...context
  });

  return { email: resolved.user.email };
}

module.exports = {
  TOKEN_TTL_MINUTES,
  completePasswordReset,
  requestPasswordReset,
  resolveResetToken
};
