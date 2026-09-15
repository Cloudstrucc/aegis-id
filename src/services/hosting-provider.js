// Binding a custom hostname on the platform's own infrastructure.
//
// Two providers, chosen by CUSTOM_HOSTING_PROVIDER:
//
//   - `manual`  — the record goes live the moment its CNAME points here; an
//                 operator has bound the hostname and certificate on the host
//                 by hand. Nothing to call. This is what local and any
//                 non-Azure deployment use.
//   - `azure`   — App Service binds the hostname and issues a free managed
//                 certificate, via the ARM REST API, authenticated as the
//                 site's own managed identity. No publishing credentials.
//
// The identity-service owns the record and the DNS check; this owns only the
// "make the platform actually answer for this hostname" step, so it returns
// whether the host is ready to serve and, if not, why.

const config = require('../config');

function provider() {
  return String(config.hosting?.provider || 'none').toLowerCase();
}

/**
 * Make the platform serve `hostname`. Returns:
 *   { ready: true }                      — bound and certificated, go live
 *   { ready: false, pending: 'tls', … }  — accepted, certificate still issuing
 *   throws validationError               — the platform refused the binding
 *
 * `manual` is always ready: the check that the CNAME resolves has already
 * passed, and the operator is responsible for the binding.
 */
async function bindHostname(hostname) {
  if (provider() !== 'azure') {
    return { ready: true };
  }
  return bindOnAzure(hostname);
}

/** Remove a binding when hosting is disabled. Best-effort; never throws. */
async function unbindHostname(hostname) {
  if (provider() !== 'azure') {
    return;
  }
  try {
    await unbindOnAzure(hostname);
  } catch (error) {
    // A binding that is already gone, or an ARM hiccup, must not stop the
    // record being marked disabled — that is the state that matters.
  }
}

// ---------------------------------------------------------------------------
// Azure App Service

const ARM = 'https://management.azure.com';
const API_VERSION = '2023-12-01';
let credentialCache = null;

function armCredential() {
  if (!credentialCache) {
    const {
      AzureCliCredential,
      AzureDeveloperCliCredential,
      ChainedTokenCredential,
      ManagedIdentityCredential
    } = require('@azure/identity');
    // The site's managed identity in production; a developer's CLI login when
    // the calls are run locally. Same chain the DID:web signer uses.
    credentialCache = new ChainedTokenCredential(
      new ManagedIdentityCredential(),
      new AzureCliCredential(),
      new AzureDeveloperCliCredential()
    );
  }
  return credentialCache;
}

function siteScope() {
  const { subscriptionId, resourceGroup, siteName } = config.hosting.azure || {};
  if (!subscriptionId || !resourceGroup || !siteName) {
    const error = new Error('Custom hosting is not fully configured on this deployment. An administrator must set the App Service subscription, resource group and site name.');
    error.status = 500;
    throw error;
  }
  return { subscriptionId, resourceGroup, siteName };
}

async function arm(method, url, body) {
  const token = await armCredential().getToken(`${ARM}/.default`);
  if (!token?.token) {
    const error = new Error('The platform could not authenticate to Azure to bind the hostname.');
    error.status = 502;
    throw error;
  }
  const response = await fetch(`${ARM}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token.token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = payload?.error?.message || payload?.Message || `Azure returned ${response.status}.`;
    const error = new Error(message);
    error.status = response.status === 404 ? 409 : 502;
    error.expose = true;
    throw error;
  }
  return payload;
}

async function bindOnAzure(hostname) {
  const { subscriptionId, resourceGroup, siteName } = siteScope();
  const base = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${siteName}`;
  const host = encodeURIComponent(hostname);

  // 1. The hostname binding itself, initially with no certificate. Idempotent —
  //    re-binding an existing hostname is a no-op that returns the binding.
  await arm('PUT', `${base}/hostNameBindings/${host}?api-version=${API_VERSION}`, {
    properties: { siteName, hostNameType: 'Verified', sslState: 'Disabled' }
  });

  // 2. The free managed certificate. It is a resource in the resource group,
  //    validated through the binding we just made. If it already exists this
  //    returns it; if it is still being issued, ARM answers 202 and the
  //    thumbprint is not yet present.
  const certName = `aegis-${hostname.replace(/[^a-zA-Z0-9]/g, '-')}`;
  let certificate;
  try {
    certificate = await arm('PUT', `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/certificates/${certName}?api-version=${API_VERSION}`, {
      location: await siteLocation(base),
      properties: { canonicalName: hostname, serverFarmId: await serverFarmId(base) }
    });
  } catch (error) {
    // Managed certificate issuance is asynchronous and occasionally answers an
    // error while the domain-ownership check settles; treat it as still-issuing
    // rather than a hard failure, so a re-check completes it.
    return { ready: false, pending: 'tls', detail: error.message };
  }

  const thumbprint = certificate?.properties?.thumbprint;
  if (!thumbprint) {
    return { ready: false, pending: 'tls' };
  }

  // 3. Bind the certificate to the hostname (SNI SSL).
  await arm('PUT', `${base}/hostNameBindings/${host}?api-version=${API_VERSION}`, {
    properties: { siteName, hostNameType: 'Verified', sslState: 'SniEnabled', thumbprint }
  });

  return { ready: true, thumbprint };
}

async function unbindOnAzure(hostname) {
  const { subscriptionId, resourceGroup, siteName } = siteScope();
  const base = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites/${siteName}`;
  await arm('DELETE', `${base}/hostNameBindings/${encodeURIComponent(hostname)}?api-version=${API_VERSION}`);
}

let siteCache = null;
async function siteProperties(base) {
  if (!siteCache) {
    siteCache = await arm('GET', `${base}?api-version=${API_VERSION}`);
  }
  return siteCache;
}
async function siteLocation(base) {
  return (await siteProperties(base)).location;
}
async function serverFarmId(base) {
  return (await siteProperties(base)).properties?.serverFarmId;
}

module.exports = { bindHostname, unbindHostname, provider };
