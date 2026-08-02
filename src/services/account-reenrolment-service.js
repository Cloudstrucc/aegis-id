// Getting a locked-out passwordless account back on its feet.
//
// When someone has lost their authenticator and spent every recovery code,
// self-service is deliberately over — that hard stop is what stops an endless
// chain of ever-weaker fallbacks. An administrator verifies who they are out of
// band, then grants a one-time re-enrolment.
//
// The administrator never sees a credential. They authorise a time-boxed grant;
// the link goes to the account's own address, and the holder registers a new
// passkey and receives a fresh set of codes themselves. An admin who could read
// the codes could sign in as the user, which would make every passwordless
// account only as strong as its administrator.

const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { deliverMessage } = require('./otp-delivery-service');
const { writeAuditEvent } = require('./audit-service');
const { getRemainingAccountCodeCount } = require('./account-recovery-service');

const grantStore = new FileJsonStore(config.paths.accountReenrolmentGrants, []);
const userStore = new FileJsonStore(config.paths.users, []);

const GRANT_TTL_MS = 60 * 60 * 1000;
const GRANT_TTL_MINUTES = GRANT_TTL_MS / 60000;

function hashToken(plain, salt) {
  return crypto.scryptSync(plain, salt, 32).toString('base64');
}

function matchesToken(plain, record) {
  const candidate = Buffer.from(hashToken(plain, record.salt));
  const stored = Buffer.from(record.hash);
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

/**
 * Every passwordless account with how many codes it has left, so an admin can
 * see who is locked out before someone has to phone in.
 */
async function listPasswordlessAccounts() {
  const users = await userStore.read();
  const grants = await grantStore.read();
  const now = Date.now();

  const accounts = await Promise.all(
    users
      .filter((user) => user.passwordless || !user.passwordHash)
      .map(async (user) => {
        const remaining = await getRemainingAccountCodeCount(user.id);
        const activeGrant = grants.find(
          (grant) =>
            grant.userId === user.id && !grant.usedAt && new Date(grant.expiresAt).getTime() > now
        );
        return {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          passkeyCount: user.passkeys?.length || 0,
          emailVerifiedAt: user.emailVerifiedAt || null,
          remainingCodes: remaining,
          lockedOut: remaining === 0,
          grantPending: Boolean(activeGrant),
          grantExpiresAt: activeGrant?.expiresAt || null,
          createdAt: user.createdAt
        };
      })
  );

  // Locked-out accounts first: they are the reason anyone opens this page.
  return accounts.sort((left, right) => {
    if (left.lockedOut !== right.lockedOut) {
      return left.lockedOut ? -1 : 1;
    }
    return left.remainingCodes - right.remainingCodes;
  });
}

/**
 * Authorise one re-enrolment. Returns only whether the link was delivered — the
 * token itself goes to the account holder and nowhere else.
 */
async function grantReenrolment(userId, { actorEmail, baseUrl, reason } = {}) {
  const users = await userStore.read();
  const user = users.find((entry) => entry.id === userId);
  if (!user) {
    const error = new Error('Account not found.');
    error.status = 404;
    error.expose = true;
    throw error;
  }
  if (user.passwordHash) {
    const error = new Error('This account has a password, so it can use the reset link instead.');
    error.status = 422;
    error.expose = true;
    throw error;
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const salt = crypto.randomBytes(16).toString('base64');
  const now = new Date();

  // One live grant per account, so authorising twice cannot leave two usable
  // links outstanding.
  const grants = (await grantStore.read()).filter(
    (grant) => grant.userId !== userId && new Date(grant.expiresAt).getTime() > now.getTime()
  );
  grants.push({
    id: crypto.randomUUID(),
    userId,
    salt,
    hash: hashToken(token, salt),
    grantedBy: actorEmail || null,
    reason: String(reason || '').slice(0, 300),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + GRANT_TTL_MS).toISOString(),
    usedAt: null
  });
  await grantStore.write(grants);

  const reenrolUrl = `${String(baseUrl || config.app.publicBaseUrl).replace(/\/$/, '')}/auth/reenrol/${token}`;
  const delivery = await deliverMessage({
    type: 'account-reenrolment',
    email: user.email,
    variables: { reenrolUrl, expiresInMinutes: GRANT_TTL_MINUTES, displayName: user.displayName },
    context: { userId }
  });

  await writeAuditEvent('auth.account.reenrolment.granted', {
    userId,
    email: user.email,
    grantedBy: actorEmail || null,
    reason: String(reason || '').slice(0, 300),
    delivered: delivery.delivered
  });

  return { delivered: delivery.delivered };
}

/** Resolve a grant token to its account, or null. Never throws on a bad token. */
async function resolveGrant(token) {
  if (!token) {
    return null;
  }
  const grants = await grantStore.read();
  const now = Date.now();
  const grant = grants.find(
    (record) => !record.usedAt && new Date(record.expiresAt).getTime() > now && matchesToken(token, record)
  );
  if (!grant) {
    return null;
  }
  const users = await userStore.read();
  const user = users.find((entry) => entry.id === grant.userId);
  return user ? { grant, user } : null;
}

/** Spend the grant. Called once the new credential is registered. */
async function consumeGrant(grantId) {
  const grants = await grantStore.read();
  const index = grants.findIndex((grant) => grant.id === grantId);
  if (index === -1 || grants[index].usedAt) {
    return false;
  }
  grants[index].usedAt = new Date().toISOString();
  await grantStore.write(grants);
  return true;
}

module.exports = {
  GRANT_TTL_MINUTES,
  consumeGrant,
  grantReenrolment,
  listPasswordlessAccounts,
  resolveGrant
};
