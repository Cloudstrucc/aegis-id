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
    displayName: 'Aegis ID',
    productName: 'Aegis ID',
    // The platform chrome (header, hero, footer) is dark navy, so the reversed
    // lockup is the one that reads. The favicon uses the colour mark.
    logoUrl: '/images/brand/aegis-id-lockup-white.svg',
    faviconUrl: '/images/brand/aegis-mark.svg',
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
  const platform = { displayName: 'Aegis ID', productName: 'Aegis ID' };
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

function platformSite(hostname) {
  return {
    kind: 'platform',
    hostname: String(hostname || platformHost()).toLowerCase(),
    baseUrl: platformBaseUrl(),
    workspaceId: null,
    subscriptionId: null,
    handle: null,
    branding: platformBranding()
  };
}

/**
 * The platform site for a hostname, without consulting organization hosts.
 * What the synchronous callers get; requests go through resolveSiteForRequest.
 */
function resolveSite(hostname) {
  return platformSite(hostname);
}

// Organization sites are looked up per request, so the answer is held for a
// short while: the identity store and the organization's branding are JSON
// files, and reading both on every asset request would be silly. A branding
// change shows on the host within this window.
const SITE_CACHE_TTL_MS = 30 * 1000;
const siteCache = new Map();

/**
 * The site a request on `hostname` belongs to: the organization whose active
 * hosted hostname it is, otherwise the platform.
 *
 * A hostname bound to nobody is the platform site rather than a refusal. A
 * developer reaching the app by IP, App Service's own probe hostname and a
 * customer whose CNAME has just started resolving all land here, and none of
 * them may be shown another organization's branding — the platform's is the
 * one safe answer.
 */
async function resolveSiteForRequest(hostname) {
  const host = String(hostname || '').toLowerCase().split(':')[0];
  const cached = siteCache.get(host);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.site;
  }

  let site = platformSite(hostname);
  // Lazy: these services build URLs through this module.
  const identityService = require('./organization-identity-service');
  const identity = await identityService.findHostedIdentity(host);
  if (identity && await hostingStillEntitled(identity.subscriptionId)) {
    const orgAdmin = require('./org-admin-service');
    const state = await orgAdmin.getOrCreateState({ id: identity.workspaceId, organization: identity.organization });
    site = {
      kind: 'organization',
      hostname: host,
      baseUrl: identity.hosting.baseUrl,
      workspaceId: identity.workspaceId,
      subscriptionId: identity.subscriptionId,
      handle: identity.handle,
      branding: normalizeBranding({
        ...state.branding,
        // The workspace name stands in until the organization sets one.
        displayName: state.branding?.displayName || identity.organization || state.organizationName
      })
    };
  }
  siteCache.set(host, { site, expiresAt: Date.now() + SITE_CACHE_TTL_MS });
  return site;
}

function forgetSiteCache() {
  siteCache.clear();
}

// A vanity host is a paid convenience. If the owning subscription's plan no
// longer entitles it — lapsed, or downgraded off Enterprise — the host stops
// resolving to the organization and falls back to the platform, without a
// background job flipping records. Credentials are untouched; only the host
// reverts. Checked here rather than at bind time so a lapse takes effect on
// its own. Errors fail open to "still hosting" so a transient read does not
// knock a customer's domain offline.
async function hostingStillEntitled(subscriptionId) {
  if (!subscriptionId) {
    return true;
  }
  try {
    const { getSubscription } = require('./subscription-service');
    const { assertCanUseCustomDomain } = require('./plan-service');
    const subscription = await getSubscription(subscriptionId);
    if (!subscription) {
      return true;
    }
    assertCanUseCustomDomain(subscription);
    return true;
  } catch (error) {
    return error.status === 402 ? false : true;
  }
}

/**
 * The base URL to emit for an organization's own links when there is no
 * request to take it from: its hosted hostname once active, the platform
 * until then.
 */
async function baseUrlForWorkspace(workspaceId) {
  if (!workspaceId) {
    return platformBaseUrl();
  }
  const identityService = require('./organization-identity-service');
  const hosted = await identityService.hostedBaseUrlForWorkspace(workspaceId);
  return hosted || platformBaseUrl();
}

module.exports = {
  baseUrlForWorkspace,
  forgetSiteCache,
  resolveSiteForRequest,
  normalizeBranding,
  platformBranding,
  platformBaseUrl,
  platformHost,
  resolveSite
};
