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

/**
 * What the platform host looks like. An organization's own branding (phase C)
 * has the same shape, so a template never needs to know which it was given.
 *
 * `appName` is what goes in <title>; it is the pair joined, or one of them
 * alone when they are the same — an organization that calls both itself and
 * its portal "Contoso ID" does not want "Contoso ID - Contoso ID".
 */
function platformBranding() {
  return normalizeBranding({
    displayName: 'Vanguard Cloud Services',
    productName: 'Aegis ID',
    logoUrl: '/images/vanguard-cloud-services-logo.png',
    faviconUrl: '',
    supportEmail: config.app.supportEmail || '',
    // The platform is Aegis ID; it does not say "powered by" itself.
    poweredByHidden: true,
    isPlatform: true
  });
}

/**
 * Fill in the derived fields of a branding record. Accepts the organization
 * record from org-admin (`logoDataUrl`) as well as the platform's own
 * (`logoUrl`), and always yields something a template can render.
 */
function normalizeBranding(input = {}) {
  const platform = { displayName: 'Vanguard Cloud Services', productName: 'Aegis ID' };
  const displayName = String(input.displayName || '').trim() || platform.displayName;
  // A blank product name keeps "Aegis ID" — the blade says so — rather than
  // leaving the sign-in page saying "Sign in to Contoso." for an
  // organization that only set its name.
  const productName = String(input.productName || '').trim() || platform.productName;
  const logoUrl = String(input.logoDataUrl || input.logoUrl || '').trim();
  return {
    displayName,
    productName,
    appName: productName && productName !== displayName ? `${displayName} - ${productName}` : displayName,
    // The short name for prose: "Sign in to Aegis ID", "Your Contoso ID code".
    shortName: productName || displayName,
    logoUrl,
    logoAlt: displayName,
    faviconUrl: String(input.faviconDataUrl || input.faviconUrl || '').trim(),
    supportEmail: String(input.supportEmail || '').trim(),
    poweredByHidden: Boolean(input.poweredByHidden),
    isPlatform: Boolean(input.isPlatform),
    primaryColor: input.primaryColor || '',
    accentColor: input.accentColor || ''
  };
}

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
    branding: platformBranding()
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
  normalizeBranding,
  platformBranding,
  platformBaseUrl,
  platformHost,
  resolveSite
};
