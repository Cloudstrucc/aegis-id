// Email verification.
//
// With a password, registering proves someone chose a secret. With a passkey
// alone it proves nothing about the address — anyone could enrol a credential
// against someone else's email. So a passwordless account has to prove it
// controls the address before it can be used.
//
// Tokens are single-use and stored only as a hash, like password resets.

const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { deliverMessage } = require('./otp-delivery-service');
const { writeAuditEvent } = require('./audit-service');

const store = new FileJsonStore(config.paths.emailVerifications, []);
const userStore = new FileJsonStore(config.paths.users, []);

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_TTL_HOURS = TOKEN_TTL_MS / 3600000;

function hashToken(plain, salt) {
  return crypto.scryptSync(plain, salt, 32).toString('base64');
}

function matchesToken(plain, record) {
  const candidate = Buffer.from(hashToken(plain, record.salt));
  const stored = Buffer.from(record.hash);
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

/** Issue a verification link and send it. Replaces any outstanding one. */
async function sendVerificationEmail(user, { baseUrl } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const salt = crypto.randomBytes(16).toString('base64');
  const now = new Date();

  const records = (await store.read()).filter(
    (record) => record.userId !== user.id && new Date(record.expiresAt).getTime() > now.getTime()
  );
  records.push({
    id: crypto.randomUUID(),
    userId: user.id,
    salt,
    hash: hashToken(token, salt),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS).toISOString(),
    usedAt: null
  });
  await store.write(records);

  const verifyUrl = `${String(baseUrl || config.app.publicBaseUrl).replace(/\/$/, '')}/auth/verify-email/${token}`;
  const delivery = await deliverMessage({
    type: 'email-verification',
    email: user.email,
    variables: { verifyUrl, expiresInHours: TOKEN_TTL_HOURS, displayName: user.displayName },
    context: { userId: user.id }
  });

  await writeAuditEvent('auth.email.verification.sent', {
    userId: user.id,
    email: user.email,
    delivered: delivery.delivered
  });

  return { delivered: delivery.delivered };
}

/** Consume a token and mark the account verified. */
async function confirmVerificationToken(token) {
  if (!token) {
    return null;
  }

  const records = await store.read();
  const now = Date.now();
  const index = records.findIndex(
    (record) => !record.usedAt && new Date(record.expiresAt).getTime() > now && matchesToken(token, record)
  );
  if (index === -1) {
    return null;
  }

  const record = records[index];
  records[index].usedAt = new Date().toISOString();
  await store.write(records);

  const users = await userStore.read();
  const userIndex = users.findIndex((entry) => entry.id === record.userId);
  if (userIndex === -1) {
    return null;
  }
  users[userIndex].emailVerifiedAt = new Date().toISOString();
  users[userIndex].updatedAt = new Date().toISOString();
  await userStore.write(users);

  await writeAuditEvent('auth.email.verified', {
    userId: users[userIndex].id,
    email: users[userIndex].email
  });

  return { userId: users[userIndex].id, email: users[userIndex].email };
}

module.exports = {
  TOKEN_TTL_HOURS,
  confirmVerificationToken,
  sendVerificationEmail
};
