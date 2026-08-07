// Proving which organization is which.
//
// Three surfaces, three audiences:
//
//   /organizations/:sub/:ws/domain   the customer, claiming and proving
//   /orgs/:handle                    a holder, checking who invited them
//   /help/domain-verification        anybody, before they are signed in
//
// The public pages are public by necessity. Somebody who has just been sent a
// credential invitation has no account here, and "check who this is from" is
// exactly the moment they most need to.

const express = require('express');
const QRCode = require('qrcode');

const config = require('../config');
const { authorize } = require('../middleware/authorization');
const { requireAuthenticated } = require('../middleware/auth');
const { getWorkspaceForSubscription } = require('../services/platform-service');
const {
  cancelDomainClaim,
  ensureIdentity,
  getIdentity,
  listIdentities,
  startDomainClaim,
  verifyDomain
} = require('../services/organization-identity-service');
const { DNS_PROVIDERS } = require('../services/dns-provider-guides');
const {
  confirmRootWallet,
  nominateRootWallet,
  removeRootWallet,
  summarizeRootWallets
} = require('../services/root-wallet-service');
const {
  authoriseBreakGlassCode,
  issueBreakGlassCode,
  listBreakGlassCodes,
  revokeBreakGlassCode
} = require('../services/break-glass-service');
const {
  APPROVALS_REQUIRED,
  REPLACES_EMAIL_AT,
  approveRecoveryRequest
} = require('../services/approver-recovery-service');

// The URL scheme the wallet registers, which is per environment: a dev build
// registers `aegisid-dev`, so a bare `aegisid` link opened the production build
// or, on iOS where a scheme is claimed exclusively, nothing at all.
const WALLET_SCHEME = config.app.walletUrlScheme;

const router = express.Router();

async function loadWorkspace(req) {
  const workspace = await getWorkspaceForSubscription(
    req.authorizedSubscription,
    req.params.workspaceId
  );
  if (!workspace) {
    const error = new Error('Organization workspace not found.');
    error.status = 404;
    throw error;
  }
  return workspace;
}

function domainPath(req) {
  return `/organizations/${req.params.subscriptionId}/${req.params.workspaceId}/domain`;
}

/**
 * These two endpoints answer both a wallet and a browser.
 *
 * The wallet follows the deep link with `Accept: application/json` and shows
 * the outcome in the app; a person who opened the same URL in a browser gets
 * the page. Rendering HTML at a wallet left it parsing markup for a yes or no,
 * which is how a failure reached the holder as "Request failed (400)".
 */
function wantsJson(req) {
  return req.accepts(['html', 'json']) === 'json';
}

function respond(req, res, { status = 200, json, view }) {
  if (wantsJson(req)) {
    return res.status(status).json(json);
  }
  return res.status(status).render('pages/root-wallet-confirmed', view);
}

router.get(
  '/organizations/:subscriptionId/:workspaceId/domain',
  requireAuthenticated,
  authorize('workspace.domain.manage'),
  async (req, res, next) => {
    try {
      const workspace = await loadWorkspace(req);
      res.render('pages/organization-domain', {
        title: 'Organization identity',
        description: 'Prove the domain your organization is known by.',
        workspace,
        subscriptionId: req.params.subscriptionId,
        identity: await ensureIdentity(workspace),
        checked: req.query.checked || null,
        reason: req.query.reason || null,
        errorMessage: req.query.error || null
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/organizations/:subscriptionId/:workspaceId/domain',
  requireAuthenticated,
  authorize('workspace.domain.manage'),
  async (req, res, next) => {
    try {
      const workspace = await loadWorkspace(req);
      await ensureIdentity(workspace);
      const actorEmail = req.user?.email;

      if (req.body.action === 'cancel') {
        await cancelDomainClaim(workspace.id, { actorEmail });
        return res.redirect(303, domainPath(req));
      }

      if (req.body.action === 'verify') {
        const result = await verifyDomain(workspace.id, { actorEmail });
        return res.redirect(
          303,
          `${domainPath(req)}?checked=${result.ok ? 'verified' : 'failed'}${
            result.reason ? `&reason=${encodeURIComponent(result.reason)}` : ''
          }`
        );
      }

      await startDomainClaim(workspace.id, req.body.domain, { actorEmail });
      return res.redirect(303, domainPath(req));
    } catch (error) {
      if (error.expose) {
        return res.redirect(303, `${domainPath(req)}?error=${encodeURIComponent(error.message)}`);
      }
      return next(error);
    }
  }
);

/**
 * The canonical page for a handle.
 *
 * Deliberately terse and deliberately honest: it says whether the domain has
 * been proven, and when it has not it says so plainly rather than leaving an
 * absence of a badge to be interpreted.
 */
router.get('/orgs/:handle', authorize('public.organization'), async (req, res, next) => {
  try {
    const identities = await listIdentities();
    const identity = identities.find((entry) => entry.handle === req.params.handle);
    if (!identity) {
      return res.status(404).render('pages/not-found', {
        title: 'Organization not found',
        description: 'No organization is registered under that handle.'
      });
    }

    res.render('pages/organization-profile', {
      title: identity.organization || identity.handle,
      description: `Identity details for ${identity.organization || identity.handle}.`,
      identity
    });
  } catch (error) {
    next(error);
  }
});

router.get('/help/domain-verification', authorize('public.help'), (req, res) => {
  res.render('pages/help-domain-verification', {
    title: 'Verifying your organization domain',
    description: 'How to add the DNS record that proves your organization owns its domain.',
    providers: DNS_PROVIDERS,
    exampleHost: '_aegis-challenge',
    exampleValue: 'aegis-domain-verification=EXAMPLE-TOKEN',
    platformHost: String(config.app.publicBaseUrl || '').replace(/^https?:\/\//, '')
  });
});

// --- root wallets -----------------------------------------------------------

router.get(
  '/organizations/:subscriptionId/:workspaceId/root-wallets',
  requireAuthenticated,
  authorize('workspace.rootWallets.manage'),
  async (req, res, next) => {
    try {
      const workspace = await loadWorkspace(req);
      const summary = await summarizeRootWallets(workspace.id);
      const nominated = req.session.lastRootWalletNomination || null;
      delete req.session.lastRootWalletNomination;
      const breakGlassIssued = req.session.lastBreakGlassCode || null;
      delete req.session.lastBreakGlassCode;
      const breakGlassCodes = await listBreakGlassCodes(workspace.id);

      res.render('pages/root-wallets', {
        title: 'Root wallets',
        description: 'Wallets that can recover control of this organization.',
        workspace,
        subscriptionId: req.params.subscriptionId,
        ...summary,
        // Handlebars has no arithmetic, so the bar width is computed here.
        meterPercent: Math.round((Math.min(summary.confirmedCount, summary.minimum) / summary.minimum) * 100),
        // Shown once, on the page that follows nomination. The token travels in
        // the QR the wallet scans, not in a field anybody can read off a
        // screenshot later.
        nominated,
        // Whether this organization's own wallets can now recover its
        // administrators, and whether that has displaced the weaker path.
        approverRecovery: {
          approvalsRequired: APPROVALS_REQUIRED,
          replacesEmailAt: REPLACES_EMAIL_AT,
          available: summary.confirmedCount >= APPROVALS_REQUIRED,
          active: config.rootWallets.enforced && summary.confirmedCount >= REPLACES_EMAIL_AT
        },
        breakGlassIssued,
        breakGlassCodes,
        liveBreakGlass: breakGlassCodes.find((entry) => entry.isActive || entry.isAwaitingAuthorisation) || null,
        errorMessage: req.query.error || null,
        saved: req.query.saved || null
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/organizations/:subscriptionId/:workspaceId/root-wallets',
  requireAuthenticated,
  authorize('workspace.rootWallets.manage'),
  async (req, res, next) => {
    const back = `/organizations/${req.params.subscriptionId}/${req.params.workspaceId}/root-wallets`;
    try {
      const workspace = await loadWorkspace(req);
      const actorEmail = req.user?.email;

      if (req.body.action === 'remove') {
        await removeRootWallet(workspace.id, req.body.rootWalletId, { actorEmail, reason: req.body.reason });
        return res.redirect(303, `${back}?saved=removed`);
      }

      const { record, confirmationToken } = await nominateRootWallet(workspace.id, req.body.walletId, {
        actorEmail,
        label: req.body.label
      });

      // An aegisid:// deep link, not an https URL. The wallet's scanner only
      // understands this scheme and Aries out-of-band invitations, so an https
      // link produced "paste an Aries out-of-band invitation URL" and the flow
      // could never complete. Same shape as the org invite the wallet already
      // handles.
      //
      // The nominated Wallet ID travels in the link because we know which
      // wallet is being nominated. Break-glass cannot do that — see below.
      const confirmUrl = `${WALLET_SCHEME}://root-wallet-confirm?wallet_id=${encodeURIComponent(
        record.walletId
      )}&token=${encodeURIComponent(confirmationToken)}`;

      req.session.lastRootWalletNomination = {
        walletId: record.walletId,
        qrCodeDataUrl: await QRCode.toDataURL(confirmUrl, { margin: 1, width: 360 })
      };
      return res.redirect(303, back);
    } catch (error) {
      if (error.expose) {
        return res.redirect(303, `${back}?error=${encodeURIComponent(error.message)}`);
      }
      return next(error);
    }
  }
);

/**
 * The wallet confirming its own nomination.
 *
 * Public by necessity — the wallet has no browser session — and the token is
 * the whole authorization, which is why nominating alone grants nothing.
 */
router.get('/api/root-wallets/confirm', authorize('api.rootWallet.confirm'), async (req, res, next) => {
  try {
    const record = await confirmRootWallet(req.query.wallet_id, req.query.token);
    return respond(req, res, {
      json: {
        confirmed: true,
        walletId: record.walletId,
        message: 'This wallet can now recover control of the organization.'
      },
      view: {
        title: 'Root wallet confirmed',
        description: 'This wallet can now recover control of the organization.',
        walletId: record.walletId
      }
    });
  } catch (error) {
    if (error.expose) {
      return respond(req, res, {
        status: error.status || 400,
        json: { error: { message: error.message } },
        view: {
          title: 'Confirmation failed',
          description: 'This nomination could not be confirmed.',
          errorMessage: error.message
        }
      });
    }
    return next(error);
  }
});

// --- break glass ------------------------------------------------------------

router.post(
  '/organizations/:subscriptionId/:workspaceId/break-glass',
  requireAuthenticated,
  authorize('workspace.breakGlass.manage'),
  async (req, res, next) => {
    const back = `/organizations/${req.params.subscriptionId}/${req.params.workspaceId}/root-wallets`;
    try {
      const workspace = await loadWorkspace(req);
      const actorEmail = req.user?.email;

      if (req.body.action === 'revoke') {
        await revokeBreakGlassCode(workspace.id, req.body.codeId, { actorEmail });
        return res.redirect(303, `${back}?saved=glass-revoked`);
      }

      const { code, authorisationToken } = await issueBreakGlassCode(workspace, { actorEmail });
      // No wallet_id here, and that is the point: any of the organization's
      // root wallets may authorise, so the scanning wallet supplies its own.
      // The previous https URL omitted it too — but the handler read it — so
      // authorisation could never succeed for anybody.
      const authoriseUrl = `${WALLET_SCHEME}://break-glass-authorise?token=${encodeURIComponent(
        authorisationToken
      )}`;

      // Shown once. The code goes to the customer and nowhere else — we keep
      // only a hash — and the QR is how a root wallet grants the standing
      // permission that makes it usable later.
      req.session.lastBreakGlassCode = {
        code,
        qrCodeDataUrl: await QRCode.toDataURL(authoriseUrl, { margin: 1, width: 360 })
      };
      return res.redirect(303, back);
    } catch (error) {
      if (error.expose) {
        return res.redirect(303, `${back}?error=${encodeURIComponent(error.message)}`);
      }
      return next(error);
    }
  }
);

/**
 * A root wallet granting the standing permission.
 *
 * The wallet identifies itself with its own Wallet ID; the token proves this is
 * the code being authorised. Both are required, and the wallet must already be
 * a confirmed root wallet of that organization.
 */
router.get('/api/break-glass/authorise', authorize('api.rootWallet.confirm'), async (req, res, next) => {
  try {
    // The wallet sends its own Wallet ID; the token proves which code. Both are
    // required, and a missing wallet_id is refused explicitly rather than
    // falling through to "not valid", which is what made this undiagnosable.
    if (!req.query.wallet_id) {
      const message =
        'The wallet did not identify itself. Open this from the Aegis wallet rather than a browser.';
      return respond(req, res, {
        status: 400,
        json: { error: { message } },
        view: {
          title: 'Authorisation failed',
          description: 'This code could not be authorised.',
          errorMessage: message
        }
      });
    }
    const record = await authoriseBreakGlassCode(req.query.wallet_id, req.query.token);
    return respond(req, res, {
      json: {
        authorised: true,
        walletId: record.authorisedByWalletId,
        message:
          'The organization can now be recovered with this code if every root wallet is lost.'
      },
      view: {
        title: 'Break-glass code authorised',
        description: 'The organization can now be recovered with this code if every root wallet is lost.',
        breakGlass: record
      }
    });
  } catch (error) {
    if (error.expose) {
      return respond(req, res, {
        status: error.status || 400,
        json: { error: { message: error.message } },
        view: {
          title: 'Authorisation failed',
          description: 'This code could not be authorised.',
          errorMessage: error.message
        }
      });
    }
    return next(error);
  }
});

// --- routine recovery, approved by root wallets ------------------------------

/**
 * A root wallet approving an administrator's recovery.
 *
 * The wallet identifies itself with its own Wallet ID, as it does everywhere
 * else here; the token names which wallet may spend it and was sent to that
 * holder's own address, never to the person recovering. Two distinct wallets
 * have to arrive here before anything is issued.
 */
router.get(
  '/api/account-recovery/approve',
  authorize('api.rootWallet.approveRecovery'),
  async (req, res, next) => {
    try {
      if (!req.query.wallet_id) {
        const message =
          'The wallet did not identify itself. Open this from the Aegis wallet rather than a browser.';
        return respond(req, res, {
          status: 400,
          json: { error: { message } },
          view: {
            title: 'Approval failed',
            description: 'This recovery could not be approved.',
            errorMessage: message
          }
        });
      }

      const record = await approveRecoveryRequest(
        req.query.wallet_id,
        req.query.request_id,
        req.query.token
      );

      const remaining = Math.max(0, record.approvalsRequired - record.approvalCount);
      const message = record.isApproved
        ? `Approved. ${record.organizationName} has the approvals it needs, and the re-enrolment link goes to the account's own address.`
        : `Approved. ${remaining} more root wallet approval${remaining === 1 ? '' : 's'} needed.`;

      return respond(req, res, {
        json: {
          approved: true,
          approvalCount: record.approvalCount,
          approvalsRequired: record.approvalsRequired,
          isApproved: record.isApproved,
          message
        },
        view: {
          title: 'Recovery approved',
          description: message,
          walletId: req.query.wallet_id
        }
      });
    } catch (error) {
      if (error.expose) {
        return respond(req, res, {
          status: error.status || 400,
          json: { error: { message: error.message } },
          view: {
            title: 'Approval failed',
            description: 'This recovery could not be approved.',
            errorMessage: error.message
          }
        });
      }
      return next(error);
    }
  }
);

module.exports = router;
