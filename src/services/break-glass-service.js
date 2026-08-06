// The last way back into an organization that has lost every root wallet.
//
// The shape of the problem: if root-wallet recovery is real, then an
// organization that loses all of its root wallets is genuinely, permanently
// lost. That is the honest consequence of not keeping a master key — and it is
// also unacceptable to a customer who has just lost three phones in a fire.
//
// So there is one way back, built so that it can never become a master key:
//
//   * The **customer** generates the code and keeps it. Only a scrypt hash is
//     stored, so nobody here ever holds it.
//   * It is inert when generated. It becomes usable only when a **root wallet
//     authorises it**, while wallets still exist. That is the explicit
//     permission — given in advance, because at the moment of use there is no
//     wallet left to ask.
//   * Redeeming it takes both the code *and* a platform administrator. Neither
//     alone is enough: we cannot act without the customer's code, and the
//     customer's code does nothing without a root wallet having signed off on
//     it first.
//
// The property that matters: **no administrator here can reach a customer's
// organization on their own.** Not by policy, by construction — there is no
// path from an admin session to organization control that does not pass through
// a code the customer holds and a root wallet already authorised.

const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { writeAuditEvent } = require('./audit-service');
const { summarizeRootWallets } = require('./root-wallet-service');

const store = new FileJsonStore(config.paths.breakGlassCodes, []);

// Same unambiguous alphabet as registration codes: no I, L, O or U, because
// this gets read down a phone line to a support desk.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUPS = 4;
const GROUP_SIZE = 5;
const AUTHORISATION_TTL_HOURS = 72;

function validationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function generatePlainCode() {
  return Array.from({ length: GROUPS }, () =>
    Array.from({ length: GROUP_SIZE }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')
  ).join('-');
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

function isAuthorisationExpired(record, now = Date.now()) {
  return record.status === 'awaiting-authorisation' && new Date(record.authoriseBy).getTime() <= now;
}

function publicView(record) {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    organization: record.organization,
    hint: record.hint,
    status: isAuthorisationExpired(record) ? 'expired' : record.status,
    isActive: record.status === 'active',
    isAwaitingAuthorisation: record.status === 'awaiting-authorisation' && !isAuthorisationExpired(record),
    isExpired: isAuthorisationExpired(record),
    isRedeemed: record.status === 'redeemed',
    authorisedByWalletId: record.authorisedByWalletId,
    authorisedAt: record.authorisedAt,
    generatedBy: record.generatedBy,
    createdAt: record.createdAt,
    authoriseBy: record.authoriseBy,
    redeemedAt: record.redeemedAt,
    redeemedBy: record.redeemedBy,
    ticketReference: record.ticketReference || null
  };
}

/**
 * Generate a code for an organization.
 *
 * Requires a confirmed root wallet, because the code is only worth anything
 * once a root wallet has authorised it — issuing one for an organization with
 * no wallets would create something nobody could ever validly turn on.
 */
async function issueBreakGlassCode(workspace, { actorEmail } = {}) {
  const summary = await summarizeRootWallets(workspace.id);
  if (summary.confirmedCount === 0) {
    throw validationError(
      'Confirm a root wallet first. A break-glass code has to be authorised by one before it does anything.',
      409
    );
  }

  const records = await store.read();
  // Only one live code at a time: two valid codes is two things to lose.
  const live = records.find(
    (record) =>
      record.workspaceId === workspace.id &&
      ['active', 'awaiting-authorisation'].includes(record.status) &&
      !isAuthorisationExpired(record)
  );
  if (live) {
    throw validationError(
      'This organization already has a break-glass code. Revoke it before generating another.',
      409
    );
  }

  const plain = generatePlainCode();
  const salt = crypto.randomBytes(16).toString('base64');
  const now = new Date();

  const record = {
    id: crypto.randomUUID(),
    workspaceId: workspace.id,
    organization: workspace.organization || '',
    salt,
    hash: hashCode(plain, salt),
    // Enough to tell two codes apart in a list, not enough to redeem one.
    hint: plain.slice(0, GROUP_SIZE),
    status: 'awaiting-authorisation',
    // Presented by the root wallet that authorises the code. It travels in a QR,
    // never on a page.
    authorisationToken: crypto.randomBytes(24).toString('base64url'),
    authorisedByWalletId: null,
    authorisedAt: null,
    generatedBy: actorEmail || null,
    createdAt: now.toISOString(),
    authoriseBy: new Date(now.getTime() + AUTHORISATION_TTL_HOURS * 60 * 60 * 1000).toISOString(),
    redeemedAt: null,
    redeemedBy: null
  };

  records.unshift(record);
  await store.write(records);

  await writeAuditEvent('organization.breakGlass.generated', {
    workspaceId: workspace.id,
    codeId: record.id,
    hint: record.hint,
    generatedBy: actorEmail || null
  });

  return { code: plain, record: publicView(record), authorisationToken: record.authorisationToken };
}

/**
 * A root wallet authorising the code.
 *
 * This is the explicit permission. It is given now, while wallets exist,
 * because at the moment the code is used there will be no wallet left to ask.
 */
async function authoriseBreakGlassCode(walletId, tokenInput) {
  const token = String(tokenInput || '');
  const records = await store.read();
  const index = records.findIndex((record) => {
    if (record.status !== 'awaiting-authorisation' || !record.authorisationToken) {
      return false;
    }
    const presented = Buffer.from(token);
    const expected = Buffer.from(record.authorisationToken);
    return presented.length === expected.length && crypto.timingSafeEqual(presented, expected);
  });

  if (index === -1) {
    throw validationError('That authorisation is not valid.');
  }

  const record = records[index];
  if (isAuthorisationExpired(record)) {
    throw validationError('That authorisation has expired. Generate a new code.', 410);
  }

  // The wallet doing the authorising has to actually be a root wallet of this
  // organization — otherwise any wallet that saw the QR could switch it on.
  const summary = await summarizeRootWallets(record.workspaceId);
  const isRoot = summary.wallets.some((wallet) => wallet.walletId === walletId && wallet.isConfirmed);
  if (!isRoot) {
    throw validationError('That authorisation is not valid.');
  }

  record.status = 'active';
  record.authorisedByWalletId = walletId;
  record.authorisedAt = new Date().toISOString();
  record.authorisationToken = null;
  await store.write(records);

  await writeAuditEvent('organization.breakGlass.authorised', {
    workspaceId: record.workspaceId,
    codeId: record.id,
    hint: record.hint,
    authorisedByWalletId: walletId
  });

  return publicView(record);
}

/**
 * Redeem a code, as a platform administrator holding one the customer sent.
 *
 * Both halves are required and neither is ours: the code comes from the
 * customer, and its authority came from their root wallet. A ticket reference
 * is mandatory so the out-of-band conversation is on the record too.
 */
async function redeemBreakGlassCode(candidate, { actorEmail, ticketReference } = {}) {
  const ticket = String(ticketReference || '').trim();
  if (!ticket) {
    throw validationError('Record the support ticket this was requested under.');
  }

  const records = await store.read();
  const index = records.findIndex((record) => matches(candidate, record));

  const refuse = async (reason) => {
    await writeAuditEvent('organization.breakGlass.rejected', {
      reason,
      attemptedBy: actorEmail || null,
      ticketReference: ticket
    });
    // One message for every failure, so this cannot be used to find out which
    // organizations have a live code.
    throw validationError('That break-glass code is not valid.');
  };

  if (index === -1) {
    return refuse('unknown');
  }

  const record = records[index];
  if (record.status === 'redeemed') {
    return refuse('already-redeemed');
  }
  if (record.status !== 'active') {
    // Generated but never authorised by a root wallet. This is the case the
    // whole design exists for: without that authorisation the code is inert,
    // so an administrator here cannot act on it.
    return refuse('not-authorised');
  }

  record.status = 'redeemed';
  record.redeemedAt = new Date().toISOString();
  record.redeemedBy = actorEmail || null;
  record.ticketReference = ticket.slice(0, 120);
  await store.write(records);

  await writeAuditEvent('organization.breakGlass.redeemed', {
    workspaceId: record.workspaceId,
    organization: record.organization,
    codeId: record.id,
    hint: record.hint,
    redeemedBy: actorEmail || null,
    ticketReference: record.ticketReference,
    // Whose permission this was acting on, recorded at the moment it is used.
    authorisedByWalletId: record.authorisedByWalletId,
    authorisedAt: record.authorisedAt
  });

  return { workspaceId: record.workspaceId, organization: record.organization, record: publicView(record) };
}

/** Withdraw a code without using it — for a code that may have been seen. */
async function revokeBreakGlassCode(workspaceId, codeId, { actorEmail } = {}) {
  const records = await store.read();
  const record = records.find((entry) => entry.id === codeId && entry.workspaceId === workspaceId);
  if (!record || record.status === 'redeemed') {
    throw validationError('There is no live code to revoke.', 409);
  }

  record.status = 'revoked';
  record.authorisationToken = null;
  await store.write(records);

  await writeAuditEvent('organization.breakGlass.revoked', {
    workspaceId,
    codeId,
    hint: record.hint,
    revokedBy: actorEmail || null
  });

  return publicView(record);
}

async function listBreakGlassCodes(workspaceId = null) {
  const records = await store.read();
  return records
    .filter((record) => !workspaceId || record.workspaceId === workspaceId)
    .map(publicView);
}

module.exports = {
  authoriseBreakGlassCode,
  issueBreakGlassCode,
  listBreakGlassCodes,
  redeemBreakGlassCode,
  revokeBreakGlassCode
};
