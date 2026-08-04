// Registration codes: a way to obtain a paid plan without paying.
//
// These exist so dev and qa testers can sign up without a card, and so a pilot
// customer can be comped without a finance conversation. That makes them worth
// real money, so they are treated like a credential rather than a coupon:
//
//   * stored only as a hash, so a leaked store cannot be redeemed
//   * scoped to an environment, so a dev code cannot be used against prod
//   * single or limited use, with an expiry
//   * every issue and redemption on the evidence chain
//
// A redeemed code sets billingStatus to 'comped', which the plan service treats
// as good standing — the same as a paying customer, and equally revocable.

const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { writeAuditEvent } = require('./audit-service');
const { isKnownPlan, resolvePlan } = require('./plan-service');

const store = new FileJsonStore(config.paths.registrationCodes, []);

// Unambiguous alphabet: no I, L, O, U, so a code read aloud or off a screen
// cannot be mistyped into a different valid code.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUP = 4;
const GROUPS = 3;

function randomGroup() {
  let out = '';
  for (let index = 0; index < GROUP; index += 1) {
    out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return out;
}

function generatePlainCode() {
  return Array.from({ length: GROUPS }, randomGroup).join('-');
}

function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[\s-]/g, '');
}

function hashCode(plain, salt) {
  return crypto.scryptSync(normalizeCode(plain), salt, 32).toString('base64');
}

function matches(plain, record) {
  const candidate = Buffer.from(hashCode(plain, record.salt));
  const stored = Buffer.from(record.hash);
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

function validationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

/** Which environment this deployment is, for scoping. */
function currentEnvironment() {
  return String(config.app.deployEnv || 'local').toLowerCase();
}

/**
 * Mint a code. The plaintext is returned once and never stored, so an
 * administrator who loses it must issue another.
 */
async function createRegistrationCode({
  planId,
  environments,
  maxRedemptions = 1,
  expiresInDays = 30,
  note,
  actorEmail
} = {}) {
  if (!isKnownPlan(planId)) {
    throw validationError('Choose a plan for this code.');
  }
  // A code exists to bypass payment, so a plan with nothing to pay has no code
  // to issue — anyone can start a trial without one.
  if (!resolvePlan(planId).requiresPayment) {
    throw validationError('That plan is free, so it needs no code.');
  }

  const scoped = (Array.isArray(environments) ? environments : [environments])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  if (scoped.length === 0) {
    throw validationError('Choose at least one environment this code may be used in.');
  }
  // Deliberate: a code good on prod is a free paid subscription, so it has to
  // be asked for explicitly rather than arrived at by leaving a field blank.
  if (scoped.includes('all')) {
    throw validationError('Name each environment explicitly rather than using "all".');
  }

  const redemptions = Number.parseInt(maxRedemptions, 10);
  if (!Number.isFinite(redemptions) || redemptions < 1 || redemptions > 500) {
    throw validationError('A code may be redeemed between 1 and 500 times.');
  }

  const days = Number.parseInt(expiresInDays, 10);
  if (!Number.isFinite(days) || days < 1 || days > 365) {
    throw validationError('A code may last between 1 and 365 days.');
  }

  const plain = generatePlainCode();
  const salt = crypto.randomBytes(16).toString('base64');
  const now = new Date();

  const record = {
    id: crypto.randomUUID(),
    salt,
    hash: hashCode(plain, salt),
    // A non-secret fragment so an admin can tell codes apart in a list without
    // the list being enough to redeem one.
    hint: plain.slice(0, GROUP),
    planId,
    environments: scoped,
    maxRedemptions: redemptions,
    redemptions: [],
    note: String(note || '').slice(0, 300),
    createdBy: actorEmail || null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
    revokedAt: null
  };

  const records = await store.read();
  records.unshift(record);
  await store.write(records);

  await writeAuditEvent('subscription.code.issued', {
    codeId: record.id,
    hint: record.hint,
    planId,
    environments: scoped,
    maxRedemptions: redemptions,
    expiresAt: record.expiresAt,
    createdBy: actorEmail || null,
    note: record.note
  });

  return { code: plain, record: publicView(record) };
}

function isSpent(record) {
  return record.redemptions.length >= record.maxRedemptions;
}

function isExpired(record, now = Date.now()) {
  return new Date(record.expiresAt).getTime() <= now;
}

function publicView(record) {
  return {
    id: record.id,
    hint: record.hint,
    planId: record.planId,
    planLabel: resolvePlan(record.planId).label,
    environments: record.environments,
    maxRedemptions: record.maxRedemptions,
    redemptionCount: record.redemptions.length,
    remaining: Math.max(0, record.maxRedemptions - record.redemptions.length),
    note: record.note,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    isSpent: isSpent(record),
    isExpired: isExpired(record),
    isRevoked: Boolean(record.revokedAt),
    isUsable: !isSpent(record) && !isExpired(record) && !record.revokedAt
  };
}

async function listRegistrationCodes() {
  const records = await store.read();
  return records.map(publicView);
}

/**
 * Check a code without spending it, so the signup form can tell someone their
 * code is wrong before they fill in the rest of it.
 *
 * Deliberately gives one message for every failure. Distinguishing "expired"
 * from "wrong" would let someone probe for codes that exist.
 */
async function previewRegistrationCode(candidate) {
  const records = await store.read();
  const environment = currentEnvironment();
  const record = records.find((entry) => matches(candidate, entry));

  if (!record || !record.environments.includes(environment) || !publicView(record).isUsable) {
    return null;
  }
  return { planId: record.planId, plan: resolvePlan(record.planId) };
}

/**
 * Spend a redemption. Returns the plan it grants.
 *
 * The environment check is the important one: a code minted for dev is
 * worthless against prod, so leaking the dev codes cannot cost real revenue.
 */
async function redeemRegistrationCode(candidate, { email, actorEmail } = {}) {
  const records = await store.read();
  const environment = currentEnvironment();
  const index = records.findIndex((entry) => matches(candidate, entry));

  const refuse = async (reason) => {
    await writeAuditEvent('subscription.code.rejected', {
      environment,
      reason,
      email: email || null
    });
    // One message for every failure, so this cannot be used to discover which
    // codes exist or which environments they belong to.
    throw validationError('That registration code is not valid.');
  };

  if (index === -1) {
    return refuse('unknown');
  }

  const record = records[index];
  if (!record.environments.includes(environment)) {
    return refuse('wrong-environment');
  }
  if (record.revokedAt) {
    return refuse('revoked');
  }
  if (isExpired(record)) {
    return refuse('expired');
  }
  if (isSpent(record)) {
    return refuse('spent');
  }

  record.redemptions.push({
    at: new Date().toISOString(),
    email: email || null,
    environment
  });
  await store.write(records);

  await writeAuditEvent('subscription.code.redeemed', {
    codeId: record.id,
    hint: record.hint,
    planId: record.planId,
    environment,
    email: email || null,
    remaining: Math.max(0, record.maxRedemptions - record.redemptions.length)
  });

  return { planId: record.planId, plan: resolvePlan(record.planId) };
}

/** Stop a code being redeemed again, without erasing what it already granted. */
async function revokeRegistrationCode(codeId, { actorEmail } = {}) {
  const records = await store.read();
  const index = records.findIndex((entry) => entry.id === codeId);
  if (index === -1) {
    throw validationError('Registration code not found.', 404);
  }

  records[index].revokedAt = new Date().toISOString();
  await store.write(records);

  await writeAuditEvent('subscription.code.revoked', {
    codeId,
    hint: records[index].hint,
    revokedBy: actorEmail || null
  });

  return publicView(records[index]);
}

module.exports = {
  createRegistrationCode,
  currentEnvironment,
  listRegistrationCodes,
  previewRegistrationCode,
  redeemRegistrationCode,
  revokeRegistrationCode
};
