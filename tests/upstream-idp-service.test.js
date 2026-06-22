const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('upstream service creates an Entra authorization redirect with PKCE and stored state', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-upstream-service-'));
  const previous = captureEnv(ENV_KEYS);
  configureUpstreamEnv(tempDir);
  resetModules();

  t.after(() => {
    restoreEnv(previous);
    resetModules();
  });

  const {
    getConfiguredProvider,
    isUpstreamFederationEnabled,
    startUpstreamAuthorization
  } = require('../src/services/upstream-idp-service');

  assert.equal(isUpstreamFederationEnabled(), true);
  const provider = getConfiguredProvider('http://localhost:3000');
  assert.equal(provider.enabled, true);
  assert.equal(provider.issuer, 'https://login.microsoftonline.com/tenant-id/v2.0');

  const result = await startUpstreamAuthorization({
    baseUrl: 'http://localhost:3000',
    app: {
      id: 'app-1',
      workspaceId: 'workspace-1',
      clientId: 'aegis_test_client'
    },
    request: {
      clientId: 'aegis_test_client',
      redirectUri: 'https://portal.example.com/signin-oidc',
      responseType: 'code',
      scope: 'openid profile email',
      state: 'rp-state',
      nonce: 'rp-nonce',
      loginHint: 'person@example.com'
    }
  });

  const redirect = new URL(result.redirectUrl);
  assert.equal(redirect.origin, 'https://login.microsoftonline.com');
  assert.equal(redirect.pathname, '/tenant-id/oauth2/v2.0/authorize');
  assert.equal(redirect.searchParams.get('client_id'), 'entra-client-id');
  assert.equal(redirect.searchParams.get('response_type'), 'code');
  assert.equal(redirect.searchParams.get('redirect_uri'), 'http://localhost:3000/oauth2/upstream/entra/callback');
  assert.equal(redirect.searchParams.get('scope'), 'openid profile email');
  assert.equal(redirect.searchParams.get('code_challenge_method'), 'S256');
  assert.match(redirect.searchParams.get('state'), /^up_/);
  assert.ok(redirect.searchParams.get('nonce'));
  assert.ok(redirect.searchParams.get('code_challenge'));
  assert.equal(redirect.searchParams.get('login_hint'), 'person@example.com');

  const states = JSON.parse(await fs.readFile(process.env.CONNECTED_APP_UPSTREAM_STATE_STORE_PATH, 'utf8'));
  assert.equal(states.length, 1);
  assert.equal(states[0].id, redirect.searchParams.get('state'));
  assert.equal(states[0].request.state, 'rp-state');
  assert.equal(states[0].request.nonce, 'rp-nonce');
  assert.match(states[0].codeVerifier, /^[A-Za-z0-9_-]+$/);
});

test('connected app authorize endpoint brokers unauthenticated sign-in to upstream Entra', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-upstream-route-'));
  const previous = captureEnv(ENV_KEYS);
  configureUpstreamEnv(tempDir);
  process.env.CONNECTED_APP_STORE_PATH = path.join(tempDir, 'connected-apps.json');
  process.env.CONNECTED_APP_LOG_STORE_PATH = path.join(tempDir, 'connected-app-logs.json');
  process.env.CONNECTED_APP_OAUTH_CODE_STORE_PATH = path.join(tempDir, 'connected-app-codes.json');
  process.env.CONNECTED_APP_SIGNING_KEY_STORE_PATH = path.join(tempDir, 'connected-app-keys.json');
  process.env.SESSION_SECRET = 'test-session-secret';

  await fs.writeFile(process.env.CONNECTED_APP_STORE_PATH, JSON.stringify([seedConnectedApp()], null, 2), 'utf8');
  resetModules();

  const { createApp } = require('../src/app');
  const server = await new Promise((resolve) => {
    const instance = createApp().listen(0, () => resolve(instance));
  });

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    restoreEnv(previous);
    resetModules();
  });

  const port = server.address().port;
  const url = new URL(`http://127.0.0.1:${port}/oauth2/authorize`);
  url.searchParams.set('client_id', 'aegis_test_client');
  url.searchParams.set('redirect_uri', 'https://portal.example.com/signin-oidc');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', 'rp-state');
  url.searchParams.set('nonce', 'rp-nonce');

  const response = await fetch(url, { redirect: 'manual' });
  assert.equal(response.status, 303);
  const location = response.headers.get('location');
  assert.ok(location);
  const redirect = new URL(location);
  assert.equal(redirect.hostname, 'login.microsoftonline.com');
  assert.equal(redirect.searchParams.get('client_id'), 'entra-client-id');
  assert.equal(redirect.searchParams.get('redirect_uri'), 'http://localhost:3000/oauth2/upstream/entra/callback');
  assert.match(redirect.searchParams.get('state'), /^up_/);

  const states = JSON.parse(await fs.readFile(process.env.CONNECTED_APP_UPSTREAM_STATE_STORE_PATH, 'utf8'));
  assert.equal(states[0].request.clientId, 'aegis_test_client');
  assert.equal(states[0].request.redirectUri, 'https://portal.example.com/signin-oidc');

  const logs = JSON.parse(await fs.readFile(process.env.CONNECTED_APP_LOG_STORE_PATH, 'utf8'));
  assert.equal(logs.some((row) => row.eventType === 'oauth.upstream.redirected'), true);
});

const ENV_KEYS = [
  'APP_ENV',
  'APP_PUBLIC_BASE_URL',
  'PUBLIC_BASE_URL',
  'CONNECTED_APP_STORE_PATH',
  'CONNECTED_APP_LOG_STORE_PATH',
  'CONNECTED_APP_OAUTH_CODE_STORE_PATH',
  'CONNECTED_APP_SIGNING_KEY_STORE_PATH',
  'CONNECTED_APP_UPSTREAM_STATE_STORE_PATH',
  'CONNECTED_APP_UPSTREAM_IDP_MODE',
  'CONNECTED_APP_UPSTREAM_ENTRA_TENANT_ID',
  'CONNECTED_APP_UPSTREAM_ENTRA_CLIENT_ID',
  'CONNECTED_APP_UPSTREAM_ENTRA_CLIENT_SECRET',
  'CONNECTED_APP_UPSTREAM_ENTRA_REDIRECT_URI',
  'CONNECTED_APP_UPSTREAM_ENTRA_SCOPES',
  'SESSION_SECRET'
];

function configureUpstreamEnv(tempDir) {
  process.env.APP_ENV = 'test';
  process.env.APP_PUBLIC_BASE_URL = 'http://localhost:3000';
  process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
  process.env.CONNECTED_APP_UPSTREAM_STATE_STORE_PATH = path.join(tempDir, 'upstream-states.json');
  process.env.CONNECTED_APP_UPSTREAM_IDP_MODE = 'entra';
  process.env.CONNECTED_APP_UPSTREAM_ENTRA_TENANT_ID = 'tenant-id';
  process.env.CONNECTED_APP_UPSTREAM_ENTRA_CLIENT_ID = 'entra-client-id';
  process.env.CONNECTED_APP_UPSTREAM_ENTRA_CLIENT_SECRET = 'entra-client-secret';
  process.env.CONNECTED_APP_UPSTREAM_ENTRA_REDIRECT_URI = 'http://localhost:3000/oauth2/upstream/entra/callback';
  process.env.CONNECTED_APP_UPSTREAM_ENTRA_SCOPES = 'openid profile email';
}

function seedConnectedApp() {
  const now = new Date().toISOString();
  return {
    id: 'app-upstream',
    workspaceId: 'workspace-upstream',
    subscriptionId: 'sub-upstream',
    name: 'Power Pages Portal',
    description: 'Portal relying party.',
    clientId: 'aegis_test_client',
    status: 'enabled',
    appType: 'web',
    redirectUris: ['https://portal.example.com/signin-oidc'],
    postLogoutRedirectUris: [],
    allowedOrigins: ['https://portal.example.com'],
    grantTypes: ['authorization_code'],
    scopes: ['openid', 'profile', 'email'],
    claimKeys: ['sub', 'email', 'name', 'organization_id', 'roles', 'acr', 'auth_time'],
    onboardingMode: 'invite-only',
    walletChallengePolicy: 'wallet',
    tokenEndpointAuthMethod: 'client_secret_post',
    branding: {},
    emailTemplates: {},
    messages: {},
    secretCredentials: [],
    certificateCredentials: [],
    createdAt: now,
    updatedAt: now
  };
}

function captureEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function resetModules() {
  for (const modulePath of Object.keys(require.cache)) {
    if (modulePath.includes(`${path.sep}src${path.sep}`)) {
      delete require.cache[modulePath];
    }
  }
}
