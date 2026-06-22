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
    'ISSUER_ORG_STORE_PATH',
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
  process.env.ISSUER_ORG_STORE_PATH = path.join(tempDir, 'issuer-organizations.json');
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
    onboardingMode: 'open'
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

test('connected app invite-only mode requires an active credential membership', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-connected-app-invite-only-'));
  const previous = captureEnv([
    'CONNECTED_APP_STORE_PATH',
    'CONNECTED_APP_LOG_STORE_PATH',
    'CONNECTED_APP_OAUTH_CODE_STORE_PATH',
    'CONNECTED_APP_SIGNING_KEY_STORE_PATH',
    'CONNECTED_APP_SECRET_ENCRYPTION_KEY',
    'WALLET_CHALLENGE_STORE_PATH',
    'ISSUER_ORG_STORE_PATH',
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
  process.env.ISSUER_ORG_STORE_PATH = path.join(tempDir, 'issuer-organizations.json');
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
    id: 'workspace-invite-only',
    subscriptionId: 'sub-invite-only',
    organization: 'Invite Only Org',
    ownerEmail: 'admin@example.com',
    members: [{ email: 'admin@example.com', role: 'administrator', addedAt: new Date().toISOString() }],
    platforms: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const subscription = {
    id: 'sub-invite-only',
    email: 'admin@example.com',
    organization: 'Invite Only Org'
  };
  await fs.writeFile(process.env.SUBSCRIBER_WORKSPACE_STORE_PATH, JSON.stringify([workspace], null, 2), 'utf8');

  const {
    createConnectedApp,
    createConnectedAuthorizationCode
  } = require('../src/services/connected-app-service');
  const {
    issueCredential,
    markCredentialAccepted
  } = require('../src/services/org-admin-service');

  const app = await createConnectedApp(workspace, subscription, {
    name: 'Invite Only Portal',
    description: 'Only credential holders can sign in.',
    appType: 'web',
    redirectUris: 'http://localhost:4300/auth/callback',
    scopes: 'openid profile email',
    claimKeys: 'sub email name organization_id roles acr auth_time credential_id credential_status person_type division_id',
    onboardingMode: 'invite-only'
  });

  await assert.rejects(
    () => createConnectedAuthorizationCode({
      clientId: app.clientId,
      redirectUri: 'http://localhost:4300/auth/callback',
      scope: 'openid profile email',
      email: 'outsider@example.com',
      name: 'Outside User'
    }),
    /active credential holder/
  );

  const invited = await issueCredential(workspace, subscription, {
    holderEmail: 'member@example.com',
    displayName: 'Member Example',
    personType: 'employee',
    roleIds: ['role-employee']
  });

  await assert.rejects(
    () => createConnectedAuthorizationCode({
      clientId: app.clientId,
      redirectUri: 'http://localhost:4300/auth/callback',
      scope: 'openid profile email',
      email: 'member@example.com',
      name: 'Member Example'
    }),
    /active credential holder/
  );

  await markCredentialAccepted(workspace, subscription, invited.id);
  const authorization = await createConnectedAuthorizationCode({
    clientId: app.clientId,
    redirectUri: 'http://localhost:4300/auth/callback',
    scope: 'openid profile email',
    email: 'member@example.com',
    name: 'Member Example'
  });

  assert.equal(authorization.code.claims.email, 'member@example.com');
  assert.equal(authorization.code.claims.credential_id, invited.id);
  assert.equal(authorization.code.claims.credential_status, 'active');
  assert.equal(authorization.code.claims.person_type, 'employee');
  assert.equal(authorization.code.claims.roles.includes('Employee'), true);
});

test('connected app sign-in and CIBA-style flows require wallet challenge acceptance', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-connected-app-ciba-'));
  const previous = captureEnv([
    'CONNECTED_APP_STORE_PATH',
    'CONNECTED_APP_LOG_STORE_PATH',
    'CONNECTED_APP_OAUTH_CODE_STORE_PATH',
    'CONNECTED_APP_SIGNING_KEY_STORE_PATH',
    'CONNECTED_APP_SECRET_ENCRYPTION_KEY',
    'WALLET_CHALLENGE_STORE_PATH',
    'ISSUER_ORG_STORE_PATH',
    'ORG_ADMIN_STORE_PATH',
    'ORG_ADMIN_EVENT_STORE_PATH',
    'SUBSCRIBER_WORKSPACE_STORE_PATH',
    'APP_PUBLIC_BASE_URL',
    'ARIES_ISSUER_ADMIN_URL',
    'ARIES_ISSUER_ADMIN_API_KEY'
  ]);
  process.env.CONNECTED_APP_STORE_PATH = path.join(tempDir, 'connected-apps.json');
  process.env.CONNECTED_APP_LOG_STORE_PATH = path.join(tempDir, 'connected-app-logs.json');
  process.env.CONNECTED_APP_OAUTH_CODE_STORE_PATH = path.join(tempDir, 'connected-app-oauth-codes.json');
  process.env.CONNECTED_APP_SIGNING_KEY_STORE_PATH = path.join(tempDir, 'connected-app-keys.json');
  process.env.CONNECTED_APP_SECRET_ENCRYPTION_KEY = 'test-connected-app-secret-encryption-key';
  process.env.WALLET_CHALLENGE_STORE_PATH = path.join(tempDir, 'wallet-challenges.json');
  process.env.ISSUER_ORG_STORE_PATH = path.join(tempDir, 'issuer-organizations.json');
  process.env.ORG_ADMIN_STORE_PATH = path.join(tempDir, 'org-admin.json');
  process.env.ORG_ADMIN_EVENT_STORE_PATH = path.join(tempDir, 'org-events.json');
  process.env.SUBSCRIBER_WORKSPACE_STORE_PATH = path.join(tempDir, 'workspaces.json');
  process.env.APP_PUBLIC_BASE_URL = 'http://localhost:3000';
  process.env.ARIES_ISSUER_ADMIN_URL = 'http://127.0.0.1:9';
  process.env.ARIES_ISSUER_ADMIN_API_KEY = 'test-admin-key';
  resetModules();

  t.after(() => {
    restoreEnv(previous);
    resetModules();
  });

  const workspace = {
    id: 'workspace-challenge',
    subscriptionId: 'sub-challenge',
    organization: 'Challenge Org',
    ownerEmail: 'admin@example.com',
    members: [{ email: 'admin@example.com', role: 'administrator', addedAt: new Date().toISOString() }],
    platforms: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const subscription = {
    id: 'sub-challenge',
    email: 'admin@example.com',
    organization: 'Challenge Org'
  };
  await fs.writeFile(process.env.SUBSCRIBER_WORKSPACE_STORE_PATH, JSON.stringify([workspace], null, 2), 'utf8');
  await fs.writeFile(process.env.ISSUER_ORG_STORE_PATH, JSON.stringify([
    {
      id: 'issuer-org-challenge',
      subscriptionId: subscription.id,
      organizationId: workspace.id,
      organizationName: workspace.organization,
      label: 'Challenge Org Issuer',
      invitationId: 'invite-challenge',
      invitationUrl: 'http://issuer.example/invite?oob=test',
      requestUrl: 'http://issuer.example/invite?oob=test',
      iosDeepLinkUrl: 'aegisid://invite?oob=test',
      qrCodeDataUrl: '',
      iosQrCodeDataUrl: '',
      issuerConnectionId: 'issuer-connection-challenge',
      holderConnectionId: 'holder-connection-challenge',
      status: 'connected',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ], null, 2), 'utf8');

  const {
    CIBA_GRANT_TYPE,
    createBackchannelAuthenticationRequest,
    createConnectedApp,
    createConnectedAppSecret,
    createConnectedAuthorizationCode,
    exchangeBackchannelAuthenticationToken,
    exchangeConnectedAuthorizationCode,
    getDiscovery,
    verifyAccessToken
  } = require('../src/services/connected-app-service');
  const {
    acceptExternalWalletChallenge,
    getWalletChallenge
  } = require('../src/services/wallet-challenge-service');

  const app = await createConnectedApp(workspace, subscription, {
    name: 'High Assurance Portal',
    description: 'OIDC relying party with wallet sign-in.',
    appType: 'web',
    redirectUris: 'http://localhost:4300/auth/callback',
    grantTypes: `authorization_code ${CIBA_GRANT_TYPE}`,
    scopes: 'openid profile email aegis.wallet_challenge',
    claimKeys: 'sub email name organization_id roles acr wallet_challenge_id auth_time',
    onboardingMode: 'open',
    signInChallengePolicy: 'wallet'
  });
  const secret = await createConnectedAppSecret(workspace, subscription, app.id, { label: 'Challenge secret' });
  const discovery = await getDiscovery('http://localhost:3000');
  assert.equal(discovery.backchannel_authentication_endpoint, 'http://localhost:3000/oauth2/backchannel-authentication');
  assert.equal(discovery.grant_types_supported.includes(CIBA_GRANT_TYPE), true);

  const authorization = await createConnectedAuthorizationCode({
    clientId: app.clientId,
    redirectUri: 'http://localhost:4300/auth/callback',
    scope: 'openid profile email',
    email: 'person@example.com',
    name: 'Person Example',
    nonce: 'nonce-value',
    state: 'state-value'
  });
  assert.equal(authorization.code.status, 'pending_challenge');
  assert.match(authorization.code.challengeId, /^[0-9a-f-]{36}$/);
  const signInChallenge = await getWalletChallenge(authorization.code.challengeId);
  assert.equal(signInChallenge.status, 'sent');
  assert.equal(signInChallenge.challengeType, 'oidc-sign-in');

  await assert.rejects(
    () => exchangeConnectedAuthorizationCode({
      clientId: app.clientId,
      clientSecret: secret.secret.value,
      code: authorization.code.code,
      redirectUri: 'http://localhost:4300/auth/callback'
    }, 'http://localhost:3000'),
    /Wallet challenge approval is pending/
  );

  await acceptExternalWalletChallenge(authorization.code.challengeId, { acceptedBy: 'person@example.com' });
  const token = await exchangeConnectedAuthorizationCode({
    clientId: app.clientId,
    clientSecret: secret.secret.value,
    code: authorization.code.code,
    redirectUri: 'http://localhost:4300/auth/callback'
  }, 'http://localhost:3000');
  assert.equal(token.claims.wallet_challenge_id, authorization.code.challengeId);
  assert.equal(token.claims.acr, 'urn:vanguard:aegis-id:auth:wallet');
  const payload = await verifyAccessToken(token.access_token, 'http://localhost:3000');
  assert.equal(payload.wallet_challenge_id, authorization.code.challengeId);

  await assert.rejects(
    () => acceptExternalWalletChallenge(authorization.code.challengeId, { acceptedBy: 'person@example.com' }),
    /already been accepted/
  );

  const backchannel = await createBackchannelAuthenticationRequest({
    clientId: app.clientId,
    clientSecret: secret.secret.value,
    loginHint: 'backchannel@example.com',
    scope: 'openid profile email',
    action: 'sign-in',
    bindingMessage: 'Sign in to High Assurance Portal',
    interval: 2
  });
  assert.match(backchannel.auth_req_id, /^aegis_authreq_/);
  assert.match(backchannel.aegis_challenge_id, /^[0-9a-f-]{36}$/);
  assert.equal(backchannel.interval, 2);

  await assert.rejects(
    () => exchangeBackchannelAuthenticationToken({
      clientId: app.clientId,
      clientSecret: secret.secret.value,
      authReqId: backchannel.auth_req_id
    }, 'http://localhost:3000'),
    /Wallet challenge approval is pending/
  );

  await acceptExternalWalletChallenge(backchannel.aegis_challenge_id, { acceptedBy: 'backchannel@example.com' });
  const cibaToken = await exchangeBackchannelAuthenticationToken({
    clientId: app.clientId,
    clientSecret: secret.secret.value,
    authReqId: backchannel.auth_req_id
  }, 'http://localhost:3000');
  assert.equal(cibaToken.claims.email, 'backchannel@example.com');
  assert.equal(cibaToken.claims.wallet_challenge_id, backchannel.aegis_challenge_id);
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
