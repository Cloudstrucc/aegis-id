const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config();

const rootDir = path.resolve(__dirname, '..', '..');

function resolveFromRoot(value, fallback) {
  return path.resolve(rootDir, value || fallback);
}

const config = {
  app: {
    name: 'Vanguard Cloud Services - Aegis ID',
    env: process.env.NODE_ENV || 'development',
    port: Number.parseInt(process.env.PORT || '3000', 10),
    publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
  },
  paths: {
    root: rootDir,
    public: path.join(rootDir, 'public'),
    views: path.join(rootDir, 'views'),
    subscriptions: resolveFromRoot(process.env.SUBSCRIPTION_STORE_PATH, 'data/subscriptions.json'),
    users: resolveFromRoot(process.env.USER_STORE_PATH, 'data/users.json'),
    subscriberWorkspaces: resolveFromRoot(process.env.SUBSCRIBER_WORKSPACE_STORE_PATH, 'data/subscriber-workspaces.json'),
    transactions: resolveFromRoot(process.env.TRANSACTION_STORE_PATH, 'data/transactions.json'),
    issuerOrganizations: resolveFromRoot(process.env.ISSUER_ORG_STORE_PATH, 'data/issuer-organizations.json'),
    orgAdmin: resolveFromRoot(process.env.ORG_ADMIN_STORE_PATH, 'data/org-admin.json'),
    orgAdminEvents: resolveFromRoot(process.env.ORG_ADMIN_EVENT_STORE_PATH, 'data/org-admin-events.json'),
    oidcWalletSessions: resolveFromRoot(process.env.OIDC_WALLET_SESSION_STORE_PATH, 'data/oidc-wallet-sessions.json'),
    audit: resolveFromRoot(process.env.AUDIT_STORE_PATH, 'data/audit-events.json')
  },
  auth: {
    sessionSecret: process.env.SESSION_SECRET || 'dev-change-this-session-secret',
    passkeyRpName: process.env.PASSKEY_RP_NAME || 'Vanguard Cloud Services - Aegis ID',
    passkeyRpId: process.env.PASSKEY_RP_ID || '',
    passkeyOrigin: process.env.PASSKEY_ORIGIN || ''
  },
  verifiedId: {
    mode: process.env.VID_MODE || 'mock',
    tenantId: process.env.AZURE_TENANT_ID || '',
    clientId: process.env.AZURE_CLIENT_ID || '',
    clientSecret: process.env.AZURE_CLIENT_SECRET || '',
    scope: '3db474b9-6a0c-4840-96ac-1fceb342124f/.default',
    apiBaseUrl: 'https://verifiedid.did.msidentity.com/v1.0/verifiableCredentials',
    clientName: process.env.VID_CLIENT_NAME || 'Vanguard Cloud Services - Aegis ID',
    authorityDid: process.env.VID_AUTHORITY_DID || '',
    manifestUrl: process.env.VID_MANIFEST_URL || '',
    credentialType: process.env.VID_CREDENTIAL_TYPE || 'VanguardEmployeeCredential',
    callbackApiKey: process.env.VID_CALLBACK_API_KEY || ''
  },
  aries: {
    issuerAdminUrl: process.env.ARIES_ISSUER_ADMIN_URL || 'http://localhost:4011',
    verifierAdminUrl: process.env.ARIES_VERIFIER_ADMIN_URL || 'http://localhost:5011',
    mediatorAdminUrl: process.env.ARIES_MEDIATOR_ADMIN_URL || 'http://localhost:3011'
  },
  oidcWalletDemo: {
    mode: process.env.OIDC_WALLET_DEMO_MODE || 'mock',
    issuer: process.env.OIDC_WALLET_ISSUER || 'https://mock-idp.vanguardcs.local',
    publicBaseUrl: process.env.OIDC_WALLET_PUBLIC_BASE_URL || '',
    authorizationEndpoint:
      process.env.OIDC_WALLET_AUTHORIZATION_ENDPOINT || '/demo/oidc-wallet/mock-authorize',
    clientId: process.env.OIDC_WALLET_CLIENT_ID || 'vanguard-aegis-wallet-gated-app',
    scope: process.env.OIDC_WALLET_SCOPE || 'openid profile email',
    redirectPath: '/demo/oidc-wallet/callback',
    sessionTtlSeconds: Number.parseInt(process.env.OIDC_WALLET_SESSION_TTL_SECONDS || '900', 10)
  }
};

module.exports = config;
