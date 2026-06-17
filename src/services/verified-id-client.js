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
      manifest: this.config.manifestUrl || `${this.publicBaseUrl}/docs/mock-credential-manifest.json`,
      pin: {
        value: pin,
        length: pin.length
      },
      claims
    };

    return this.submitRequest('issuance', payload, state);
  }

  async createPresentationRequest({ credentialType, acceptedIssuers, constraints, requestedClaims, purpose, clientName } = {}) {
    const state = crypto.randomUUID();
    const presentationPurpose = purpose || 'Verify Vanguard Cloud Services employee access eligibility.';
    const requestedCredential = {
      type: credentialType || this.config.credentialType,
      purpose: presentationPurpose,
      acceptedIssuers: acceptedIssuers?.length ? acceptedIssuers : ['did:web:vanguardcs.ca'],
      configuration: {
        validation: {
          allowRevoked: false,
          validateLinkedDomain: true
        }
      }
    };
    const normalizedConstraints = normalizePresentationConstraints(constraints || requestedClaims);
    if (normalizedConstraints.length) {
      requestedCredential.constraints = normalizedConstraints;
    }

    const payload = {
      authority: this.config.authorityDid || 'did:web:vanguardcs.ca',
      includeReceipt: true,
      callback: this.createCallback(`${this.publicBaseUrl}/api/verifier/callback`, state),
      registration: {
        clientName: clientName || this.config.clientName,
        purpose: presentationPurpose
      },
      requestedCredentials: [requestedCredential]
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
      throw createVerifiedIdHttpError(kind, response, body);
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

function normalizePresentationConstraints(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((constraint) => constraint && typeof constraint === 'object')
    .map((constraint) => ({
      claimName: constraint.claimName,
      ...(Array.isArray(constraint.values) && constraint.values.length ? { values: constraint.values } : {}),
      ...(constraint.contains ? { contains: constraint.contains } : {}),
      ...(constraint.startsWith ? { startsWith: constraint.startsWith } : {})
    }))
    .filter(
      (constraint) =>
        constraint.claimName && (constraint.values?.length || constraint.contains || constraint.startsWith)
    );
}

function createVerifiedIdHttpError(kind, response, body = {}) {
  const providerCode = body?.error?.innererror?.code || body?.error?.code || null;
  const providerMessage = body?.error?.innererror?.message || body?.error?.message || response.statusText;
  const providerTarget = body?.error?.innererror?.target || null;
  const accessTokenMissingRoles =
    providerCode === 'invalid_aad_access_token' && /contains no roles|no roles/i.test(providerMessage);
  const issuanceMissingManifest =
    providerCode === 'badOrMissingField' && (providerTarget === 'manifest' || /manifest/i.test(providerMessage));
  const authorityMismatch =
    providerCode === 'badOrMissingField' &&
    providerTarget === 'authority' &&
    /did not match an existing authority/i.test(providerMessage);
  const invalidPresentationConstraint =
    providerCode === 'badOrMissingField' &&
    /^requestedCredentials\[\d+\]\.constraints\[\d+\]/.test(providerTarget || '') &&
    /values, contains or startsWith/i.test(providerMessage);

  const error = new Error(
    accessTokenMissingRoles
      ? 'Verified ID access token has no application roles.'
      : issuanceMissingManifest
        ? 'Verified ID issuance request is missing the credential manifest.'
        : authorityMismatch
          ? 'Verified ID authority DID does not match an existing authority.'
        : invalidPresentationConstraint
          ? 'Verified ID presentation constraint is missing a filter.'
      : `Verified ID ${kind} request failed.`
  );
  error.status =
    accessTokenMissingRoles || issuanceMissingManifest || authorityMismatch || invalidPresentationConstraint
      ? 400
      : 502;
  error.details = {
    providerStatus: response.status,
    providerCode,
    providerMessage,
    providerTarget,
    providerRequestId: body.requestId || null,
    providerDate: body.date || null,
    providerCorrelation: body.mscv || null,
    ...(accessTokenMissingRoles
      ? {
          recommendedFix:
            'Grant the Verifiable Credentials Service Request API application permission VerifiableCredential.Create.All to the Entra app registration, grant admin consent, then rerun the test with a fresh client secret.',
          portalChecklist: [
            'Confirm the wizard Client ID is the app registration that calls Microsoft Entra Verified ID.',
            'Add API permission: APIs my organization uses > Verifiable Credentials Service Request > Application permission > VerifiableCredential.Create.All.',
            'Select Grant admin consent for the Cloudstrucc/Vanguard tenant.',
            'Use a current client secret for that same app registration.'
          ],
          docs: [
            'https://learn.microsoft.com/en-us/entra/verified-id/verifiable-credentials-configure-tenant#grant-permissions-to-get-access-tokens',
            'https://learn.microsoft.com/en-us/entra/verified-id/get-started-request-api#api-access-token'
          ]
        }
      : issuanceMissingManifest
        ? {
            recommendedFix:
              'Copy the manifest URL from the Microsoft Entra Verified ID credential page and paste it into the Credential manifest URL field. Aegis ID maps that value to the Request Service API manifest property.',
            portalChecklist: [
              'Open Microsoft Entra admin center > Verified ID > Credentials.',
              'Create or open the credential contract you want to issue.',
              'Select Issue credential.',
              'Copy the manifest URL from the Request Service API payload.',
              'Paste it into Aegis ID > Microsoft Entra Verified ID > Credential Contract > Credential manifest URL.'
            ],
            docs: [
              'https://learn.microsoft.com/en-us/entra/verified-id/verifiable-credentials-configure-issuer#gather-credentials-and-environment-details',
              'https://learn.microsoft.com/en-us/entra/verified-id/issuance-request-api#issuance-request-payload'
            ]
          }
        : authorityMismatch
          ? {
              recommendedFix:
                'Copy the authority DID from the Microsoft Entra Verified ID Issue credential payload and paste it into Issuer authority DID. It must belong to the same tenant and credential contract as the manifest URL.',
              portalChecklist: [
                'Open Microsoft Entra admin center > Verified ID > Credentials.',
                'Open the credential contract being tested.',
                'Select Issue credential.',
                'Copy the authority value exactly, including did:web:verifiedid.entra.microsoft.com and all tenant/authority segments.',
                'Paste it into Aegis ID > Microsoft Entra Verified ID > Verified ID Service > Issuer authority DID.',
                'Confirm the tenant ID in the authority DID matches the tenant ID in the manifest URL.'
              ],
              docs: [
                'https://learn.microsoft.com/en-us/entra/verified-id/verifiable-credentials-configure-issuer#gather-credentials-and-environment-details',
                'https://learn.microsoft.com/en-us/entra/verified-id/issuance-request-api#issuance-request-payload'
              ]
            }
        : invalidPresentationConstraint
          ? {
              recommendedFix:
                'Remove bare claim-name constraints or provide a filter for each constraint. Microsoft Verified ID constraints require values, contains, or startsWith.',
              portalChecklist: [
                'Use constraints only when filtering presented credential claims.',
                'For equality-style filters, set values to an array such as ["active"].',
                'For substring filters, set contains.',
                'For prefix filters, set startsWith.',
                'Do not send a constraint object with only claimName.'
              ],
              docs: ['https://learn.microsoft.com/en-us/entra/verified-id/presentation-request-api']
            }
      : {}),
    providerResponse: body
  };
  return error;
}

module.exports = VerifiedIdClient;
