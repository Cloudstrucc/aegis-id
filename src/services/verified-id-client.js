const crypto = require('node:crypto');
const msal = require('@azure/msal-node');
const QRCode = require('qrcode');

const config = require('../config');

class VerifiedIdClient {
  constructor(options = {}) {
    this.config = options.config || config.verifiedId;
    this.publicBaseUrl = options.publicBaseUrl || config.app.publicBaseUrl;
    this.msalClient = null;
  }

  async createIssuanceRequest({ claims, credentialType } = {}) {
    const state = crypto.randomUUID();
    const pin = createPin();
    const payload = {
      authority: this.config.authorityDid || 'did:web:vanguardcs.ca',
      callback: this.createCallback(`${this.publicBaseUrl}/api/issuer/callback`, state),
      registration: {
        clientName: this.config.clientName
      },
      type: credentialType || this.config.credentialType,
      manifestUrl: this.config.manifestUrl || `${this.publicBaseUrl}/docs/mock-credential-manifest.json`,
      pin: {
        value: pin,
        length: pin.length
      },
      claims
    };

    return this.submitRequest('issuance', payload, state);
  }

  async createPresentationRequest({ credentialType, acceptedIssuers, requestedClaims } = {}) {
    const state = crypto.randomUUID();
    const payload = {
      authority: this.config.authorityDid || 'did:web:vanguardcs.ca',
      includeReceipt: true,
      callback: this.createCallback(`${this.publicBaseUrl}/api/verifier/callback`, state),
      registration: {
        clientName: this.config.clientName,
        purpose: 'Verify Vanguard Cloud Services employee access eligibility.'
      },
      requestedCredentials: [
        {
          type: credentialType || this.config.credentialType,
          acceptedIssuers: acceptedIssuers?.length ? acceptedIssuers : ['did:web:vanguardcs.ca'],
          configuration: {
            validation: {
              allowRevoked: false,
              validateLinkedDomain: true
            }
          },
          constraints: (requestedClaims || []).map((claimName) => ({ claimName }))
        }
      ]
    };

    return this.submitRequest('presentation', payload, state);
  }

  createCallback(url, state) {
    const callback = { url, state };
    if (this.config.callbackApiKey) {
      callback.headers = { 'api-key': this.config.callbackApiKey };
    }
    return callback;
  }

  async submitRequest(kind, payload, state) {
    if (this.config.mode !== 'live') {
      return this.createMockResponse(kind, payload, state);
    }

    this.assertLiveConfig();
    const accessToken = await this.getAccessToken();
    const endpoint =
      kind === 'issuance'
        ? `${this.config.apiBaseUrl}/createIssuanceRequest`
        : `${this.config.apiBaseUrl}/createPresentationRequest`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const body = await parseJsonResponse(response);
    if (!response.ok) {
      const error = new Error(`Verified ID ${kind} request failed.`);
      error.status = response.status;
      error.details = body;
      throw error;
    }

    return this.normalizeResponse(kind, body, payload, state);
  }

  async createMockResponse(kind, payload, state) {
    const requestUrl = `${this.publicBaseUrl}/lab/mock-wallet/${kind}/${state}`;
    return this.normalizeResponse(
      kind,
      {
        id: crypto.randomUUID(),
        url: requestUrl,
        expiry: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        pin: payload.pin?.value
      },
      payload,
      state
    );
  }

  async normalizeResponse(kind, response, payload, state) {
    const requestUrl = response.url || response.requestUrl;
    return {
      id: response.id || crypto.randomUUID(),
      kind,
      mode: this.config.mode,
      state,
      requestUrl,
      qrCodeDataUrl: requestUrl ? await QRCode.toDataURL(requestUrl, { margin: 1, width: 420 }) : null,
      pin: response.pin || payload.pin?.value || null,
      expiresAt: response.expiry || response.expiresAt || null,
      payload,
      providerResponse: response
    };
  }

  assertLiveConfig() {
    const missing = [];
    for (const [key, value] of Object.entries({
      AZURE_TENANT_ID: this.config.tenantId,
      AZURE_CLIENT_ID: this.config.clientId,
      AZURE_CLIENT_SECRET: this.config.clientSecret,
      VID_AUTHORITY_DID: this.config.authorityDid,
      VID_MANIFEST_URL: this.config.manifestUrl
    })) {
      if (!value) {
        missing.push(key);
      }
    }

    if (missing.length) {
      const error = new Error('Verified ID live mode is missing configuration.');
      error.status = 500;
      error.details = { missing };
      throw error;
    }
  }

  async getAccessToken() {
    if (!this.msalClient) {
      this.msalClient = new msal.ConfidentialClientApplication({
        auth: {
          clientId: this.config.clientId,
          authority: `https://login.microsoftonline.com/${this.config.tenantId}`,
          clientSecret: this.config.clientSecret
        },
        system: {
          loggerOptions: {
            piiLoggingEnabled: false,
            logLevel: msal.LogLevel.Error
          }
        }
      });
    }

    const result = await this.msalClient.acquireTokenByClientCredential({
      scopes: [this.config.scope],
      skipCache: false
    });

    if (!result?.accessToken) {
      throw new Error('Unable to acquire Microsoft Entra access token for Verified ID.');
    }

    return result.accessToken;
  }
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return { raw: text };
  }
}

function createPin() {
  return String(crypto.randomInt(1000, 10000));
}

module.exports = VerifiedIdClient;
