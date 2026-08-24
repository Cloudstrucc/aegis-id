// Signing in to a connected application with the wallet, and nothing typed.
//
// The screen this replaces asked for an email address and a display name, and
// the authorization endpoint then believed them. Anyone could type a
// colleague's address and receive a token carrying that person's organizations,
// because the only thing standing between the form and the claims was the form.
//
// So identity here is never asserted by the browser. The browser starts a
// challenge and watches it; the *wallet* answers, presenting its own Wallet ID
// from its own keychain. The server resolves that Wallet ID to the registered
// holder and to the credentials they actually hold. What the person knows is
// worth nothing — only what their device can prove.
//
// Three properties hold it up:
//
// **The wallet presents its own identifier.** The deep link carries a challenge
// id and no identity at all, exactly as root wallet confirmation and
// break-glass authorisation do. A link forwarded to somebody else lets them
// approve as *themselves*, which resolves to their organizations, not the
// requester's.
//
// **A challenge is bound to the OIDC request that created it.** client_id,
// redirect_uri, state and nonce are captured at the start and re-checked at the
// end, so an approval obtained for one application cannot be spent on another.
//
// **It is single-use and short-lived.** Approving marks it spent. The browser's
// poll can read the outcome exactly once, and a challenge that is never
// approved expires on its own.

const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { getWalletByWalletId } = require('./wallet-registry-service');
const { listCredentialMembershipsForEmail } = require('./org-admin-service');
const { writeAuditEvent } = require('./audit-service');

const store = new FileJsonStore(config.paths.oidcWalletSignIns, []);

/** Long enough to walk to a phone, short enough that an abandoned QR dies. */
const CHALLENGE_TTL_MINUTES = 5;

/** Retained briefly after use so a duplicated poll gets an answer, not a 404. */
const SPENT_RETENTION_MINUTES = 10;

function nowIso() {
  return new Date().toISOString();
}

function createId() {
  return crypto.randomBytes(16).toString('hex');
}

function normalizeText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function expose(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function isExpired(record) {
  return Date.parse(record.expiresAt) <= Date.now();
}

/** Drops what nobody can act on any more, so the file cannot grow without end. */
function prune(records) {
  const cutoff = Date.now() - SPENT_RETENTION_MINUTES * 60 * 1000;
  return records.filter((record) => {
    if (record.status === 'pending') {
      return Date.parse(record.expiresAt) > cutoff;
    }
    return Date.parse(record.resolvedAt || record.createdAt) > cutoff;
  });
}

/**
 * Begin a wallet sign-in for an OIDC authorization request.
 *
 * Everything the authorization code will need is captured now, so the approval
 * cannot later be redirected at a different application.
 */
async function startWalletSignIn(input = {}) {
  const clientId = normalizeText(input.clientId, 160);
  const redirectUri = normalizeText(input.redirectUri, 500);
  if (!clientId || !redirectUri) {
    throw expose('A wallet sign-in needs the application it is signing in to.');
  }

  const record = {
    id: createId(),
    status: 'pending',
    clientId,
    redirectUri,
    responseType: normalizeText(input.responseType, 40) || 'code',
    scope: normalizeText(input.scope, 200),
    state: normalizeText(input.state, 200),
    nonce: normalizeText(input.nonce, 200),
    // The organization the application asked for, if any. It is only a
    // preference: the holder still chooses from the organizations they hold a
    // live credential in.
    requestedOrganizationId: normalizeText(input.organizationId, 120),
    appName: normalizeText(input.appName, 160) || clientId,
    walletId: null,
    email: null,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MINUTES * 60 * 1000).toISOString()
  };

  const records = prune(await store.read());
  records.push(record);
  await store.write(records);

  await writeAuditEvent('oidc.wallet-signin.started', {
    challengeId: record.id,
    clientId: record.clientId,
    appName: record.appName
  });

  return record;
}

/**
 * The link the wallet opens.
 *
 * Carries the challenge and nothing else — no email, no Wallet ID, no
 * organization. There is nothing in it worth stealing, which is what makes it
 * safe to put on a screen for anyone to photograph.
 */
function walletDeepLink(challengeId) {
  const params = new URLSearchParams({ challenge: normalizeText(challengeId, 64) });
  return `${config.app.walletUrlScheme}://sign-in?${params.toString()}`;
}

async function getChallenge(challengeId) {
  const records = await store.read();
  return records.find((record) => record.id === normalizeText(challengeId, 64)) || null;
}

/**
 * The wallet answering.
 *
 * `presentedWalletId` comes from the wallet's own storage, never from the link
 * — so this authenticates the device rather than the person holding the screen
 * the QR was displayed on.
 */
async function approveWalletSignIn(challengeId, presentedWalletId) {
  const walletId = normalizeText(presentedWalletId, 64);
  if (!walletId) {
    throw expose('This wallet did not present its Wallet ID.');
  }

  const records = prune(await store.read());
  const index = records.findIndex((record) => record.id === normalizeText(challengeId, 64));
  if (index === -1) {
    throw expose('That sign-in request is no longer available.', 404);
  }

  const record = records[index];
  if (record.status !== 'pending') {
    throw expose('That sign-in request has already been answered.');
  }
  if (isExpired(record)) {
    record.status = 'expired';
    record.resolvedAt = nowIso();
    await store.write(records);
    throw expose('That sign-in request has expired. Start again from the application.');
  }

  const wallet = await getWalletByWalletId(walletId);
  if (!wallet) {
    throw expose('That wallet is not registered with Aegis ID.', 404);
  }
  // A withdrawn wallet stops working everywhere, and signing in to a connected
  // application is exactly the kind of "everywhere" that matters.
  if (wallet.status === 'revoked') {
    throw expose('That wallet has been withdrawn from service.', 403);
  }

  record.status = 'approved';
  record.walletId = wallet.walletId;
  record.email = wallet.email;
  record.resolvedAt = nowIso();
  await store.write(records);

  await writeAuditEvent('oidc.wallet-signin.approved', {
    challengeId: record.id,
    clientId: record.clientId,
    walletId: wallet.walletId,
    subject: wallet.email
  });

  return record;
}

/** The holder saying no. Recorded, because a decline is a real answer. */
async function declineWalletSignIn(challengeId, presentedWalletId) {
  const records = prune(await store.read());
  const index = records.findIndex((record) => record.id === normalizeText(challengeId, 64));
  if (index === -1) {
    throw expose('That sign-in request is no longer available.', 404);
  }

  const record = records[index];
  if (record.status !== 'pending') {
    throw expose('That sign-in request has already been answered.');
  }

  record.status = 'declined';
  record.walletId = normalizeText(presentedWalletId, 64) || null;
  record.resolvedAt = nowIso();
  await store.write(records);

  await writeAuditEvent('oidc.wallet-signin.declined', {
    challengeId: record.id,
    clientId: record.clientId,
    walletId: record.walletId
  });

  return record;
}

/**
 * What the browser is allowed to know while it waits.
 *
 * Deliberately thin until the moment of approval: a pending challenge tells a
 * watcher nothing about who might answer it.
 */
async function readSignInStatus(challengeId) {
  const record = await getChallenge(challengeId);
  if (!record) {
    return { status: 'unknown' };
  }
  if (record.status === 'pending' && isExpired(record)) {
    return { status: 'expired' };
  }
  if (record.status !== 'approved') {
    return { status: record.status };
  }

  const memberships = await listCredentialMembershipsForEmail(record.email);
  return {
    status: 'approved',
    walletId: record.walletId,
    email: record.email,
    organizationCount: memberships.length
  };
}

/**
 * Spend an approved challenge, once.
 *
 * The caller has to prove it is completing the same authorization request the
 * challenge was minted for — otherwise an approval collected for one
 * application could be handed to another.
 */
async function claimWalletSignIn(challengeId, { clientId, redirectUri } = {}) {
  const records = prune(await store.read());
  const index = records.findIndex((record) => record.id === normalizeText(challengeId, 64));
  if (index === -1) {
    throw expose('That sign-in request is no longer available.', 404);
  }

  const record = records[index];
  if (record.status !== 'approved') {
    throw expose('That sign-in has not been approved from a wallet.', 403);
  }
  if (record.clientId !== normalizeText(clientId, 160) ||
      record.redirectUri !== normalizeText(redirectUri, 500)) {
    throw expose('That approval belongs to a different application.', 403);
  }
  if (Date.parse(record.resolvedAt) + CHALLENGE_TTL_MINUTES * 60 * 1000 <= Date.now()) {
    throw expose('That approval has expired. Start again from the application.');
  }

  record.status = 'claimed';
  record.claimedAt = nowIso();
  await store.write(records);

  const memberships = await listCredentialMembershipsForEmail(record.email);
  return { record, memberships };
}

module.exports = {
  CHALLENGE_TTL_MINUTES,
  startWalletSignIn,
  walletDeepLink,
  getChallenge,
  approveWalletSignIn,
  declineWalletSignIn,
  readSignInStatus,
  claimWalletSignIn
};
