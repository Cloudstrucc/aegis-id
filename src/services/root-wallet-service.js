// Root wallets — the wallets that can recover control of an organization.
//
// The problem they solve: today, administrative control of an organization is
// ultimately tied to an email address, and recovering it runs through the
// platform administrator. That means Vanguard can restore access to a
// customer's organization, and so can anyone who takes over the customer's
// email. Root wallets move that authority to wallets the customer holds.
//
// Two rules make this worth having rather than decorative:
//
//   1. **Nominating is not confirming.** A Wallet ID is an identifier, not a
//      secret — wallet-id.js says so outright — so knowing one proves nothing.
//      A nomination stays `pending` until the wallet itself presents the
//      confirmation token, which requires the device. Only confirmed wallets
//      count.
//   2. **The count is enforced, not displayed.** An organization below the
//      minimum cannot issue credentials. One root wallet is a single point of
//      failure; three held by different people means no single loss and no
//      single person can strand everybody else.

const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { writeAuditEvent } = require('./audit-service');
const { parseWalletId } = require('./wallet-id');
const { getWalletByWalletId } = require('./wallet-registry-service');

const store = new FileJsonStore(config.paths.rootWallets, []);

/** Three, so that losing one device does not strand an organization. */
const MINIMUM_ROOT_WALLETS = 3;
const CONFIRMATION_TTL_HOURS = 72;

function validationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

async function readFor(workspaceId) {
  const records = await store.read();
  return records.filter((record) => record.workspaceId === workspaceId);
}

function isConfirmed(record) {
  return record.status === 'confirmed';
}

function isExpired(record, now = Date.now()) {
  return record.status === 'pending' && new Date(record.expiresAt).getTime() <= now;
}

function publicView(record) {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    walletId: record.walletId,
    label: record.label,
    status: isExpired(record) ? 'expired' : record.status,
    isConfirmed: isConfirmed(record),
    isPending: record.status === 'pending' && !isExpired(record),
    isExpired: isExpired(record),
    nominatedBy: record.nominatedBy,
    nominatedAt: record.nominatedAt,
    confirmedAt: record.confirmedAt,
    expiresAt: record.expiresAt
  };
}

/**
 * Nominate a wallet.
 *
 * The wallet has to already be registered: a Wallet ID that belongs to nothing
 * could never confirm, so accepting one would only produce a slot that can
 * never be filled and a customer wondering why.
 */
async function nominateRootWallet(workspaceId, walletIdInput, { actorEmail, label } = {}) {
  const walletId = parseWalletId(walletIdInput);
  if (!walletId) {
    // parseWalletId checks the mod-37 check symbol, so a typo lands here rather
    // than becoming a nomination nobody can explain.
    throw validationError('That is not a valid Wallet ID. Check for a mistyped character.');
  }

  const wallet = await getWalletByWalletId(walletId);
  if (!wallet) {
    throw validationError('No wallet is registered with that ID.', 404);
  }
  if (wallet.status === 'revoked') {
    throw validationError('That wallet has been withdrawn from service.', 409);
  }

  const records = await store.read();
  const existing = records.find(
    (record) => record.workspaceId === workspaceId && record.walletId === walletId && !isExpired(record)
  );
  if (existing) {
    // The same wallet three times is one point of failure wearing a disguise.
    throw validationError('That wallet is already a root wallet for this organization.', 409);
  }

  const now = new Date();
  const record = {
    id: crypto.randomUUID(),
    workspaceId,
    walletId,
    label: String(label || wallet.email || '').slice(0, 120),
    status: 'pending',
    // Presented by the wallet to prove it is the device being nominated. Not
    // shown after nomination — it travels in the QR, not on the page.
    confirmationToken: crypto.randomBytes(24).toString('base64url'),
    nominatedBy: actorEmail || null,
    nominatedAt: now.toISOString(),
    confirmedAt: null,
    expiresAt: new Date(now.getTime() + CONFIRMATION_TTL_HOURS * 60 * 60 * 1000).toISOString()
  };

  records.unshift(record);
  await store.write(records);

  await writeAuditEvent('organization.rootWallet.nominated', {
    workspaceId,
    walletId,
    nominatedBy: actorEmail || null
  });

  return { record: publicView(record), confirmationToken: record.confirmationToken };
}

/**
 * The wallet confirms.
 *
 * Matched on the token rather than on the Wallet ID alone, because the ID is
 * public and the token is not. Compared in constant time — this is the step
 * that decides whether a device becomes able to recover an organization.
 */
async function confirmRootWallet(walletIdInput, tokenInput) {
  const walletId = parseWalletId(walletIdInput);
  const token = String(tokenInput || '');
  if (!walletId || !token) {
    throw validationError('That confirmation is not valid.');
  }

  const records = await store.read();
  const index = records.findIndex((record) => {
    if (record.walletId !== walletId || record.status !== 'pending' || !record.confirmationToken) {
      return false;
    }
    const presented = Buffer.from(token);
    const expected = Buffer.from(record.confirmationToken);
    return presented.length === expected.length && crypto.timingSafeEqual(presented, expected);
  });

  if (index === -1) {
    // One message for every failure: unknown, already confirmed, wrong token.
    throw validationError('That confirmation is not valid.');
  }

  const record = records[index];
  if (isExpired(record)) {
    throw validationError('That confirmation has expired. Ask for a new nomination.', 410);
  }

  record.status = 'confirmed';
  record.confirmedAt = new Date().toISOString();
  // Spent. Keeping it would only be a value to leak.
  record.confirmationToken = null;
  await store.write(records);

  await writeAuditEvent('organization.rootWallet.confirmed', {
    workspaceId: record.workspaceId,
    walletId: record.walletId
  });

  return publicView(record);
}

/**
 * Withdraw a root wallet.
 *
 * Allowed below the minimum on purpose: a compromised device has to be
 * removable immediately, and blocking that to preserve a count would be the
 * wrong trade. The organization simply cannot issue again until it is back to
 * the minimum.
 */
async function removeRootWallet(workspaceId, id, { actorEmail, reason } = {}) {
  const records = await store.read();
  const index = records.findIndex((record) => record.id === id && record.workspaceId === workspaceId);
  if (index === -1) {
    throw validationError('Root wallet not found.', 404);
  }

  const [removed] = records.splice(index, 1);
  await store.write(records);

  await writeAuditEvent('organization.rootWallet.removed', {
    workspaceId,
    walletId: removed.walletId,
    removedBy: actorEmail || null,
    reason: String(reason || '').slice(0, 300),
    // The count afterwards, because that is what decides whether the
    // organization can still issue.
    remainingConfirmed: records.filter(
      (record) => record.workspaceId === workspaceId && isConfirmed(record)
    ).length
  });

  return publicView(removed);
}

async function listRootWallets(workspaceId) {
  return (await readFor(workspaceId)).map(publicView);
}

/** Confirmed count, pending count, and whether the minimum is met. */
async function summarizeRootWallets(workspaceId) {
  const wallets = await listRootWallets(workspaceId);
  const confirmed = wallets.filter((wallet) => wallet.isConfirmed);
  return {
    wallets,
    confirmedCount: confirmed.length,
    pendingCount: wallets.filter((wallet) => wallet.isPending).length,
    minimum: MINIMUM_ROOT_WALLETS,
    enforced: config.rootWallets.enforced,
    meetsMinimum: confirmed.length >= MINIMUM_ROOT_WALLETS,
    remaining: Math.max(0, MINIMUM_ROOT_WALLETS - confirmed.length)
  };
}

/**
 * May this organization issue a credential?
 *
 * This is what stops the feature being a form field nobody reads. An
 * organization with no recovery path should not be minting identity
 * credentials, because losing its single administrator would strand every
 * holder it had issued to.
 */
async function assertRootWalletPolicy(workspaceId) {
  const summary = await summarizeRootWallets(workspaceId);
  if (summary.meetsMinimum) {
    return summary;
  }

  // Advisory until an operator switches it on. Turning it on stops issuance for
  // every organization below the minimum, existing ones included, so it is a
  // decision somebody makes per environment after giving customers notice — not
  // something a deployment does to them.
  if (!config.rootWallets.enforced) {
    return { ...summary, enforced: false };
  }

  const error = new Error(
    `This organization has ${summary.confirmedCount} of ${summary.minimum} root wallets confirmed. ` +
      'Add and confirm the rest before issuing credentials — a root wallet is how administrative ' +
      'control is recovered if an administrator loses their device.'
  );
  error.status = 409;
  error.expose = true;
  throw error;
}

module.exports = {
  MINIMUM_ROOT_WALLETS,
  assertRootWalletPolicy,
  confirmRootWallet,
  listRootWallets,
  nominateRootWallet,
  removeRootWallet,
  summarizeRootWallets
};
