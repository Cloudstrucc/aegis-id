const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('connected app service registers clients, issues tokens, and records logs', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-connected-apps-'));
  const previous = captureEnv([
    'CONNECTED_APP_STORE_PATH',
    'CONNECTED_APP_LOG_STORE_PATH',
    'CONNECTED_APP_OAUTH_CODE_STORE_PATH',
    'CONNECTED_APP_SIGNING_KEY_STORE_PATH',
    'CONNECTED_APP_SECRET_ENCRYPTION_KEY',
    'WALLET_CHALLENGE_STORE_PATH',
    'ORG_ADMIN_STORE_PATH',
    'ORG_ADMIN_EVENT_STORE_PATH',
    'SUBSCRIBER_WORKSPACE_STORE_PATH',
    'APP_PUBLIC_BASE_URL'
  ]);
  process.env.CONNECTED_APP_STORE_PATH = path.join(tempDir, 'connected-apps.json');
  process.env.CONNECTED_APP_LOG_STORE_PATH = path.join(tempDir, 'connected-app-logs.json');
  process.env.CONNECTED_APP_OAUTH_CODE_STORE_PATH = path.join(tempDir, 'connected-app-oauth-codes.json');
  process.env.CONNECTED_APP_SIGNING_KEY_STORE_PATH = path.join(tempDir, 'connected-app-keys.json');
  process.env.CONNECTED_APP_SECRET_ENCRYPTION_KEY = 'test-connected-app-secret-encryption-key';
  process.env.WALLET_CHALLENGE_STORE_PATH = path.join(tempDir, 'wallet-challenges.json');
  process.env.ORG_ADMIN_STORE_PATH = path.join(tempDir, 'org-admin.json');
  process.env.ORG_ADMIN_EVENT_STORE_PATH = path.join(tempDir, 'org-events.json');
  process.env.SUBSCRIBER_WORKSPACE_STORE_PATH = path.join(tempDir, 'workspaces.json');
  process.env.APP_PUBLIC_BASE_URL = 'http://localhost:3000';
  resetModules();

  t.after(() => {
    restoreEnv(previous);
    resetModules();
  });

  const workspace = {
    id: 'workspace-connected',
    subscriptionId: 'sub-connected',
    organization: 'Connected Org',
    ownerEmail: 'admin@example.com',
    members: [{ email: 'admin@example.com', role: 'administrator', addedAt: new Date().toISOString() }],
    platforms: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const subscription = {
    id: 'sub-connected',
    email: 'admin@example.com',
    organization: 'Connected Org'
  };
  await fs.writeFile(process.env.SUBSCRIBER_WORKSPACE_STORE_PATH, JSON.stringify([workspace], null, 2), 'utf8');

  const {
    authenticateConnectedClient,
    createClientCredentialsToken,
    createConnectedApp,
    createConnectedAppSecret,
    createConnectedAuthorizationCode,
    exchangeConnectedAuthorizationCode,
    exportConnectedAppLogsCsv,
    getConnectedAppsView,
    importConnectedAppCertificate,
    verifyAccessToken
  } = require('../src/services/connected-app-service');

  const app = await createConnectedApp(workspace, subscription, {
    name: 'Example Portal',
    description: 'OIDC relying party for test users.',
    appType: 'web',
    redirectUris: 'http://localhost:4300/auth/callback',
    allowedOrigins: 'http://localhost:4300',
    grantTypes: 'authorization_code client_credentials',
    scopes: 'openid profile email aegis.wallet_challenge',
    claimKeys: 'sub email name organization_id roles acr auth_time',
    onboardingMode: 'invite-only'
  });

  assert.equal(app.name, 'Example Portal');
  assert.equal(app.redirectUris[0], 'http://localhost:4300/auth/callback');
  assert.equal(app.grantTypes.includes('client_credentials'), true);

  const secret = await createConnectedAppSecret(workspace, subscription, app.id, { label: 'Test secret' });
  assert.match(secret.secret.value, /^aegis_secret_/);

  const certificate = await importConnectedAppCertificate(workspace, subscription, app.id, {
    label: 'Test certificate',
    certificatePem: [
      '-----BEGIN CERTIFICATE-----',
      'MIIBlzCCAT2gAwIBAgIUY2xvdWRzdHJ1Y2MtdGVzdC1jZXJ0MAoGCCqGSM49BAMC',
      'MBUxEzARBgNVBAMMCkFlZ2lzIFRlc3QwHhcNMjYwMTAxMDAwMDAwWhcNMjcwMTAx',
      'MDAwMDAwWjAVMRMwEQYDVQQDDApBZWdpcyBUZXN0MFkwEwYHKoZIzj0CAQYIKoZI',
      'zj0DAQcDQgAEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa==',
      '-----END CERTIFICATE-----'
    ].join('\n')
  });
  assert.equal(certificate.certificateCredentials.length, 1);
  assert.match(certificate.certificateCredentials[0].fingerprint, /^[a-f0-9]{64}$/);

  const authorization = await createConnectedAuthorizationCode({
    clientId: app.clientId,
    redirectUri: 'http://localhost:4300/auth/callback',
    scope: 'openid profile email',
    email: 'person@example.com',
    name: 'Person Example',
    nonce: 'nonce-value',
    state: 'state-value'
  });
  assert.match(authorization.code.code, /^aegis_code_/);

  await assert.rejects(
    () => exchangeConnectedAuthorizationCode({
      clientId: app.clientId,
      clientSecret: 'wrong-secret',
      code: authorization.code.code,
      redirectUri: 'http://localhost:4300/auth/callback'
    }, 'http://localhost:3000'),
    /client_secret is invalid/
  );

  const token = await exchangeConnectedAuthorizationCode({
    clientId: app.clientId,
    clientSecret: secret.secret.value,
    code: authorization.code.code,
    redirectUri: 'http://localhost:4300/auth/callback'
  }, 'http://localhost:3000');
  assert.equal(token.token_type, 'Bearer');
  assert.match(token.access_token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(token.claims.email, 'person@example.com');

  const payload = await verifyAccessToken(token.access_token, 'http://localhost:3000');
  assert.equal(payload.email, 'person@example.com');
  assert.equal(payload.aud, app.clientId);

  const clientToken = await createClientCredentialsToken({
    clientId: app.clientId,
    clientSecret: secret.secret.value,
    scope: 'aegis.wallet_challenge'
  }, 'http://localhost:3000');
  assert.match(clientToken.access_token, /^[A-Za-z0-9_-]+\./);

  const certAuth = await authenticateConnectedClient({
    clientId: app.clientId,
    certificateFingerprint: certificate.certificateCredentials[0].fingerprint
  });
  assert.equal(certAuth.method, 'certificate');

  const view = await getConnectedAppsView(workspace, subscription, { connectedAppId: app.id }, { publicBaseUrl: 'http://localhost:3000' });
  assert.equal(view.stats.total, 1);
  assert.equal(view.stats.secrets, 1);
  assert.equal(view.stats.certificates, 1);
  assert.equal(view.logs.hasRows, true);
  assert.equal(view.table.rows[0].secretCredentials[0].canReveal, true);
  assert.equal(view.table.rows[0].secretCredentials[0].revealedValue, '');
  assert.match(view.table.rows[0].secretCredentials[0].maskedValue, /^aegis_secret/);

  for (let index = 0; index < 4; index += 1) {
    await createConnectedAppSecret(workspace, subscription, app.id, { label: `Rotation ${index + 1}` });
  }
  await assert.rejects(
    () => createConnectedAppSecret(workspace, subscription, app.id, { label: 'Too many secrets' }),
    /at most 5 active client secrets/
  );

  const csv = await exportConnectedAppLogsCsv({ workspaceId: workspace.id, appId: app.id });
  assert.match(csv, /oauth.token.issued/);
  assert.match(csv, /connected_app.secret.created/);
});

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
