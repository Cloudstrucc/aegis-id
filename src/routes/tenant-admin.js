// Organization-scoped settings: `/orgs/:handle/settings/...`
//
// The settings that belong to one organization, addressed by that
// organization's handle rather than by the subscription that pays for it. The
// handle is already globally unique and never reused, so every member of an
// organization has the same address for it — which was not true while tenancy
// ran through `/dashboard/:subscriptionId/...`, where the same organization had
// a different URL for each viewer.
//
// Only organization-scoped settings live here. Sign-in methods, notification
// delivery, registration codes, break-glass and account recovery stay under
// `/admin` behind `adminAnyWorkspace`, because they decide how the whole
// deployment behaves and an invited administrator must not reach them. That
// split is the point: it is what lets a tenant administrator administer their
// own tenant without widening platform access.

const express = require('express');

const { authorize } = require('../middleware/authorization');
const { requireAuthenticated } = require('../middleware/auth');
const { resolveSubscriptionIdForTenant } = require('../services/tenant-access-service');
const {
  isEnabled: authAdaptersEnabled,
  listCatalog,
  listInstances,
  getInstance,
  createInstance,
  updateInstance,
  deleteInstance,
  runSelfTest
} = require('../services/adapter-registry-service');
const { listWallets, restoreWallet, revokeWallet } = require('../services/wallet-registry-service');
const {
  countCredentialsByWorkspace,
  getOrganizationBranding,
  listWalletScopeForWorkspace
} = require('../services/org-admin-service');
const { getIdentity } = require('../services/organization-identity-service');
const { summarizeRootWallets } = require('../services/root-wallet-service');

const router = express.Router();

const RESERVED_FIELDS = new Set(['_action', 'kind', 'name', 'status', 'firstFactor', 'satisfiesSecond', 'actorEmail']);

/** Adapter config fields — everything that is not a reserved form field. */
function readConfig(body = {}) {
  const config = {};
  for (const [key, value] of Object.entries(body)) {
    if (!RESERVED_FIELDS.has(key)) {
      config[key] = value;
    }
  }
  return config;
}

/** The chrome every tenant settings page shares. */
function tenantChrome(req, section) {
  const tenant = req.authorizedTenant;
  return {
    tenant,
    handle: tenant.handle,
    scopeLabel: 'Organization settings',
    settingsPath: `/orgs/${tenant.handle}/settings`,
    section
  };
}

/**
 * The wallets this organization has a stake in.
 *
 * Scoped to wallets holding one of its credentials, by Wallet ID for accepted
 * ones and by holder address for invited ones. The deployment-wide register
 * stays a platform surface — a tenant administrator seeing every wallet on the
 * deployment would be exactly the escalation this split exists to prevent.
 */
async function listTenantWallets(workspaceId) {
  const [wallets, scope] = await Promise.all([
    listWallets(),
    listWalletScopeForWorkspace(workspaceId)
  ]);

  return wallets
    .filter((wallet) => {
      const email = String(wallet.email || '').trim().toLowerCase();
      return scope.walletCounts.has(wallet.walletId) || (email && scope.holderEmails.has(email));
    })
    .map((wallet) => {
      const credentialCount = scope.walletCounts.get(wallet.walletId) || 0;
      return {
        walletId: wallet.walletId,
        email: wallet.email,
        phone: wallet.phone || null,
        status: wallet.status || 'active',
        isRevoked: wallet.status === 'revoked',
        revokedReason: wallet.revokedReason || null,
        revokedBy: wallet.revokedBy || null,
        registeredAt: wallet.registeredAt || wallet.createdAt || null,
        credentialCount,
        // Deleting is deliberately not offered here. A wallet may hold
        // credentials from more than one organization, so erasing it is a
        // deployment-wide act and belongs to the platform surface.
        canDelete: false
      };
    })
    .sort((left, right) => String(right.registeredAt).localeCompare(String(left.registeredAt)));
}

// --- the organization settings index ---------------------------------------

router.get(
  '/orgs/:handle/settings',
  requireAuthenticated,
  authorize('tenant.settings.view'),
  async (req, res, next) => {
    try {
      const { workspaceId } = req.authorizedTenant;
      const [adapters, wallets, identity, rootWallets, branding, peopleCounts] = await Promise.all([
        listInstances({ organizationId: workspaceId }),
        listTenantWallets(workspaceId),
        getIdentity(workspaceId),
        summarizeRootWallets(workspaceId),
        getOrganizationBranding(workspaceId),
        countCredentialsByWorkspace()
      ]);
      const peopleCount = peopleCounts.get(workspaceId) || 0;
      // A palette id is set on every organization by default, so it says
      // nothing. Branding has been configured when somebody chose a name, a
      // logo or a mark of their own.
      const brandingConfigured = Boolean(
        branding?.displayName || branding?.productName || branding?.logoDataUrl || branding?.faviconDataUrl
      );

      const activeAdapters = adapters.filter((adapter) => adapter.status === 'active').length;
      const draftAdapters = adapters.filter((adapter) => adapter.status === 'draft').length;
      const revokedWallets = wallets.filter((wallet) => wallet.isRevoked).length;
      const subscriptionId = await resolveSubscriptionIdForTenant(req.user, req.authorizedWorkspace);
      const legacyBase = subscriptionId
        ? `/organizations/${subscriptionId}/${workspaceId}`
        : null;

      res.render('pages/tenant-settings', {
        title: `${req.authorizedTenant.organization} settings`,
        description: 'Settings for this organization.',
        ...tenantChrome(req, 'index'),
        cards: [
          {
            href: `/orgs/${req.authorizedTenant.handle}/settings/adapters`,
            title: 'Authentication adapters',
            summary: 'SAML, Kerberos and certificate adapters that front sign-in for this organization.',
            stat: adapters.length,
            statLabel: adapters.length === 1 ? 'adapter' : 'adapters',
            note: authAdaptersEnabled()
              ? (adapters.length ? `${activeAdapters} active · ${draftAdapters} draft` : 'None configured yet')
              : 'Framework disabled in this environment',
            isWarning: !authAdaptersEnabled()
          },
          {
            href: `/orgs/${req.authorizedTenant.handle}/settings/wallets`,
            title: 'Registered wallets',
            summary: 'Wallets holding a credential from this organization. Withdraw one from service or restore it.',
            stat: wallets.length,
            statLabel: wallets.length === 1 ? 'wallet' : 'wallets',
            note: revokedWallets ? `${revokedWallets} withdrawn` : null,
            isWarning: revokedWallets > 0
          },
          {
            href: legacyBase ? `${legacyBase}/domain` : null,
            title: 'Organization domain',
            summary: 'Prove the domain this organization is known by, with a DNS TXT record.',
            pill: identity?.isVerified ? 'Verified' : identity?.isPending ? 'Pending' : 'Unverified',
            pillTone: identity?.isVerified ? 'ok' : identity?.isPending ? 'warn' : 'mute',
            note: identity?.domain || identity?.handle || null,
            isWarning: !identity?.isVerified
          },
          {
            href: legacyBase ? `${legacyBase}/root-wallets` : null,
            title: 'Root wallets',
            summary: 'Wallets that can recover administrative control of this organization.',
            stat: rootWallets.confirmedCount,
            statLabel: 'confirmed',
            // One is the bar to operate; three is the bar to be safe. A single
            // root wallet means one lost device strands the organization, so
            // "below the recommendation" is the warning worth showing.
            note: rootWallets.confirmedCount === 0
              ? 'None confirmed — credential issuance may be blocked'
              : rootWallets.meetsRecommended
                ? 'At the safe threshold'
                : `${rootWallets.shortOfRecommended} short of the recommended ${rootWallets.recommended}`,
            isWarning: !rootWallets.meetsRecommended
          },
          {
            href: req.authorizedWorkspace.dashboardPath
              ? `${req.authorizedWorkspace.dashboardPath}?blade=people`
              : legacyBase,
            title: 'People & roles',
            summary: 'Who belongs to this organization, and what each role may do.',
            stat: peopleCount,
            statLabel: peopleCount === 1 ? 'credential holder' : 'credential holders',
            note: 'A role marked “Administers the organization” grants these settings.'
          },
          {
            href: req.authorizedWorkspace.dashboardPath
              ? `${req.authorizedWorkspace.dashboardPath}?blade=branding`
              : legacyBase,
            title: 'Branding',
            summary: "Palette and marks applied to this organization's credentials.",
            pill: brandingConfigured ? 'Configured' : 'Default',
            pillTone: 'mute',
            note: branding?.displayName || 'Vanguard Default'
          }
        ].filter((card) => card.href)
      });
    } catch (error) {
      next(error);
    }
  }
);

// --- adapters ---------------------------------------------------------------

/** Everything the adapters page needs, scoped to one organization. */
async function renderAdapters(req, res, extra = {}) {
  const [catalog, instances] = await Promise.all([
    Promise.resolve(listCatalog()),
    listInstances({ organizationId: req.authorizedTenant.workspaceId })
  ]);

  res.render('pages/auth-adapters', {
    title: 'Authentication adapters',
    description: 'SAML, Kerberos and certificate adapters for this organization.',
    enabled: authAdaptersEnabled(),
    catalog,
    instances,
    // The page serves both this surface and the platform one; the base path is
    // what tells it where its own forms post to.
    basePath: `/orgs/${req.authorizedTenant.handle}/settings/adapters`,
    backHref: `/orgs/${req.authorizedTenant.handle}/settings`,
    backLabel: 'All organization settings',
    // Designating the deployment-wide sign-in default decides how everybody
    // signs in, so it stays a platform action and is not offered here.
    canSetSignInDefault: false,
    saved: null,
    errorMessage: null,
    testResult: null,
    ...tenantChrome(req, 'adapters'),
    ...extra
  });
}

router.get(
  '/orgs/:handle/settings/adapters',
  requireAuthenticated,
  authorize('tenant.adapters.manage'),
  async (req, res, next) => {
    try {
      await renderAdapters(req, res, {
        saved: req.query.saved || null,
        errorMessage: req.query.error || null
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/orgs/:handle/settings/adapters',
  requireAuthenticated,
  authorize('tenant.adapters.manage'),
  async (req, res, next) => {
    const base = `/orgs/${req.params.handle}/settings/adapters`;
    try {
      const { problems } = await createInstance({
        kind: req.body.kind,
        name: req.body.name,
        config: readConfig(req.body),
        actorEmail: req.user?.email,
        // Stamped from the resolved tenant, never from the form — a posted
        // organization id would be a way to write into somebody else's.
        organizationId: req.authorizedTenant.workspaceId
      });
      return res.redirect(303, `${base}?saved=${problems.length ? 'created-draft' : 'created'}`);
    } catch (error) {
      if (error.expose) {
        return res.redirect(303, `${base}?error=${encodeURIComponent(error.message)}`);
      }
      return next(error);
    }
  }
);

router.post(
  '/orgs/:handle/settings/adapters/:id',
  requireAuthenticated,
  authorize('tenant.adapters.manage'),
  async (req, res, next) => {
    const base = `/orgs/${req.params.handle}/settings/adapters`;
    const organizationId = req.authorizedTenant.workspaceId;
    try {
      if ((req.body._action || 'update') === 'delete') {
        await deleteInstance(req.params.id, { actorEmail: req.user?.email, organizationId });
        return res.redirect(303, `${base}?saved=deleted`);
      }
      await updateInstance(req.params.id, {
        name: req.body.name,
        status: req.body.status,
        firstFactor: req.body.firstFactor === 'on' || req.body.firstFactor === 'true',
        satisfiesSecond: req.body.satisfiesSecond === 'on' || req.body.satisfiesSecond === 'true',
        config: Object.keys(readConfig(req.body)).length ? readConfig(req.body) : undefined,
        actorEmail: req.user?.email,
        organizationId
      });
      return res.redirect(303, `${base}?saved=updated`);
    } catch (error) {
      if (error.expose) {
        return res.redirect(303, `${base}?error=${encodeURIComponent(error.message)}`);
      }
      return next(error);
    }
  }
);

router.post(
  '/orgs/:handle/settings/adapters/:id/test',
  requireAuthenticated,
  authorize('tenant.adapters.manage'),
  async (req, res, next) => {
    const organizationId = req.authorizedTenant.workspaceId;
    try {
      const instance = await getInstance(req.params.id, { organizationId });
      const result = await runSelfTest(req.params.id, readConfig(req.body), {
        actorEmail: req.user?.email,
        organizationId
      });
      await renderAdapters(req, res, { testResult: { id: instance.id, name: instance.name, ...result } });
    } catch (error) {
      if (error.expose) {
        return res.redirect(
          303,
          `/orgs/${req.params.handle}/settings/adapters?error=${encodeURIComponent(error.message)}`
        );
      }
      return next(error);
    }
  }
);

// --- wallets ---------------------------------------------------------------

router.get(
  '/orgs/:handle/settings/wallets',
  requireAuthenticated,
  authorize('tenant.wallets.manage'),
  async (req, res, next) => {
    try {
      const wallets = await listTenantWallets(req.authorizedTenant.workspaceId);
      res.render('pages/wallet-admin', {
        title: 'Registered wallets',
        description: 'Wallets holding a credential from this organization.',
        wallets,
        revokedCount: wallets.filter((wallet) => wallet.isRevoked).length,
        basePath: `/orgs/${req.authorizedTenant.handle}/settings/wallets`,
        backHref: `/orgs/${req.authorizedTenant.handle}/settings`,
        backLabel: 'All organization settings',
        saved: req.query.saved || null,
        errorMessage: req.query.error || null,
        ...tenantChrome(req, 'wallets')
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/orgs/:handle/settings/wallets',
  requireAuthenticated,
  authorize('tenant.wallets.manage'),
  async (req, res, next) => {
    const base = `/orgs/${req.params.handle}/settings/wallets`;
    try {
      // Re-scoped server-side: the posted Wallet ID has to be one of this
      // organization's wallets, whatever the form said.
      const scoped = await listTenantWallets(req.authorizedTenant.workspaceId);
      const target = scoped.find((wallet) => wallet.walletId === req.body.walletId);
      if (!target) {
        return res.redirect(303, `${base}?error=${encodeURIComponent('That wallet does not hold a credential from this organization.')}`);
      }

      const actor = { actorEmail: req.user?.email, reason: req.body.reason };
      if (req.body.action === 'revoke') {
        await revokeWallet(req.body.walletId, actor);
        return res.redirect(303, `${base}?saved=revoked`);
      }
      if (req.body.action === 'restore') {
        await restoreWallet(req.body.walletId, actor);
        return res.redirect(303, `${base}?saved=restored`);
      }
      return res.redirect(303, `${base}?error=${encodeURIComponent('Unknown action.')}`);
    } catch (error) {
      if (error.expose) {
        return res.redirect(303, `${base}?error=${encodeURIComponent(error.message)}`);
      }
      return next(error);
    }
  }
);

// --- stable tenant addresses for the two pages that predate this shape ------
//
// Domain and root wallets are still served by
// `/organizations/:subscriptionId/:workspaceId/...`, whose URL depends on who
// is looking. These give each one a stable address under the organization and
// translate it at the edge, so links can be shared and bookmarked. The
// `tenantAdmin` gate has already run, so the redirect never reveals a workspace
// to somebody who is not an administrator of it.

for (const [name, leaf] of [['domain', 'domain'], ['root-wallets', 'root-wallets']]) {
  router.get(
    `/orgs/:handle/settings/${name}`,
    requireAuthenticated,
    authorize('tenant.settings.view'),
    async (req, res, next) => {
      try {
        const subscriptionId = await resolveSubscriptionIdForTenant(req.user, req.authorizedWorkspace);
        if (!subscriptionId) {
          const error = new Error('No subscription on this account can reach that organization.');
          error.status = 404;
          throw error;
        }
        return res.redirect(
          302,
          `/organizations/${subscriptionId}/${req.authorizedTenant.workspaceId}/${leaf}`
        );
      } catch (error) {
        return next(error);
      }
    }
  );
}

module.exports = router;
