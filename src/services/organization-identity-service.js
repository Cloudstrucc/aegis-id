// Who an organization actually is, as distinct from what it calls itself.
//
// The display name is free text and always will be: two unrelated companies
// genuinely share names, and making names globally unique would just hand the
// first person to type "Microsoft" a permanent claim on it. So the name stays a
// label, and identity lives in two other things:
//
//   * a **handle** — `contoso-a7f3`, assigned at creation, globally unique,
//     never reused. Every organization has one from the moment it exists.
//   * an optional **verified domain** — `contoso.com`, proven by publishing a
//     TXT record only someone who controls the domain's DNS could publish.
//
// A holder looking at a credential invitation can then tell a real Contoso from
// somebody who typed the same eight letters, which is the whole point: without
// this, the name on an invitation is worth exactly nothing.

const crypto = require('node:crypto');
const dns = require('node:dns/promises');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { writeAuditEvent } = require('./audit-service');
const { consume } = require('./rate-limit-service');

const store = new FileJsonStore(config.paths.organizationIdentities, []);

const TXT_PREFIX = 'aegis-domain-verification=';
const TOKEN_BYTES = 24;
const CHALLENGE_TTL_DAYS = 14;

// Crockford-ish: no vowels, so a generated handle cannot accidentally spell
// something, and no characters that are hard to read aloud.
const SUFFIX_ALPHABET = '23456789bcdfghjkmnpqrstvwxz';
const SUFFIX_LENGTH = 4;

function validationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

/** A URL-safe stem from whatever the customer called their organization. */
function slugify(name) {
  const slug = String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'org';
}

function randomSuffix() {
  let out = '';
  for (let index = 0; index < SUFFIX_LENGTH; index += 1) {
    out += SUFFIX_ALPHABET[crypto.randomInt(SUFFIX_ALPHABET.length)];
  }
  return out;
}

/**
 * Normalise a claimed domain.
 *
 * Deliberately strict. A domain is about to become the thing holders trust, so
 * anything ambiguous — a scheme, a path, a port, a trailing dot, an empty
 * label — is refused rather than guessed at.
 */
function normalizeDomain(value) {
  let candidate = String(value || '').trim().toLowerCase();
  if (!candidate) {
    return null;
  }

  candidate = candidate.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  candidate = candidate.split('/')[0].split('?')[0].split('#')[0];
  candidate = candidate.split('@').pop();
  candidate = candidate.replace(/:\d+$/, '');
  candidate = candidate.replace(/\.$/, '');

  if (candidate.length > 253 || !candidate.includes('.')) {
    return null;
  }
  // Letters, digits and hyphens per label; no leading or trailing hyphen.
  const labels = candidate.split('.');
  const validLabel = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
  if (!labels.every((label) => validLabel.test(label))) {
    return null;
  }
  // A bare TLD is not a domain anyone can own.
  if (labels.length < 2 || labels[labels.length - 1].length < 2) {
    return null;
  }
  return candidate;
}

/** Assign a handle nobody else holds. */
async function assignHandle(organizationName, records) {
  const taken = new Set(records.map((record) => record.handle));
  const stem = slugify(organizationName);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = `${stem}-${randomSuffix()}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  // Vanishingly unlikely; fall back to something that cannot collide.
  return `${stem}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * The record for a workspace, created on first use.
 *
 * Every organization gets an identity whether or not it ever claims a domain,
 * so there is always something unique to show beside the name.
 */
async function ensureIdentity(workspace) {
  if (!workspace?.id) {
    throw validationError('A workspace is required.');
  }

  const records = await store.read();
  const existing = records.find((record) => record.workspaceId === workspace.id);
  if (existing) {
    return publicView(existing);
  }

  const now = new Date().toISOString();
  const record = {
    workspaceId: workspace.id,
    subscriptionId: workspace.subscriptionId || null,
    organization: workspace.organization || '',
    handle: await assignHandle(workspace.organization, records),
    domain: null,
    status: 'unverified',
    challenge: null,
    verifiedAt: null,
    createdAt: now,
    updatedAt: now
  };

  records.unshift(record);
  await store.write(records);

  await writeAuditEvent('organization.identity.created', {
    workspaceId: record.workspaceId,
    handle: record.handle,
    organization: record.organization
  });

  return publicView(record);
}

async function getIdentity(workspaceId) {
  const records = await store.read();
  const record = records.find((entry) => entry.workspaceId === workspaceId);
  return record ? publicView(record) : null;
}

async function listIdentities() {
  return (await store.read()).map(publicView);
}

/**
 * Start claiming a domain.
 *
 * Issues a fresh token every time, so an abandoned claim cannot be completed
 * later by somebody who saw the old value.
 */
async function startDomainClaim(workspaceId, domainInput, { actorEmail } = {}) {
  const domain = normalizeDomain(domainInput);
  if (!domain) {
    throw validationError('Enter a domain like contoso.com — no http://, no path.');
  }

  const records = await store.read();
  const index = records.findIndex((entry) => entry.workspaceId === workspaceId);
  if (index === -1) {
    throw validationError('Organization identity not found.', 404);
  }

  // A domain already verified elsewhere is not available. Checked against
  // verified records only: two organizations may both be *trying* to prove the
  // same domain, and only the one that publishes the record wins.
  const claimedElsewhere = records.some(
    (entry) => entry.workspaceId !== workspaceId && entry.status === 'verified' && entry.domain === domain
  );
  if (claimedElsewhere) {
    throw validationError('That domain is already verified by another organization.', 409);
  }

  const now = new Date();
  const record = records[index];
  record.domain = domain;
  record.status = 'pending';
  record.verifiedAt = null;
  record.challenge = {
    token: crypto.randomBytes(TOKEN_BYTES).toString('base64url'),
    recordName: '_aegis-challenge',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    lastCheckedAt: null,
    lastResult: null
  };
  record.updatedAt = now.toISOString();

  await store.write(records);

  await writeAuditEvent('organization.domain.claimed', {
    workspaceId,
    handle: record.handle,
    domain,
    claimedBy: actorEmail || null
  });

  return publicView(record);
}

/** Give up on a claim without touching an already-verified domain. */
async function cancelDomainClaim(workspaceId, { actorEmail } = {}) {
  const records = await store.read();
  const record = records.find((entry) => entry.workspaceId === workspaceId);
  if (!record || record.status === 'verified') {
    throw validationError('There is no claim in progress.', 409);
  }

  const domain = record.domain;
  record.domain = null;
  record.status = 'unverified';
  record.challenge = null;
  record.updatedAt = new Date().toISOString();
  await store.write(records);

  await writeAuditEvent('organization.domain.claim.cancelled', {
    workspaceId,
    domain,
    cancelledBy: actorEmail || null
  });

  return publicView(record);
}

/** The exact TXT value the customer has to publish. */
function expectedTxtValue(record) {
  return `${TXT_PREFIX}${record.challenge?.token || ''}`;
}

/** Test seam: the suite cannot publish real DNS records. */
let txtResolver = (hostname) => dns.resolveTxt(hostname);

function setTxtResolverForTesting(resolver) {
  txtResolver = resolver;
}

/**
 * Look for the challenge record and, if it is there, mark the domain verified.
 *
 * DNS is the whole proof here: publishing under `_aegis-challenge.<domain>`
 * requires control of the domain's zone, which is the thing we actually care
 * about. Rate limited because each attempt costs a lookup and a customer
 * waiting on propagation will hammer the button.
 */
async function verifyDomain(workspaceId, { actorEmail } = {}) {
  const limit = consume(`domain-verify:${workspaceId}`, { limit: 10, windowMs: 10 * 60 * 1000 });
  if (!limit.allowed) {
    throw validationError(
      `Too many checks. DNS can take a while to propagate — try again in ${Math.ceil(limit.retryAfterMs / 60000)} minutes.`,
      429
    );
  }

  const records = await store.read();
  const index = records.findIndex((entry) => entry.workspaceId === workspaceId);
  if (index === -1) {
    throw validationError('Organization identity not found.', 404);
  }

  const record = records[index];
  if (!record.domain || !record.challenge) {
    throw validationError('Claim a domain before checking it.', 409);
  }
  if (new Date(record.challenge.expiresAt).getTime() <= Date.now()) {
    throw validationError('This verification has expired. Start the claim again to get a fresh record.', 410);
  }

  const hostname = `${record.challenge.recordName}.${record.domain}`;
  const expected = expectedTxtValue(record);
  let found = [];
  let failure = null;

  try {
    // resolveTxt returns arrays of string chunks; long values are split.
    found = (await txtResolver(hostname)).map((chunks) => chunks.join(''));
  } catch (error) {
    failure = error.code === 'ENOTFOUND' || error.code === 'ENODATA' ? 'no-record' : 'lookup-failed';
  }

  const matched = found.some((value) => value.trim() === expected);
  record.challenge.lastCheckedAt = new Date().toISOString();
  record.challenge.lastResult = matched ? 'verified' : failure || 'mismatch';

  if (matched) {
    record.status = 'verified';
    record.verifiedAt = new Date().toISOString();
    // The token has done its job; keeping it would only be a value to leak.
    record.challenge.token = null;
  }
  record.updatedAt = new Date().toISOString();
  await store.write(records);

  await writeAuditEvent(matched ? 'organization.domain.verified' : 'organization.domain.verification.failed', {
    workspaceId,
    handle: record.handle,
    domain: record.domain,
    reason: matched ? null : record.challenge.lastResult,
    checkedBy: actorEmail || null
  });

  return { ok: matched, identity: publicView(record), reason: matched ? null : record.challenge.lastResult };
}

/**
 * Withdraw a verification.
 *
 * An administrator action, because a domain that has changed hands must stop
 * vouching for the organization that used to hold it. The handle survives — it
 * is the organization's identity, not the domain's.
 */
async function revokeVerification(workspaceId, { actorEmail, reason } = {}) {
  const records = await store.read();
  const record = records.find((entry) => entry.workspaceId === workspaceId);
  if (!record || record.status !== 'verified') {
    throw validationError('That organization has no verified domain.', 409);
  }

  const domain = record.domain;
  record.status = 'unverified';
  record.domain = null;
  record.challenge = null;
  record.verifiedAt = null;
  record.revokedAt = new Date().toISOString();
  record.revokedReason = String(reason || '').slice(0, 300);
  record.updatedAt = record.revokedAt;
  await store.write(records);

  await writeAuditEvent('organization.domain.verification.revoked', {
    workspaceId,
    handle: record.handle,
    domain,
    revokedBy: actorEmail || null,
    reason: record.revokedReason
  });

  return publicView(record);
}

/**
 * How this organization should be shown, and where it can be looked up.
 *
 * An unverified organization is not anonymous — it has a handle and a canonical
 * page on this deployment. Path-based rather than a subdomain because App
 * Service serves only its own hostname: `contoso-a7f3.<app>.azurewebsites.net`
 * would never resolve, whereas `<app>.azurewebsites.net/orgs/contoso-a7f3`
 * does, and is a valid did:web path form for later.
 */
function publicView(record) {
  const host = String(config.app.publicBaseUrl || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const isVerified = record.status === 'verified' && Boolean(record.domain);

  return {
    workspaceId: record.workspaceId,
    subscriptionId: record.subscriptionId,
    organization: record.organization,
    handle: record.handle,
    domain: record.domain,
    status: record.status,
    isVerified,
    isPending: record.status === 'pending',
    verifiedAt: record.verifiedAt,
    revokedAt: record.revokedAt || null,
    revokedReason: record.revokedReason || null,
    // What a holder sees beside the name.
    displayIdentity: isVerified ? record.domain : record.handle,
    canonicalUrl: `${config.app.publicBaseUrl}/orgs/${record.handle}`,
    // Reserved for per-organization DIDs once org keys exist; the path form is
    // what makes it possible without a custom domain per customer.
    didWeb: isVerified
      ? `did:web:${record.domain}`
      : `did:web:${host.replace(/:/g, '%3A')}:orgs:${record.handle}`,
    challenge: record.challenge
      ? {
          recordName: record.challenge.recordName,
          fullRecordName: record.domain ? `${record.challenge.recordName}.${record.domain}` : null,
          value: record.challenge.token ? expectedTxtValue(record) : null,
          expiresAt: record.challenge.expiresAt,
          lastCheckedAt: record.challenge.lastCheckedAt,
          lastResult: record.challenge.lastResult
        }
      : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

module.exports = {
  TXT_PREFIX,
  cancelDomainClaim,
  ensureIdentity,
  getIdentity,
  listIdentities,
  normalizeDomain,
  revokeVerification,
  setTxtResolverForTesting,
  slugify,
  startDomainClaim,
  verifyDomain
};
