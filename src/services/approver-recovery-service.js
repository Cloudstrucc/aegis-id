// Recovering an organization administrator without Vanguard.
//
// Root wallets already exist to recover an organization, but until now they
// were only reachable through break-glass — the catastrophic case, every root
// wallet lost, needing a platform administrator. The routine case, an
// administrator who loses their authenticator, still ran through email or
// through us. That left recovery authority with Vanguard for exactly the
// situation root wallets were built to take it away from.
//
// This is that routine case, decided by the organization's own devices:
//
//   1. the administrator asks for a recovery
//   2. each confirmed root wallet is sent its own approval link
//   3. two DISTINCT root wallets approve from their own wallets
//   4. the re-enrolment grant is issued — no platform administrator involved
//
// Three things hold it up:
//
// **A token is bound to one wallet.** Every approval token names the wallet it
// was minted for, and the approving wallet presents its own Wallet ID. Two
// approvals therefore mean two devices; the same link cannot be spent twice.
//
// **The requester never sees a token.** Each approval link goes to its own root
// wallet holder's registered address, not to the person recovering. This is the
// difference that matters: somebody who has taken over the administrator's
// inbox reaches a status page and nothing else, because the approvals were
// never sent there. Recovering now needs two other people's devices, which is
// precisely what "the organization decides" has to mean.
//
// **It replaces the weaker path rather than sitting beside it.** Once an
// organization has the recommended three confirmed root wallets and enforcement
// is on, its administrators can no longer recover by code-plus-email. A weaker
// alternative left in place is not an alternative; it is the way in.

const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { deliverMessage } = require('./otp-delivery-service');
const { writeAuditEvent } = require('./audit-service');
const { listRootWallets } = require('./root-wallet-service');
const { getWalletByWalletId } = require('./wallet-registry-service');
const { listWorkspacesForSubscription } = require('./platform-service');
const { isWorkspaceAdmin } = require('./org-admin-service');
const { listAdministeredSubscriptions } = require('./admin-access-service');
const { grantReenrolment } = require('./account-reenrolment-service');
const { parseWalletId } = require('./wallet-id');

const store = new FileJsonStore(config.paths.approverRecoveryRequests, []);
const userStore = new FileJsonStore(config.paths.users, []);

// Two approvals, from two different wallets. One would make a single stolen
// device enough to take over an organization's administration — the same
// failure a single root wallet already is. Three would strand an organization
// sitting exactly on the recommended count the moment one holder is away.
const APPROVALS_REQUIRED = 2;

// The count at which this becomes the *only* route. It is the recommended
// number of root wallets on purpose: below it an organization cannot reliably
// find two approvers, so taking the older path away would lock people out
// rather than protect them.
const REPLACES_EMAIL_AT = 3;

const REQUEST_TTL_HOURS = 24;
const REQUEST_TTL_MS = REQUEST_TTL_HOURS * 60 * 60 * 1000;

function validationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function normalizeEmail(value = '') {
  return String(value).trim().toLowerCase();
}

function hashToken(plain, salt) {
  return crypto.scryptSync(plain, salt, 32).toString('base64');
}

function matchesToken(plain, record) {
  if (!record?.salt || !record?.hash) {
    return false;
  }
  const candidate = Buffer.from(hashToken(plain, record.salt));
  const stored = Buffer.from(record.hash);
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

function isLive(record, now = Date.now()) {
  return !record.completedAt && !record.cancelledAt && new Date(record.expiresAt).getTime() > now;
}

/**
 * The organization whose root wallets can approve for this account.
 *
 * An administrator may hold more than one. The one with the most confirmed root
 * wallets is used, because it is the one most able to answer — and because
 * taking the weakest would let an organization with no wallets block a recovery
 * that another organization's wallets could have granted.
 */
async function findApproverOrganization(user) {
  if (!user) {
    return null;
  }

  const subscriptions = await listAdministeredSubscriptions(user);
  const candidates = [];

  for (const subscription of subscriptions) {
    const workspaces = await listWorkspacesForSubscription(subscription);
    for (const workspace of workspaces) {
      if (!isWorkspaceAdmin(workspace, subscription)) {
        continue;
      }
      const confirmed = (await listRootWallets(workspace.id)).filter((wallet) => wallet.isConfirmed);
      candidates.push({
        workspaceId: workspace.id,
        organizationName: workspace.organization || subscription.organization || 'this organization',
        confirmed
      });
    }
  }

  if (!candidates.length) {
    return null;
  }

  return candidates.sort((left, right) => right.confirmed.length - left.confirmed.length)[0];
}

/**
 * Whether this account must recover through its root wallets.
 *
 * True once the organization is at the recommended count and enforcement is on.
 * Callers use it to *withhold* the weaker path, and must not vary what they say
 * to the person on the basis of it — that would turn the recovery form into a
 * way to discover which organizations have how many root wallets.
 */
async function requiresApproverRecovery(user) {
  if (!config.rootWallets.enforced) {
    return false;
  }
  const organization = await findApproverOrganization(user);
  return Boolean(organization && organization.confirmed.length >= REPLACES_EMAIL_AT);
}

/** Whether this account *could* recover this way, whether or not it must. */
async function canUseApproverRecovery(user) {
  const organization = await findApproverOrganization(user);
  return Boolean(organization && organization.confirmed.length >= APPROVALS_REQUIRED);
}

/** The deep link a root wallet opens. The wallet supplies its own Wallet ID. */
function approvalDeepLink(requestId, token) {
  return `${config.app.walletUrlScheme}://recovery-approve?request_id=${encodeURIComponent(
    requestId
  )}&token=${encodeURIComponent(token)}`;
}

/** The public shape of a request: never a token, never a hash. */
function publicView(record) {
  const approved = record.approvers.filter((approver) => approver.approvedAt);
  return {
    id: record.id,
    email: record.email,
    organizationName: record.organizationName,
    workspaceId: record.workspaceId,
    approvalsRequired: record.approvalsRequired,
    approvalCount: approved.length,
    isApproved: approved.length >= record.approvalsRequired,
    isGranted: Boolean(record.grantedAt),
    expiresAt: record.expiresAt,
    approvers: record.approvers.map((approver) => ({
      // The Wallet ID is an identifier, not a secret, and the person recovering
      // has to know who to chase. What they never see is the token.
      walletId: approver.walletId,
      label: approver.label,
      notified: Boolean(approver.notifiedAt),
      approvedAt: approver.approvedAt,
      hasApproved: Boolean(approver.approvedAt)
    }))
  };
}

/**
 * Start a recovery.
 *
 * Always resolves the same way whether or not the address is known and whether
 * or not its organization has approvers — the caller must not tell the person
 * anything different, or this becomes a way to enumerate both.
 */
async function startApproverRecovery(emailInput, { baseUrl, context = {} } = {}) {
  const email = normalizeEmail(emailInput);
  const users = await userStore.read();
  const user = users.find((entry) => normalizeEmail(entry.email) === email);
  // What this issues is a re-enrolment grant, which only a passwordless account
  // can spend. An account with a password already has the reset link and does
  // not need two people's devices to get back in — and letting one start a
  // request would only spend three holders' attention on a dead end.
  const eligible = user && !user.passwordHash;
  const organization = eligible ? await findApproverOrganization(user) : null;

  if (!eligible || !organization || organization.confirmed.length < APPROVALS_REQUIRED) {
    await writeAuditEvent('auth.account.approverRecovery.requested', {
      email,
      matched: false,
      ...context
    });
    return { requested: true };
  }

  const now = new Date();
  // One live request per account: asking twice must not leave two sets of
  // approval links outstanding, or an abandoned set could still be spent.
  const records = (await store.read()).filter(
    (record) => record.userId !== user.id || !isLive(record, now.getTime())
  );

  const statusToken = crypto.randomBytes(32).toString('base64url');
  const statusSalt = crypto.randomBytes(16).toString('base64');
  const requestId = crypto.randomUUID();

  // One token per confirmed root wallet, each naming the wallet it belongs to.
  // That is what makes two approvals mean two devices rather than one device
  // twice — the same shape as a root wallet nomination, bound to the wallet
  // being nominated for the same reason.
  const approvers = organization.confirmed.map((wallet) => {
    const token = crypto.randomBytes(24).toString('base64url');
    const salt = crypto.randomBytes(16).toString('base64');
    return {
      walletId: wallet.walletId,
      label: wallet.label || '',
      salt,
      hash: hashToken(token, salt),
      notifiedAt: null,
      approvedAt: null,
      token
    };
  });

  const record = {
    id: requestId,
    userId: user.id,
    email: user.email,
    workspaceId: organization.workspaceId,
    organizationName: organization.organizationName,
    approvalsRequired: APPROVALS_REQUIRED,
    statusSalt,
    statusHash: hashToken(statusToken, statusSalt),
    approvers: approvers.map(({ token, ...rest }) => rest),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + REQUEST_TTL_MS).toISOString(),
    grantedAt: null,
    completedAt: null,
    cancelledAt: null
  };

  // Each approval link goes to the wallet holder it belongs to, never to the
  // person recovering. A stolen inbox therefore reaches a status page and
  // nothing usable — which is the whole point of asking the wallets.
  let notified = 0;
  for (const approver of approvers) {
    const wallet = await getWalletByWalletId(approver.walletId);
    if (!wallet?.email && !wallet?.phone) {
      continue;
    }
    const delivery = await deliverMessage({
      type: 'approver-recovery',
      email: wallet.email,
      phone: wallet.phone,
      variables: {
        approvalUrl: approvalDeepLink(requestId, approver.token),
        expiresInHours: REQUEST_TTL_HOURS,
        organizationName: organization.organizationName,
        requesterEmail: user.email
      },
      context: { userId: user.id, walletId: approver.walletId }
    });
    if (delivery.delivered) {
      notified += 1;
      const stored = record.approvers.find((entry) => entry.walletId === approver.walletId);
      stored.notifiedAt = new Date().toISOString();
    }
  }

  records.unshift(record);
  await store.write(records);

  // The requester gets a pointer to a status page and no token at all.
  const statusUrl = `${String(baseUrl || config.app.publicBaseUrl).replace(/\/$/, '')}/auth/recover/approvals/${statusToken}`;
  await deliverMessage({
    type: 'approver-recovery-status',
    email: user.email,
    variables: {
      statusUrl,
      expiresInHours: REQUEST_TTL_HOURS,
      organizationName: organization.organizationName,
      approvalsRequired: APPROVALS_REQUIRED
    },
    context: { userId: user.id }
  });

  await writeAuditEvent('auth.account.approverRecovery.requested', {
    userId: user.id,
    email: user.email,
    workspaceId: organization.workspaceId,
    matched: true,
    approverCount: approvers.length,
    notifiedCount: notified,
    ...context
  });

  return { requested: true };
}

/** Resolve the status link we emailed the person recovering. */
async function resolveStatusLink(statusToken) {
  if (!statusToken) {
    return null;
  }
  const records = await store.read();
  const now = Date.now();
  const record = records.find(
    (entry) =>
      !entry.cancelledAt &&
      new Date(entry.expiresAt).getTime() > now &&
      matchesToken(statusToken, { salt: entry.statusSalt, hash: entry.statusHash })
  );
  return record ? publicView(record) : null;
}

/**
 * A root wallet approving.
 *
 * The wallet presents **its own** Wallet ID, exactly as it does when authorising
 * a break-glass code: the token names a wallet, and only that wallet can spend
 * it. Every failure — unknown token, a token belonging to another wallet, an
 * expired request — answers identically, so this cannot be used to learn which
 * wallets an organization has.
 */
async function approveRecoveryRequest(walletIdInput, requestId, tokenInput) {
  const walletId = parseWalletId(walletIdInput);
  const token = String(tokenInput || '');
  if (!walletId || !token) {
    throw validationError('That approval is not valid.');
  }

  const records = await store.read();
  const index = records.findIndex((record) => record.id === requestId && isLive(record));
  if (index === -1) {
    throw validationError('That approval is not valid.');
  }

  const record = records[index];
  const approver = record.approvers.find(
    (entry) => entry.walletId === walletId && matchesToken(token, entry)
  );

  if (!approver) {
    // Recorded even though it is refused: an approval attempt from a wallet
    // that is not an approver is what a takeover attempt looks like.
    await writeAuditEvent('auth.account.approverRecovery.rejected', {
      requestId: record.id,
      workspaceId: record.workspaceId,
      walletId
    });
    throw validationError('That approval is not valid.');
  }

  if (!approver.approvedAt) {
    approver.approvedAt = new Date().toISOString();
    await store.write(records);

    await writeAuditEvent('auth.account.approverRecovery.approved', {
      requestId: record.id,
      userId: record.userId,
      workspaceId: record.workspaceId,
      walletId,
      approvalCount: record.approvers.filter((entry) => entry.approvedAt).length,
      approvalsRequired: record.approvalsRequired
    });
  }

  // Scanning twice is not an error and grants nothing new, so the second
  // answer is the same as the first.
  return publicView(record);
}

/**
 * Spend the approvals and issue the re-enrolment grant.
 *
 * The grant goes to the account's own address, exactly as it does when an
 * administrator authorises one — the difference is who authorised it, and that
 * nobody here can. Spent once: the request is completed here, so a second call
 * cannot mint a second grant.
 */
async function claimApproverRecovery(statusToken, { baseUrl } = {}) {
  const records = await store.read();
  const now = Date.now();
  const index = records.findIndex(
    (entry) =>
      isLive(entry, now) && matchesToken(statusToken || '', { salt: entry.statusSalt, hash: entry.statusHash })
  );

  if (index === -1) {
    throw validationError('That recovery request is no longer open.', 410);
  }

  const record = records[index];
  const approvedBy = record.approvers.filter((approver) => approver.approvedAt).map((approver) => approver.walletId);
  if (approvedBy.length < record.approvalsRequired) {
    throw validationError(
      `This recovery needs ${record.approvalsRequired} root wallet approvals and has ${approvedBy.length}.`,
      409
    );
  }

  record.grantedAt = new Date().toISOString();
  record.completedAt = record.grantedAt;
  // The approval tokens are spent with the request. Keeping them would only be
  // something to leak.
  record.approvers = record.approvers.map(({ salt, hash, ...rest }) => rest);
  await store.write(records);

  await grantReenrolment(record.userId, {
    // Named rather than left blank: the evidence has to say the customer's own
    // root wallets authorised this, not that nobody did.
    actorEmail: `root-wallets:${record.workspaceId}`,
    baseUrl,
    reason: `Approved by ${approvedBy.length} root wallets of ${record.organizationName}`
  });

  await writeAuditEvent('auth.account.approverRecovery.granted', {
    requestId: record.id,
    userId: record.userId,
    workspaceId: record.workspaceId,
    approvalCount: approvedBy.length,
    approvedBy
  });

  return publicView(record);
}

module.exports = {
  APPROVALS_REQUIRED,
  REPLACES_EMAIL_AT,
  REQUEST_TTL_HOURS,
  approvalDeepLink,
  approveRecoveryRequest,
  canUseApproverRecovery,
  claimApproverRecovery,
  findApproverOrganization,
  requiresApproverRecovery,
  resolveStatusLink,
  startApproverRecovery
};
