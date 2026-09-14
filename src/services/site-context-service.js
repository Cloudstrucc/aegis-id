// Which site a request — or a piece of background work — is happening on.
//
// The platform used to know exactly one base URL, `config.app.publicBaseUrl`,
// and read it in thirty-odd places to build invitation links, OIDC issuers,
// recovery emails and public pages. An organization that serves Aegis ID from
// its own hostname needs every one of those to use *its* host instead, so the
// base URL has to be a property of the request (or of the organization the
// work is for), not of the deployment.
//
// This module is the only place the deployment's base URL is read. Everything
// else asks one of two questions:
//
//   - `req.site.baseUrl`            — set by the site-context middleware, for
//                                     anything that happens inside a request
//   - `baseUrlForWorkspace(id)`     — for work done on an organization's
//                                     behalf with no request in hand (imports,
//                                     scheduled notifications)
//
// Today both answer with the platform host. Custom hostnames
// (docs/plans/custom-domains-and-branding.md, phase C) change what they
// answer, not who asks.

const config = require('../config');

/** The deployment's own public origin, without a trailing slash. */
function platformBaseUrl() {
  return String(config.app.publicBaseUrl || '').replace(/\/+$/, '');
}

/** Hostname (no scheme, port kept) of the platform origin. */
function platformHost() {
  return platformBaseUrl().replace(/^https?:\/\//, '');
}

/**
 * The site a request on `hostname` belongs to.
 *
 * Phase A: every hostname is the platform site. Unknown hosts are not refused
 * yet — a developer reaching the app by IP, or App Service's own probe
 * hostname, must keep working until organization hosts exist to distinguish.
 */
function resolveSite(hostname) {
  return {
    kind: 'platform',
    hostname: String(hostname || platformHost()).toLowerCase(),
    baseUrl: platformBaseUrl(),
    workspaceId: null,
    subscriptionId: null,
    branding: null
  };
}

/**
 * The base URL to emit for an organization's own links when there is no
 * request to take it from.
 */
async function baseUrlForWorkspace(workspaceId) { // eslint-disable-line no-unused-vars
  return platformBaseUrl();
}

module.exports = {
  baseUrlForWorkspace,
  platformBaseUrl,
  platformHost,
  resolveSite
};
