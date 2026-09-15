// Routing rules that apply only on an organization's own hostname.
//
// The same application serves every host, so most paths behave identically —
// sign-in, dashboards, invitations, OIDC, the wallet API. This narrows the few
// that must not: a customer's domain is not a place to sell Aegis plans, to
// administer the platform, or to speak for another organization. Those redirect
// to the platform host. And the root of an organization host is that
// organization's public page, not the Aegis marketing home.

const { platformBaseUrl } = require('../services/site-context-service');

// Paths that belong to the platform, never to a customer's domain. Prefix
// matched, so `/admin/anything` is covered.
const PLATFORM_ONLY_PREFIXES = ['/subscribe', '/plans', '/checkout', '/admin', '/auth/register', '/testing'];

function organizationHostRouting(req, res, next) {
  const site = req.site;
  if (!site || site.kind !== 'organization') {
    return next();
  }

  const path = req.path;

  // The root is the organization's public page.
  if (path === '/') {
    return res.redirect(302, `/orgs/${site.handle}`);
  }

  // A handle that is not this host's own is another organization; its page
  // lives on the platform host, which is the one place allowed to speak for
  // every organization at once.
  if (path.startsWith('/orgs/')) {
    const handle = path.split('/')[2];
    if (handle && handle !== site.handle) {
      return res.redirect(302, `${platformBaseUrl()}${req.originalUrl}`);
    }
    return next();
  }

  if (PLATFORM_ONLY_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return res.redirect(302, `${platformBaseUrl()}${req.originalUrl}`);
  }

  // A workspace-scoped route for a workspace other than this host's is not this
  // organization's business, even for a signed-in user who administers both.
  // `/dashboard/<sub>/orgs/<wsid>/…` and `/organizations/<sub>/<wsid>/…`.
  const dashboard = path.match(/^\/dashboard\/[^/]+\/orgs\/([^/]+)/);
  const organizations = path.match(/^\/organizations\/[^/]+\/([^/]+)/);
  const workspaceId = dashboard?.[1] || organizations?.[1];
  if (workspaceId && workspaceId !== site.workspaceId) {
    return res.status(404).render('pages/not-found', {
      title: 'Not found',
      description: 'That workspace is not served from this domain.'
    });
  }

  return next();
}

module.exports = { organizationHostRouting };
