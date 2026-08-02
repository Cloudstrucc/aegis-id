// Recovery codes for accounts that have no password.
//
// A password account can always fall back to an emailed reset link. A
// passkey-only account cannot: there is nothing to reset, so losing the
// authenticator would mean losing the account. These codes are that fallback.
//
// Same shape as wallet recovery: ten single-use codes, scrypt-hashed with a
// per-code salt, shown once at enrolment and never recoverable afterwards.

const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { writeAuditEvent } = require('./audit-service');

const store = new FileJsonStore(config.paths.accountRecoveryCodes, []);

const CODE_COUNT = 10;
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'; // unambiguous

function randomGroup(length) {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

function generatePlainCode() {
  return `${randomGroup(4)}-${randomGroup(4)}`;
}

function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[\s-]/g, '');
}

function hashCode(plain, salt) {
  return crypto.scryptSync(normalizeCode(plain), salt, 32).toString('base64');
}

/**
 * Mint a fresh set, replacing any existing one. Returns the plaintext codes —
 * the only time they exist outside the caller's screen.
 */
async function generateAccountRecoveryCodes(userId) {
  const plainCodes = Array.from({ length: CODE_COUNT }, generatePlainCode);
  const record = {
    userId,
    codes: plainCodes.map((plain, index) => {
      const salt = crypto.randomBytes(16).toString('base64');
      return { index, salt, hash: hashCode(plain, salt), usedAt: null };
    }),
    generatedAt: new Date().toISOString()
  };

  const records = await store.read();
  const existing = records.findIndex((entry) => entry.userId === userId);
  if (existing === -1) {
    records.push(record);
  } else {
    records[existing] = record;
  }
  await store.write(records);

  await writeAuditEvent('auth.account.recovery-codes.generated', {
    userId,
    count: CODE_COUNT
  });

  return plainCodes;
}

/**
 * Spend one code. Single use: a redeemed code is marked and can never match
 * again, so a code read over someone's shoulder is worth one attempt at most.
 */
async function redeemAccountRecoveryCode(userId, candidate) {
  const normalized = normalizeCode(candidate);
  if (!normalized) {
    return false;
  }

  const records = await store.read();
  const index = records.findIndex((entry) => entry.userId === userId);
  if (index === -1) {
    return false;
  }

  const record = records[index];
  for (const code of record.codes) {
    if (code.usedAt) {
      continue;
    }
    const attempt = Buffer.from(hashCode(normalized, code.salt));
    const stored = Buffer.from(code.hash);
    if (attempt.length === stored.length && crypto.timingSafeEqual(attempt, stored)) {
      code.usedAt = new Date().toISOString();
      await store.write(records);
      await writeAuditEvent('auth.account.recovery-code.redeemed', {
        userId,
        remaining: record.codes.filter((entry) => !entry.usedAt).length
      });
      return true;
    }
  }

  await writeAuditEvent('auth.account.recovery-code.rejected', { userId });
  return false;
}

async function getRemainingAccountCodeCount(userId) {
  const records = await store.read();
  const record = records.find((entry) => entry.userId === userId);
  return record ? record.codes.filter((entry) => !entry.usedAt).length : 0;
}

module.exports = {
  CODE_COUNT,
  generateAccountRecoveryCodes,
  getRemainingAccountCodeCount,
  redeemAccountRecoveryCode
};
