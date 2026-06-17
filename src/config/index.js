const path = require('node:path');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '..', '..');
dotenv.config({ path: resolveEnvFile(rootDir) });

function resolveFromRoot(value, fallback) {
  return path.resolve(rootDir, value || fallback);
}

function resolveEnvFile(baseDir) {
  const envName =
    process.env.APP_ENV ||
    process.env.DEPLOY_ENV ||
    (process.env.NODE_ENV === 'production' ? 'prod' : 'local');

  const fileNameByEnv = {
    prod: '.env',
    production: '.env',
    local: '.env.local',
    localhost: '.env.local',
    dev: '.env.dev',
    development: '.env.dev',
    qa: '.env.qa',
    test: '.env.qa'
  };

  return path.join(baseDir, fileNameByEnv[envName] || envName || '.env.local');
}

const config = {
  app: {
    name: 'Vanguard Cloud Services - Aegis ID',
    env: process.env.NODE_ENV || 'development',
    port: Number.parseInt(process.env.PORT || '3000', 10),
    publicBaseUrl: process.env.PUBLIC_BASE_URL || process.env.APP_PUBLIC_BASE_URL || 'http://localhost:3000',
    iosTestFlightUrl: process.env.IOS_TESTFLIGHT_PUBLIC_URL || '',
    androidTestingUrl: process.env.ANDROID_TESTING_URL || '',
    businessExpensesUrl:
      process.env.BUSINESS_EXPENSES_APP_URL ||
      (process.env.NODE_ENV === 'production'
        ? 'https://vanguard-business-expenses-65067d.azurewebsites.net'
        : 'http://localhost:4300')
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
    oidcCodes: resolveFromRoot(process.env.OIDC_CODE_STORE_PATH, 'data/oidc-codes.json'),
    walletChallenges: resolveFromRoot(process.env.WALLET_CHALLENGE_STORE_PATH, 'data/wallet-challenges.json'),
    audit: resolveFromRoot(process.env.AUDIT_STORE_PATH, 'data/audit-events.json')
  },
  auth: {
    sessionSecret: process.env.SESSION_SECRET || 'dev-change-this-session-secret',
    defaultMfaMethod: process.env.DEFAULT_MFA_METHOD || 'email',
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
    holderAdminUrl: process.env.ARIES_HOLDER_ADMIN_URL || 'http://localhost:6011',
    issuerAdminUrl: process.env.ARIES_ISSUER_ADMIN_URL || 'http://localhost:4011',
    verifierAdminUrl: process.env.ARIES_VERIFIER_ADMIN_URL || 'http://localhost:5011',
    mediatorAdminUrl: process.env.ARIES_MEDIATOR_ADMIN_URL || 'http://localhost:3011',
    holderAdminApiKey: process.env.ARIES_HOLDER_ADMIN_API_KEY || process.env.ARIES_ADMIN_API_KEY || '',
    issuerAdminApiKey: process.env.ARIES_ISSUER_ADMIN_API_KEY || process.env.ARIES_ADMIN_API_KEY || '',
    verifierAdminApiKey: process.env.ARIES_VERIFIER_ADMIN_API_KEY || process.env.ARIES_ADMIN_API_KEY || '',
    mediatorAdminApiKey: process.env.ARIES_MEDIATOR_ADMIN_API_KEY || process.env.ARIES_ADMIN_API_KEY || ''
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
