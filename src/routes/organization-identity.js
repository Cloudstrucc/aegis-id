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

module.exports = router;
