const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { assertOrgPrivilege, listCredentialMembershipsForEmail } = require('./org-admin-service');
const { createExternalWalletChallenge, getWalletChallenge, listWalletChallengeLedger } = require('./wallet-challenge-service');

const appStore = new FileJsonStore(config.paths.connectedApps, []);
const logStore = new FileJsonStore(config.paths.connectedAppLogs, []);
const codeStore = new FileJsonStore(config.paths.connectedAppOAuthCodes, []);
const keyStore = new FileJsonStore(config.paths.connectedAppSigningKeys, { keys: [] });

const DEFAULT_SCOPES = ['openid', 'profile', 'email', 'aegis.wallet_challenge'];
const DEFAULT_CLAIMS = [
  'sub',
  'email',
  'name',
  'organization_id',
  'roles',
  'acr',
  'wallet_challenge_id',
  'auth_time',
  'credential_id',
  'credential_status',
  'person_type',
  'division_id',
  'identity_provider',
  'upstream_subject',
  'upstream_tenant_id'
];
const CIBA_GRANT_TYPE = 'urn:openid:params:grant-type:ciba';
const SUPPORTED_GRANTS = ['authorization_code', 'client_credentials', CIBA_GRANT_TYPE];
const SIGN_IN_CHALLENGE_POLICIES = ['disabled', 'wallet', 'passkey', 'verified-id'];
const SECRET_TTL_DAYS = 180;
const PAGE_SIZE_DEFAULT = 10;
const PAGE_SIZE_MAX = 50;
const MAX_APP_CREDENTIALS = 5;
const SECRET_REVEAL_TTL_MS = 2 * 60 * 1000;

function createId(prefix = 'cap') {
  return `${prefix}_${crypto.randomUUID()}`;
}

function createToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

function nowIso() {
  return new Date().toISOString();
}

function addDays(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

async function getConnectedAppsView(workspace, subscription, query = {}, options = {}) {
  await assertOrgPrivilege(workspace, subscription, 'connectedApps.view');
  const apps = await listAppsForWorkspace(workspace.id);
  const table = await listConnectedAppsTable(workspace.id, query, options);
  table.rows = await Promise.all(table.rows.map(async (row) => {
    const modalLogs = await listConnectedAppLogs({
      workspaceId: workspace.id,
      appId: row.id,
      pageSize: 8
    });
    const modalWalletChallenges = await listWalletChallengeLedger({
      organizationId: workspace.id,
      appInstanceId: row.clientId,
      limit: 8
    });
    return {
      ...row,
      modalLogs,
      modalWalletChallenges,
      hasModalWalletChallenges: modalWalletChallenges.length > 0
    };
  }));
  const selectedAppId = normalizeText(query.connectedAppId || query.appId || table.rows[0]?.id || apps[0]?.id, 120);
  const selectedApp = apps.find((app) => app.id === selectedAppId) || apps[0] || null;
  const logs = selectedApp
    ? await listConnectedAppLogs({
        workspaceId: workspace.id,
        appId: selectedApp.id,
        category: query.connectedAppLogCategory,
        search: query.connectedAppLogSearch,
        sort: query.connectedAppLogSort,
        direction: query.connectedAppLogDirection,
        page: query.connectedAppLogPage,
        pageSize: query.connectedAppLogPageSize
      })
    : emptyPage();
  const walletChallenges = selectedApp
    ? await listWalletChallengeLedger({
        organizationId: workspace.id,
        appInstanceId: selectedApp.clientId,
        limit: 100
      })
    : [];

  return {
    apps: table.rows,
    table,
    selectedApp: selectedApp ? decorateApp(selectedApp, options) : null,
    hasApps: table.total > 0,
    logs,
    walletChallenges,
    hasWalletChallenges: walletChallenges.length > 0,
    secretCreated: options.secretCreated || null,
    supportedGrantTypes: SUPPORTED_GRANTS.map((value) => ({ value, label: grantLabel(value) })),
    supportedScopes: DEFAULT_SCOPES,
    defaultRedirectUri: `${options.publicBaseUrl || config.app.publicBaseUrl}/oauth/callback`,
    stats: {
      total: apps.length,
      enabled: apps.filter((app) => app.status === 'enabled').length,
      secrets: apps.reduce((sum, app) => sum + app.secretCredentials.filter((secret) => !secret.revokedAt).length, 0),
      certificates: apps.reduce((sum, app) => sum + app.certificateCredentials.filter((cert) => !cert.revokedAt).length, 0)
    }
  };
}

async function createConnectedApp(workspace, subscription, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'connectedApps.manage');
  const records = await appStore.read();
  const now = nowIso();
  const app = normalizeApp({
    id: createId('app'),
    workspaceId: workspace.id,
    subscriptionId: subscription.id,
    name: normalizeText(input.name, 160) || 'New connected app',
    description: normalizeText(input.description, 600),
    clientId: `aegis_${createToken(18)}`,
    status: 'enabled',
    appType: normalizeText(input.appType, 80) || 'web',
    redirectUris: normalizeUriList(input.redirectUris),
    postLogoutRedirectUris: normalizeUriList(input.postLogoutRedirectUris),
    allowedOrigins: normalizeUriList(input.allowedOrigins),
    grantTypes: normalizeSelection(input.grantTypes, SUPPORTED_GRANTS, ['authorization_code']),
    scopes: normalizeSelection(input.scopes, DEFAULT_SCOPES, DEFAULT_SCOPES),
    claimKeys: normalizeSelection(input.claimKeys, DEFAULT_CLAIMS, DEFAULT_CLAIMS),
    onboardingMode: ['open', 'invite-only'].includes(input.onboardingMode) ? input.onboardingMode : 'invite-only',
    walletChallengePolicy: normalizeWalletPolicy(input.walletChallengePolicy),
    signInChallengePolicy: normalizeSignInChallengePolicy(input.signInChallengePolicy),
    tokenEndpointAuthMethod: normalizeTokenAuthMethod(input.tokenEndpointAuthMethod),
    branding: normalizeBranding(input),
    emailTemplates: normalizeTemplates(input),
    messages: normalizeMessages(input),
    secretCredentials: [],
    certificateCredentials: [],
    createdBy: subscription.email,
    createdAt: now,
    updatedAt: now
  });
  records.unshift(app);
  await appStore.write(records);
  await logConnectedAppEvent({
    workspaceId: workspace.id,
    appId: app.id,
    clientId: app.clientId,
    category: 'api',
    eventType: 'connected_app.created',
    actorEmail: subscription.email,
    statusCode: 201,
    payload: { name: app.name, onboardingMode: app.onboardingMode }
  });
  return decorateApp(app);
}

async function updateConnectedApp(workspace, subscription, appId, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'connectedApps.manage');
  const { records, index, app } = await findAppForWorkspace(workspace.id, appId);
  const next = normalizeApp({
    ...app,
    name: normalizeText(input.name, 160) || app.name,
    description: normalizeText(input.description, 600),
    status: ['enabled', 'disabled'].includes(input.status) ? input.status : app.status,
    appType: normalizeText(input.appType, 80) || app.appType,
    redirectUris: normalizeUriList(input.redirectUris, app.redirectUris),
    postLogoutRedirectUris: normalizeUriList(input.postLogoutRedirectUris, app.postLogoutRedirectUris),
    allowedOrigins: normalizeUriList(input.allowedOrigins, app.allowedOrigins),
    grantTypes: normalizeSelection(input.grantTypes, SUPPORTED_GRANTS, app.grantTypes),
    scopes: normalizeSelection(input.scopes, DEFAULT_SCOPES, app.scopes),
    claimKeys: normalizeSelection(input.claimKeys, DEFAULT_CLAIMS, app.claimKeys),
    onboardingMode: ['open', 'invite-only'].includes(input.onboardingMode) ? input.onboardingMode : app.onboardingMode,
    walletChallengePolicy: normalizeWalletPolicy(input.walletChallengePolicy),
    signInChallengePolicy: normalizeSignInChallengePolicy(input.signInChallengePolicy ?? app.signInChallengePolicy),
    tokenEndpointAuthMethod: normalizeTokenAuthMethod(input.tokenEndpointAuthMethod),
    branding: normalizeBranding(input, app.branding),
    emailTemplates: normalizeTemplates(input, app.emailTemplates),
    messages: normalizeMessages(input, app.messages),
    updatedAt: nowIso(),
    updatedBy: subscription.email
  });
  records[index] = next;
  await appStore.write(records);
  await logConnectedAppEvent({
    workspaceId: workspace.id,
    appId: next.id,
    clientId: next.clientId,
    category: 'api',
    eventType: 'connected_app.updated',
    actorEmail: subscription.email,
    statusCode: 200,
    payload: { status: next.status, redirectUriCount: next.redirectUris.length }
  });
  return decorateApp(next);
}

async function createConnectedAppSecret(workspace, subscription, appId, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'connectedApps.credentials.manage');
  const { records, index, app } = await findAppForWorkspace(workspace.id, appId);
  enforceActiveCredentialLimit(app.secretCredentials, 'client secrets');
  const secretValue = `aegis_secret_${createToken(36)}`;
  const credential = {
    id: createId('sec'),
    label: normalizeText(input.label, 120) || 'Client secret',
    prefix: secretValue.slice(0, 18),
    hash: hashSecret(secretValue),
    encryptedValue: encryptSecret(secretValue),
    createdAt: nowIso(),
    expiresAt: normalizeDate(input.expiresAt) || addDays(SECRET_TTL_DAYS),
    revokedAt: null,
    createdBy: subscription.email
  };
  const next = {
    ...app,
    secretCredentials: [credential, ...app.secretCredentials],
    updatedAt: nowIso()
  };
  records[index] = next;
  await appStore.write(records);
  await logConnectedAppEvent({
    workspaceId: workspace.id,
    appId: app.id,
    clientId: app.clientId,
    category: 'api',
    eventType: 'connected_app.secret.created',
    actorEmail: subscription.email,
    statusCode: 201,
    payload: { credentialId: credential.id, expiresAt: credential.expiresAt }
  });
  return {
    app: decorateApp(next),
    secret: {
      id: credential.id,
      value: secretValue,
      expiresAt: credential.expiresAt
    }
  };
}

async function revokeConnectedAppSecret(workspace, subscription, appId, secretId) {
  await assertOrgPrivilege(workspace, subscription, 'connectedApps.credentials.manage');
  const { records, index, app } = await findAppForWorkspace(workspace.id, appId);
  const next = {
    ...app,
    secretCredentials: app.secretCredentials.map((secret) =>
      secret.id === secretId ? { ...secret, revokedAt: secret.revokedAt || nowIso(), revokedBy: subscription.email } : secret
    ),
    updatedAt: nowIso()
  };
  records[index] = next;
  await appStore.write(records);
  await logConnectedAppEvent({
    workspaceId: workspace.id,
    appId: app.id,
    clientId: app.clientId,
    category: 'api',
    eventType: 'connected_app.secret.revoked',
    actorEmail: subscription.email,
    statusCode: 200,
    payload: { credentialId: secretId }
  });
  return decorateApp(next);
}

async function importConnectedAppCertificate(workspace, subscription, appId, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'connectedApps.credentials.manage');
  const certificatePem = normalizeText(input.certificatePem, 10000);
  if (!certificatePem.includes('BEGIN CERTIFICATE')) {
    throw validationError('Certificate PEM is required.');
  }
  const { records, index, app } = await findAppForWorkspace(workspace.id, appId);
  enforceActiveCredentialLimit(app.certificateCredentials, 'certificates');
  const certificate = {
    id: createId('cert'),
    label: normalizeText(input.label, 120) || 'Signing certificate',
    fingerprint: crypto.createHash('sha256').update(certificatePem).digest('hex'),
    certificatePem,
    createdAt: nowIso(),
    expiresAt: normalizeDate(input.expiresAt) || null,
    revokedAt: null,
    createdBy: subscription.email
  };
  const next = {
    ...app,
    certificateCredentials: [certificate, ...app.certificateCredentials],
    updatedAt: nowIso()
  };
  records[index] = next;
  await appStore.write(records);
  await logConnectedAppEvent({
    workspaceId: workspace.id,
    appId: app.id,
    clientId: app.clientId,
    category: 'api',
    eventType: 'connected_app.certificate.imported',
    actorEmail: subscription.email,
    statusCode: 201,
    payload: { certificateId: certificate.id, fingerprint: certificate.fingerprint.slice(0, 16) }
  });
  return decorateApp(next);
}

async function setConnectedAppStatus(workspace, subscription, appId, status) {
  await assertOrgPrivilege(workspace, subscription, 'connectedApps.manage');
  const { records, index, app } = await findAppForWorkspace(workspace.id, appId);
  const nextStatus = status === 'enabled' ? 'enabled' : 'disabled';
  const next = normalizeApp({
    ...app,
    status: nextStatus,
    updatedAt: nowIso(),
    updatedBy: subscription.email
  });
  records[index] = next;
  await appStore.write(records);
  await logConnectedAppEvent({
    workspaceId: workspace.id,
    appId: next.id,
    clientId: next.clientId,
    category: 'api',
    eventType: `connected_app.${nextStatus}`,
    actorEmail: subscription.email,
    statusCode: 200,
    payload: { status: nextStatus }
  });
  return decorateApp(next);
}

async function deleteConnectedApp(workspace, subscription, appId) {
  await assertOrgPrivilege(workspace, subscription, 'connectedApps.manage');
  const { records, index, app } = await findAppForWorkspace(workspace.id, appId);
  const next = normalizeApp({
    ...app,
    status: 'deleted',
    deletedAt: nowIso(),
    deletedBy: subscription.email,
    updatedAt: nowIso(),
    updatedBy: subscription.email
  });
  records[index] = next;
  await appStore.write(records);
  await logConnectedAppEvent({
    workspaceId: workspace.id,
    appId: next.id,
    clientId: next.clientId,
    category: 'api',
    eventType: 'connected_app.deleted',
    actorEmail: subscription.email,
    statusCode: 200,
    payload: { status: 'deleted' }
  });
  return decorateApp(next);
}

async function revealConnectedAppSecret(workspace, subscription, appId, secretId, input = {}) {
  await assertOrgPrivilege(workspace, subscription, 'connectedApps.credentials.manage');
  const { app } = await findAppForWorkspace(workspace.id, appId);
  const secret = app.secretCredentials.find((candidate) => candidate.id === secretId);
  if (!secret || secret.revokedAt) {
    throw notFound('Connected app secret was not found.');
  }
  if (secret.expiresAt && Date.parse(secret.expiresAt) < Date.now()) {
    throw validationError('Expired secrets cannot be revealed.');
  }
  if (!secret.encryptedValue) {
    throw validationError('This secret was created before reveal support. Rotate it to generate a revealable secret.');
  }

  const acceptedChallengeId = normalizeText(input.acceptedChallengeId, 120);
  if (acceptedChallengeId) {
    const challenge = await getWalletChallenge(acceptedChallengeId);
    const challengeMatches =
      challenge.resourceType === 'connected-app-secret' &&
      challenge.resourceId === secretId &&
      challenge.appInstanceId === app.clientId;
    if (challenge.status === 'accepted' && challengeMatches) {
      await logConnectedAppEvent({
        workspaceId: workspace.id,
        appId: app.id,
        clientId: app.clientId,
        category: 'wallet',
        eventType: 'connected_app.secret.revealed',
        actorEmail: subscription.email,
        subject: subscription.email,
        statusCode: 200,
        walletChallengeId: challenge.id,
        payload: { credentialId: secretId, expiresAt: new Date(Date.now() + SECRET_REVEAL_TTL_MS).toISOString() }
      });
      return {
        status: 'revealed',
        app: decorateApp(app),
        secret: {
          id: secret.id,
          value: decryptSecret(secret.encryptedValue),
          expiresAt: secret.expiresAt,
          revealExpiresAt: new Date(Date.now() + SECRET_REVEAL_TTL_MS).toISOString()
        },
        challenge
      };
    }
    if (challengeMatches && challenge.status !== 'declined') {
      return {
        status: 'pending',
        app: decorateApp(app),
        secret: { id: secret.id, expiresAt: secret.expiresAt },
        challenge
      };
    }
  }

  const challenge = await createExternalWalletChallenge({
    appName: 'Vanguard Aegis ID',
    appInstanceId: app.clientId,
    organizationId: workspace.id,
    organizationName: workspace.organization,
    subject: subscription.email,
    action: 'reveal-connected-app-secret',
    challengeType: 'connected-app-secret',
    resourceType: 'connected-app-secret',
    resourceId: secret.id,
    payload: {
      appId: app.id,
      appName: app.name,
      clientId: app.clientId,
      secretLabel: secret.label,
      reason: normalizeText(input.reason, 400) || 'Admin requested temporary client secret reveal'
    }
  });
  await logConnectedAppEvent({
    workspaceId: workspace.id,
    appId: app.id,
    clientId: app.clientId,
    category: 'wallet',
    eventType: 'connected_app.secret.reveal_challenge_sent',
    actorEmail: subscription.email,
    subject: subscription.email,
    statusCode: 202,
    walletChallengeId: challenge.id,
    payload: { credentialId: secret.id }
  });
  return {
    status: 'pending',
    app: decorateApp(app),
    secret: { id: secret.id, expiresAt: secret.expiresAt },
    challenge
  };
}

async function getDiscovery(baseUrl) {
  const issuer = `${baseUrl.replace(/\/$/, '')}/oauth2`;
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    backchannel_authentication_endpoint: `${issuer}/backchannel-authentication`,
    jwks_uri: `${issuer}/jwks`,
    userinfo_endpoint: `${issuer}/userinfo`,
    introspection_endpoint: `${issuer}/introspect`,
    revocation_endpoint: `${issuer}/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: SUPPORTED_GRANTS,
    backchannel_token_delivery_modes_supported: ['poll'],
    backchannel_user_code_parameter_supported: false,
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'private_key_jwt'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: DEFAULT_SCOPES,
    claims_supported: DEFAULT_CLAIMS
  };
}

async function getJwks() {
  const key = await getActiveSigningKey();
  return { keys: [key.publicJwk] };
}

async function createConnectedAuthorizationCode(input = {}) {
  const app = await findAppByClientId(input.clientId);
  ensureAppEnabled(app);
  ensureGrant(app, 'authorization_code');
  if (!app.redirectUris.includes(input.redirectUri)) {
    throw oauthError('invalid_request', 'redirect_uri is not registered for this client.', 400);
  }

  const code = `aegis_code_${createToken(24)}`;
  const claims = await buildUserClaims(input, app);
  const signInChallenge = await maybeCreateSignInChallenge(app, {
    ...input,
    claims,
    scope: normalizeText(input.scope, 500) || app.scopes.join(' '),
    redirectUri: input.redirectUri
  });
  const tokenClaims = signInChallenge
    ? applyChallengeClaims(claims, signInChallenge)
    : claims;
  const record = {
    id: createId('code'),
    code,
    appId: app.id,
    workspaceId: app.workspaceId,
    clientId: app.clientId,
    redirectUri: input.redirectUri,
    scope: normalizeText(input.scope, 500) || app.scopes.join(' '),
    nonce: normalizeText(input.nonce, 200),
    state: normalizeText(input.state, 500),
    claims: tokenClaims,
    challengeId: signInChallenge?.id || '',
    status: signInChallenge ? 'pending_challenge' : 'issued',
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
  };
  await codeStore.append(record);
  await logConnectedAppEvent({
    workspaceId: app.workspaceId,
    appId: app.id,
    clientId: app.clientId,
    category: 'auth',
    eventType: signInChallenge ? 'oauth.authorization_code.pending_challenge' : 'oauth.authorization_code.issued',
    actorEmail: claims.email,
    subject: claims.sub,
    statusCode: 302,
    walletChallengeId: signInChallenge?.id,
    payload: {
      redirectUri: record.redirectUri,
      scope: record.scope,
      signInChallengePolicy: app.signInChallengePolicy
    }
  });
  return { app: decorateApp(app), code: record };
}

async function exchangeConnectedAuthorizationCode(input = {}, baseUrl) {
  const app = await findAppByClientId(input.clientId);
  ensureAppEnabled(app);
  ensureGrant(app, 'authorization_code');
  validateConnectedCredential(app, input);
  const records = await codeStore.read();
  const index = records.findIndex((record) => record.code === input.code);
  if (index === -1) {
    throw oauthError('invalid_grant', 'Authorization code was not found.', 400);
  }
  const record = records[index];
  if (record.clientId !== app.clientId || record.redirectUri !== input.redirectUri) {
    throw oauthError('invalid_grant', 'Authorization request did not match token request.', 400);
  }
  if (!['issued', 'pending_challenge'].includes(record.status)) {
    throw oauthError('invalid_grant', 'Authorization code has already been used.', 400);
  }
  if (Date.parse(record.expiresAt) < Date.now()) {
    throw oauthError('invalid_grant', 'Authorization code has expired.', 400);
  }

  let tokenClaims = record.claims;
  if (record.status === 'pending_challenge') {
    const challenge = await assertChallengeAccepted(record.challengeId);
    tokenClaims = applyChallengeClaims(record.claims, challenge);
  }

  records[index] = { ...record, claims: tokenClaims, status: 'redeemed', redeemedAt: nowIso() };
  await codeStore.write(records);
  const issuer = `${baseUrl.replace(/\/$/, '')}/oauth2`;
  const token = await signTokenSet(app, tokenClaims, issuer, record.nonce);
  await logConnectedAppEvent({
    workspaceId: app.workspaceId,
    appId: app.id,
    clientId: app.clientId,
    category: 'auth',
    eventType: 'oauth.token.issued',
    actorEmail: tokenClaims.email,
    subject: tokenClaims.sub,
    statusCode: 200,
    walletChallengeId: record.challengeId || undefined,
    payload: { grantType: 'authorization_code', scope: record.scope }
  });
  return token;
}

async function createBackchannelAuthenticationRequest(input = {}) {
  const app = await findAppByClientId(input.clientId);
  ensureAppEnabled(app);
  ensureGrant(app, CIBA_GRANT_TYPE);
  validateConnectedCredential(app, input);

  const loginHint = normalizeEmail(input.loginHint || input.login_hint || input.subject);
  if (!loginHint) {
    throw oauthError('invalid_request', 'login_hint or subject is required for backchannel authentication.', 400);
  }

  const ttlSeconds = Math.min(Math.max(Number.parseInt(input.expiresIn || input.expires_in || '300', 10) || 300, 60), 900);
  const interval = Math.min(Math.max(Number.parseInt(input.interval || '5', 10) || 5, 2), 15);
  const claims = await buildUserClaims({
    ...input,
    email: loginHint,
    name: normalizeText(input.name, 180) || loginHint
  }, app);
  const challenge = await createConnectedAppWalletChallenge(app, {
    subject: loginHint,
    action: normalizeText(input.action, 80) || 'sign-in',
    resourceType: normalizeText(input.resourceType, 80) || 'session',
    resourceId: normalizeText(input.resourceId, 120) || createId('session'),
    requiredAssurance: normalizeSignInChallengePolicy(input.requiredAssurance || app.signInChallengePolicy) === 'disabled'
      ? app.walletChallengePolicy
      : normalizeSignInChallengePolicy(input.requiredAssurance || app.signInChallengePolicy),
    challengeType: 'ciba-backchannel',
    ttlSeconds,
    payload: normalizeObject({
      bindingMessage: normalizeText(input.bindingMessage || input.binding_message, 240),
      clientId: app.clientId,
      scope: normalizeText(input.scope, 500) || app.scopes.join(' '),
      requestedClaims: normalizeObject(input.requestedClaims || input.claims),
      payload: normalizeObject(input.payload)
    })
  });

  const record = {
    id: createId('ciba'),
    kind: 'backchannel',
    authReqId: `aegis_authreq_${createToken(24)}`,
    appId: app.id,
    workspaceId: app.workspaceId,
    clientId: app.clientId,
    scope: normalizeText(input.scope, 500) || app.scopes.join(' '),
    claims: applyChallengeClaims(claims, challenge),
    challengeId: challenge.id,
    status: 'pending_challenge',
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    interval
  };
  await codeStore.append(record);
  await logConnectedAppEvent({
    workspaceId: app.workspaceId,
    appId: app.id,
    clientId: app.clientId,
    category: 'auth',
    eventType: 'oauth.ciba.requested',
    actorEmail: loginHint,
    subject: claims.sub,
    statusCode: 201,
    walletChallengeId: challenge.id,
    payload: {
      grantType: CIBA_GRANT_TYPE,
      scope: record.scope,
      interval,
      expiresIn: ttlSeconds
    }
  });

  return {
    auth_req_id: record.authReqId,
    expires_in: ttlSeconds,
    interval,
    aegis_challenge_id: challenge.id
  };
}

async function exchangeBackchannelAuthenticationToken(input = {}, baseUrl) {
  const app = await findAppByClientId(input.clientId);
  ensureAppEnabled(app);
  ensureGrant(app, CIBA_GRANT_TYPE);
  validateConnectedCredential(app, input);
  const records = await codeStore.read();
  const index = records.findIndex((record) => record.kind === 'backchannel' && record.authReqId === input.authReqId);
  if (index === -1) {
    throw oauthError('invalid_grant', 'Backchannel authentication request was not found.', 400);
  }
  const record = records[index];
  if (record.clientId !== app.clientId) {
    throw oauthError('invalid_grant', 'Backchannel request did not match token request.', 400);
  }
  if (record.status === 'redeemed') {
    throw oauthError('invalid_grant', 'Backchannel authentication request has already been redeemed.', 400);
  }
  if (Date.parse(record.expiresAt) < Date.now()) {
    records[index] = { ...record, status: 'expired', expiredAt: nowIso() };
    await codeStore.write(records);
    throw oauthError('expired_token', 'Backchannel authentication request has expired.', 400);
  }

  const challenge = await assertChallengeAccepted(record.challengeId);
  const tokenClaims = applyChallengeClaims(record.claims, challenge);
  records[index] = { ...record, claims: tokenClaims, status: 'redeemed', redeemedAt: nowIso() };
  await codeStore.write(records);
  const issuer = `${baseUrl.replace(/\/$/, '')}/oauth2`;
  const token = await signTokenSet(app, tokenClaims, issuer, '');
  await logConnectedAppEvent({
    workspaceId: app.workspaceId,
    appId: app.id,
    clientId: app.clientId,
    category: 'auth',
    eventType: 'oauth.ciba.token.issued',
    actorEmail: tokenClaims.email,
    subject: tokenClaims.sub,
    statusCode: 200,
    walletChallengeId: record.challengeId,
    payload: { grantType: CIBA_GRANT_TYPE, scope: record.scope }
  });
  return token;
}

async function createClientCredentialsToken(input = {}, baseUrl) {
  const app = await findAppByClientId(input.clientId);
  ensureAppEnabled(app);
  ensureGrant(app, 'client_credentials');
  validateConnectedCredential(app, input);
  const issuer = `${baseUrl.replace(/\/$/, '')}/oauth2`;
  const claims = {
    sub: app.clientId,
    email: '',
    name: app.name,
    organization_id: app.workspaceId,
    roles: ['connected_app'],
    scope: normalizeText(input.scope, 500) || app.scopes.join(' '),
    acr: 'urn:vanguard:aegis-id:auth:client-credentials',
    auth_time: Math.floor(Date.now() / 1000)
  };
  const token = await signTokenSet(app, claims, issuer, '');
  await logConnectedAppEvent({
    workspaceId: app.workspaceId,
    appId: app.id,
    clientId: app.clientId,
    category: 'auth',
    eventType: 'oauth.token.issued',
    subject: app.clientId,
    statusCode: 200,
    payload: { grantType: 'client_credentials' }
  });
  return token;
}

async function verifyAccessToken(accessToken, baseUrl) {
  const { jwtVerify, importJWK } = await import('jose');
  const key = await getActiveSigningKey();
  const publicKey = await importJWK(key.publicJwk, 'RS256');
  const result = await jwtVerify(accessToken, publicKey, {
    issuer: `${baseUrl.replace(/\/$/, '')}/oauth2`
  });
  return result.payload;
}

async function authenticateConnectedClient(input = {}) {
  const app = await findAppByClientId(input.clientId);
  ensureAppEnabled(app);
  const credential = validateConnectedCredential(app, input);
  return { app: decorateApp(app), method: credential.method };
}

async function getConnectedApp(appId) {
  return decorateApp(await getAppById(appId));
}

async function getConnectedAppByClientId(clientId) {
  return decorateApp(await findAppByClientId(clientId));
}

async function createConnectedAppWalletChallenge(authenticatedApp, input = {}) {
  const app = await getAppById(authenticatedApp.id || authenticatedApp.appId);
  ensureAppEnabled(app);
  const challenge = await createExternalWalletChallenge({
    ...input,
    appName: app.name,
    appInstanceId: app.clientId,
    organizationId: app.workspaceId,
    requiredAssurance: input.requiredAssurance || app.walletChallengePolicy,
    challengeType: normalizeText(input.challengeType, 80) || 'connected-app'
  });
  await logConnectedAppEvent({
    workspaceId: app.workspaceId,
    appId: app.id,
    clientId: app.clientId,
    category: 'wallet',
    eventType: 'wallet_challenge.created',
    actorEmail: input.subject,
    subject: input.subject,
    statusCode: 201,
    walletChallengeId: challenge.id,
    payload: {
      action: challenge.action,
      resourceType: challenge.resourceType,
      resourceId: challenge.resourceId,
      requiredAssurance: challenge.requiredAssurance,
      delivery: challenge.delivery
    }
  });
  return challenge;
}

async function listConnectedAppLogs(filters = {}) {
  const records = await logStore.read();
  const workspaceId = normalizeText(filters.workspaceId, 120);
  const appId = normalizeText(filters.appId, 120);
  const category = normalizeText(filters.category, 80);
  const search = normalizeText(filters.search, 200).toLowerCase();
  const sort = ['createdAt', 'category', 'eventType', 'statusCode', 'actorEmail'].includes(filters.sort)
    ? filters.sort
    : 'createdAt';
  const direction = filters.direction === 'asc' ? 'asc' : 'desc';
  const pageSize = Math.min(Math.max(Number.parseInt(filters.pageSize || PAGE_SIZE_DEFAULT, 10) || PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);
  const page = Math.max(Number.parseInt(filters.page || '1', 10) || 1, 1);

  const filtered = records
    .filter((record) => !workspaceId || record.workspaceId === workspaceId)
    .filter((record) => !appId || record.appId === appId)
    .filter((record) => !category || record.category === category)
    .filter((record) => {
      if (!search) {
        return true;
      }
      return [record.eventType, record.actorEmail, record.subject, record.clientId, record.statusCode]
        .join(' ')
        .toLowerCase()
        .includes(search);
    })
    .sort((left, right) => compareValues(left[sort], right[sort], direction));

  const totalPages = Math.max(Math.ceil(filtered.length / pageSize), 1);
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  return {
    rows: filtered.slice(offset, offset + pageSize).map(decorateLog),
    total: filtered.length,
    hasRows: filtered.length > 0,
    page: safePage,
    pageSize,
    totalPages,
    hasPrevious: safePage > 1,
    hasNext: safePage < totalPages,
    previousPage: safePage > 1 ? safePage - 1 : safePage,
    nextPage: safePage < totalPages ? safePage + 1 : safePage,
    search: filters.search || '',
    category,
    sort,
    direction,
    sortLinks: {
      createdAt: '#connected-apps',
      eventType: '#connected-apps',
      category: '#connected-apps',
      statusCode: '#connected-apps'
    }
  };
}

async function listConnectedAppsTable(workspaceId, query = {}, options = {}) {
  const apps = await listAppsForWorkspace(workspaceId);
  const search = normalizeText(query.connectedAppSearch, 200).toLowerCase();
  const status = ['enabled', 'disabled'].includes(query.connectedAppStatus) ? query.connectedAppStatus : '';
  const appType = normalizeText(query.connectedAppType, 80);
  const sort = ['updatedAt', 'name', 'status', 'appType', 'clientId'].includes(query.connectedAppSort)
    ? query.connectedAppSort
    : 'updatedAt';
  const direction = query.connectedAppDirection === 'asc' ? 'asc' : 'desc';
  const pageSize = Math.min(Math.max(Number.parseInt(query.connectedAppPageSize || PAGE_SIZE_DEFAULT, 10) || PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);
  const page = Math.max(Number.parseInt(query.connectedAppPage || '1', 10) || 1, 1);

  const filtered = apps
    .filter((app) => !status || app.status === status)
    .filter((app) => !appType || app.appType === appType)
    .filter((app) => {
      if (!search) {
        return true;
      }
      return [app.name, app.clientId, app.description, app.appType, app.status]
        .join(' ')
        .toLowerCase()
        .includes(search);
    })
    .sort((left, right) => compareValues(left[sort] || left.createdAt, right[sort] || right.createdAt, direction));

  const totalPages = Math.max(Math.ceil(filtered.length / pageSize), 1);
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * pageSize;
  const appTypes = [...new Set(apps.map((app) => app.appType).filter(Boolean))].sort();

  return {
    rows: filtered.slice(offset, offset + pageSize).map((app) => decorateApp(app, options)),
    total: filtered.length,
    hasRows: filtered.length > 0,
    page: safePage,
    pageSize,
    totalPages,
    hasPrevious: safePage > 1,
    hasNext: safePage < totalPages,
    previousPage: safePage > 1 ? safePage - 1 : safePage,
    nextPage: safePage < totalPages ? safePage + 1 : safePage,
    search: query.connectedAppSearch || '',
    status,
    appType,
    sort,
    direction,
    appTypes: appTypes.map((value) => ({ value, selected: value === appType })),
    sortOptions: [
      { value: 'updatedAt', label: 'Last updated', selected: sort === 'updatedAt' },
      { value: 'name', label: 'Name', selected: sort === 'name' },
      { value: 'status', label: 'Status', selected: sort === 'status' },
      { value: 'appType', label: 'App type', selected: sort === 'appType' },
      { value: 'clientId', label: 'Client ID', selected: sort === 'clientId' }
    ],
    directionOptions: [
      { value: 'desc', label: 'Descending', selected: direction === 'desc' },
      { value: 'asc', label: 'Ascending', selected: direction === 'asc' }
    ]
  };
}

async function exportConnectedAppLogsCsv(filters = {}) {
  const page = await listConnectedAppLogs({ ...filters, page: 1, pageSize: PAGE_SIZE_MAX });
  const allRows = [];
  let currentPage = page;
  for (let pageNumber = 1; pageNumber <= currentPage.totalPages; pageNumber += 1) {
    currentPage = await listConnectedAppLogs({ ...filters, page: pageNumber, pageSize: PAGE_SIZE_MAX });
    allRows.push(...currentPage.rows);
  }
  const header = ['createdAt', 'category', 'eventType', 'statusCode', 'clientId', 'actorEmail', 'subject', 'walletChallengeId'];
  return [
    header.join(','),
    ...allRows.map((row) => header.map((key) => csvEscape(row[key] || '')).join(','))
  ].join('\n');
}

async function logConnectedAppEvent(input = {}) {
  const record = {
    id: createId('log'),
    workspaceId: normalizeText(input.workspaceId, 120),
    appId: normalizeText(input.appId, 120),
    clientId: normalizeText(input.clientId, 160),
    category: normalizeCategory(input.category),
    eventType: normalizeText(input.eventType, 160) || 'connected_app.event',
    actorEmail: normalizeEmail(input.actorEmail),
    subject: normalizeText(input.subject || input.actorEmail, 180),
    method: normalizeText(input.method, 20),
    path: normalizeText(input.path, 500),
    statusCode: Number.parseInt(input.statusCode || '0', 10) || 0,
    walletChallengeId: normalizeText(input.walletChallengeId, 120),
    payload: redact(input.payload || {}),
    createdAt: nowIso()
  };
  await logStore.append(record);
  return decorateLog(record);
}

async function listAppsForWorkspace(workspaceId) {
  return (await appStore.read())
    .filter((app) => app.workspaceId === workspaceId && app.status !== 'deleted')
    .map(normalizeApp)
    .sort((left, right) => Date.parse(right.updatedAt || right.createdAt || 0) - Date.parse(left.updatedAt || left.createdAt || 0));
}

async function findAppByClientId(clientId) {
  const normalizedClientId = normalizeText(clientId, 160);
  const app = (await appStore.read()).map(normalizeApp).find((candidate) => candidate.clientId === normalizedClientId);
  if (!app) {
    throw oauthError('invalid_client', 'Connected app client was not found.', 401);
  }
  return app;
}

async function getAppById(appId) {
  const app = (await appStore.read()).map(normalizeApp).find((candidate) => candidate.id === appId);
  if (!app) {
    throw notFound('Connected app was not found.');
  }
  return app;
}

async function findAppForWorkspace(workspaceId, appId) {
  const records = (await appStore.read()).map(normalizeApp);
  const index = records.findIndex((app) => app.workspaceId === workspaceId && app.id === appId);
  if (index === -1) {
    throw notFound('Connected app was not found for this workspace.');
  }
  return { records, index, app: records[index] };
}

async function signTokenSet(app, claims, issuer, nonce) {
  const { SignJWT, importJWK } = await import('jose');
  const key = await getActiveSigningKey();
  const privateKey = await importJWK(key.privateJwk, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const baseClaims = {
    ...filterClaims(claims, app.claimKeys),
    iss: issuer,
    aud: app.clientId,
    iat: now,
    exp: now + 900
  };
  const idTokenClaims = {
    ...baseClaims,
    nonce: nonce || undefined
  };
  const accessTokenClaims = {
    ...baseClaims,
    scope: app.scopes.join(' '),
    jti: createId('atk')
  };
  const idToken = await new SignJWT(idTokenClaims)
    .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'JWT' })
    .sign(privateKey);
  const accessToken = await new SignJWT(accessTokenClaims)
    .setProtectedHeader({ alg: 'RS256', kid: key.kid, typ: 'JWT' })
    .sign(privateKey);

  return {
    token_type: 'Bearer',
    expires_in: 900,
    access_token: accessToken,
    id_token: idToken,
    scope: app.scopes.join(' '),
    claims: filterClaims(claims, app.claimKeys)
  };
}

async function getActiveSigningKey() {
  const state = await keyStore.read();
  const active = (state.keys || []).find((key) => key.active);
  if (active) {
    return active;
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `aegis-${createToken(8)}`;
  const publicJwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid,
    alg: 'RS256',
    use: 'sig'
  };
  const privateJwk = {
    ...privateKey.export({ format: 'jwk' }),
    kid,
    alg: 'RS256',
    use: 'sig'
  };
  const key = {
    kid,
    publicJwk,
    privateJwk,
    active: true,
    createdAt: nowIso()
  };
  await keyStore.write({ keys: [key, ...(state.keys || []).map((candidate) => ({ ...candidate, active: false }))] });
  return key;
}

function validateClientCredential(app, clientSecret) {
  const secret = normalizeText(clientSecret, 500);
  if (!secret) {
    throw oauthError('invalid_client', 'client_secret is required for this connected app.', 401);
  }
  const hash = hashSecret(secret);
  const matched = app.secretCredentials.find((credential) => {
    if (credential.revokedAt) {
      return false;
    }
    if (credential.expiresAt && Date.parse(credential.expiresAt) < Date.now()) {
      return false;
    }
    return safeEqual(credential.hash, hash);
  });
  if (!matched) {
    throw oauthError('invalid_client', 'client_secret is invalid or expired.', 401);
  }
  return matched;
}

function validateCertificateCredential(app, certificateFingerprint) {
  const fingerprint = normalizeText(certificateFingerprint, 160).toLowerCase().replace(/[^a-f0-9]/g, '');
  if (!fingerprint) {
    throw oauthError('invalid_client', 'client_secret or x-aegis-certificate-sha256 is required.', 401);
  }
  const matched = app.certificateCredentials.find((credential) => {
    if (credential.revokedAt) {
      return false;
    }
    if (credential.expiresAt && Date.parse(credential.expiresAt) < Date.now()) {
      return false;
    }
    return normalizeText(credential.fingerprint, 160).toLowerCase() === fingerprint;
  });
  if (!matched) {
    throw oauthError('invalid_client', 'certificate fingerprint is invalid or expired.', 401);
  }
  return matched;
}

function validateConnectedCredential(app, input = {}) {
  if (input.clientSecret) {
    validateClientCredential(app, input.clientSecret);
    return { method: 'client_secret' };
  }
  if (input.certificateFingerprint) {
    validateCertificateCredential(app, input.certificateFingerprint);
    return { method: 'certificate' };
  }
  throw oauthError('invalid_client', 'client_secret or x-aegis-certificate-sha256 is required.', 401);
}

async function buildUserClaims(input, app) {
  const email = normalizeEmail(input.email || input.user?.email);
  const name = normalizeText(input.name || input.user?.displayName || input.user?.email || email, 160);
  const subject = normalizeText(input.subject, 300);
  const membership = await evaluateConnectedAppSubjectPolicy(app, {
    ...input,
    email
  });
  const membershipRoles = membership
    ? normalizeArray([...membership.roleLabels, ...membership.roleIds])
    : [];
  const roles = normalizeArray(input.roles || membershipRoles);
  return {
    sub: normalizeSubject(subject || membership?.credentialId || email || app.clientId),
    email,
    name: name || membership?.displayName || email,
    organization_id: app.workspaceId,
    roles: roles.length > 0 ? roles : ['connected_app_user'],
    acr: normalizeText(input.acr, 160) || 'urn:vanguard:aegis-id:auth:wallet-or-passkey',
    auth_time: Math.floor(Date.now() / 1000),
    credential_id: membership?.credentialId || '',
    credential_status: membership?.status || '',
    person_type: membership?.personType || '',
    division_id: membership?.divisionId || '',
    identity_provider: normalizeText(input.identityProvider, 80),
    upstream_subject: normalizeText(input.upstreamSubject, 300),
    upstream_tenant_id: normalizeText(input.upstreamTenantId, 160)
  };
}

async function evaluateConnectedAppSubjectPolicy(app, input = {}) {
  if (app.onboardingMode !== 'invite-only') {
    return null;
  }

  const email = normalizeEmail(input.email || input.user?.email || input.subject);
  if (!email) {
    throw oauthError('access_denied', 'Invite-only connected apps require a subject email.', 403);
  }

  const memberships = await listCredentialMembershipsForEmail(email);
  const membership = memberships.find((record) => record.workspaceId === app.workspaceId && isActiveCredentialMembership(record));
  if (!membership) {
    throw oauthError(
      'access_denied',
      'Subject is not an active credential holder for this connected app organization.',
      403
    );
  }

  return membership;
}

function isActiveCredentialMembership(membership = {}) {
  return normalizeText(membership.status, 80).toLowerCase() === 'active';
}

async function maybeCreateSignInChallenge(app, input = {}) {
  if (app.signInChallengePolicy === 'disabled') {
    return null;
  }
  const subject = normalizeEmail(input.claims?.email || input.email || input.user?.email);
  if (!subject) {
    throw oauthError('invalid_request', 'A sign-in challenge policy requires a subject email.', 400);
  }
  return createConnectedAppWalletChallenge(app, {
    subject,
    action: 'sign-in',
    resourceType: 'oidc-session',
    resourceId: createId('session'),
    requiredAssurance: app.signInChallengePolicy,
    challengeType: 'oidc-sign-in',
    ttlSeconds: 300,
    payload: {
      clientId: app.clientId,
      redirectUri: input.redirectUri,
      scope: input.scope,
      state: input.state,
      nonce: input.nonce,
      policy: app.signInChallengePolicy
    }
  });
}

async function assertChallengeAccepted(challengeId) {
  const challenge = await getWalletChallenge(challengeId);
  if (challenge.status === 'declined') {
    throw oauthError('access_denied', 'Wallet challenge was declined.', 400);
  }
  if (challenge.status !== 'accepted') {
    if (challenge.expiresAt && Date.parse(challenge.expiresAt) < Date.now()) {
      throw oauthError('expired_token', 'Wallet challenge has expired.', 400);
    }
    throw oauthError('authorization_pending', 'Wallet challenge approval is pending.', 400);
  }
  return challenge;
}

function applyChallengeClaims(claims = {}, challenge = {}) {
  const assurance = normalizeText(challenge.requiredAssurance || challenge.assurance?.requiredAssurance, 80) || 'wallet';
  return {
    ...claims,
    acr: `urn:vanguard:aegis-id:auth:${assurance}`,
    wallet_challenge_id: challenge.id || challenge.challengeId,
    auth_time: Math.floor(Date.now() / 1000)
  };
}

function filterClaims(claims, claimKeys = DEFAULT_CLAIMS) {
  const allowed = new Set([...claimKeys, 'iss', 'aud', 'iat', 'exp', 'nonce', 'scope', 'jti']);
  return Object.fromEntries(Object.entries(claims).filter(([key, value]) => allowed.has(key) && value !== undefined && value !== ''));
}

function decorateApp(app, options = {}) {
  const safeApp = normalizeApp(app);
  const activeSecrets = safeApp.secretCredentials.filter((secret) => !secret.revokedAt);
  const activeCertificates = safeApp.certificateCredentials.filter((cert) => !cert.revokedAt);
  const revealedSecret = options.revealedSecret || {};
  const revealPending = options.secretRevealPending || {};
  return {
    ...safeApp,
    secretCredentials: safeApp.secretCredentials.map((secret) => ({
      ...secret,
      hash: undefined,
      encryptedValue: undefined,
      expired: secret.expiresAt ? Date.parse(secret.expiresAt) < Date.now() : false,
      displayPrefix: `${secret.prefix || 'aegis_secret'}...`,
      maskedValue: `${secret.prefix || 'aegis_secret'}••••••••••••••••`,
      canReveal: Boolean(secret.encryptedValue && !secret.revokedAt && (!secret.expiresAt || Date.parse(secret.expiresAt) >= Date.now())),
      revealedValue:
        revealedSecret.appId === safeApp.id &&
        revealedSecret.secretId === secret.id &&
        Date.parse(revealedSecret.expiresAt || '') > Date.now()
          ? revealedSecret.value
          : '',
      revealPending:
        revealPending.appId === safeApp.id &&
        revealPending.secretId === secret.id &&
        Date.parse(revealPending.expiresAt || '') > Date.now()
    })),
    certificateCredentials: safeApp.certificateCredentials.map((cert) => ({
      ...cert,
      certificatePem: undefined,
      displayFingerprint: cert.fingerprint ? `${cert.fingerprint.slice(0, 16)}...` : ''
    })),
    activeSecretCount: activeSecrets.length,
    activeCertificateCount: activeCertificates.length,
    canCreateSecret: activeSecrets.length < MAX_APP_CREDENTIALS,
    canCreateCertificate: activeCertificates.length < MAX_APP_CREDENTIALS,
    maxCredentialCount: MAX_APP_CREDENTIALS,
    statusLabel: safeApp.status === 'enabled' ? 'Enabled' : safeApp.status === 'deleted' ? 'Deleted' : 'Disabled',
    nextStatus: safeApp.status === 'enabled' ? 'disabled' : 'enabled',
    nextStatusLabel: safeApp.status === 'enabled' ? 'Disable' : 'Enable',
    discoveryUrl: `${options.publicBaseUrl || config.app.publicBaseUrl}/oauth2/.well-known/openid-configuration`,
    authorizationEndpoint: `${options.publicBaseUrl || config.app.publicBaseUrl}/oauth2/authorize`,
    tokenEndpoint: `${options.publicBaseUrl || config.app.publicBaseUrl}/oauth2/token`,
    backchannelAuthenticationEndpoint: `${options.publicBaseUrl || config.app.publicBaseUrl}/oauth2/backchannel-authentication`,
    walletChallengeEndpoint: `${options.publicBaseUrl || config.app.publicBaseUrl}/api/connected-apps/wallet-challenges`,
    scopesText: safeApp.scopes.join(' '),
    grantTypesRawText: safeApp.grantTypes.join(' '),
    grantTypesText: safeApp.grantTypes.map(grantLabel).join(', '),
    signInChallengePolicyText: signInChallengeLabel(safeApp.signInChallengePolicy),
    redirectUrisText: safeApp.redirectUris.join('\n'),
    postLogoutRedirectUrisText: safeApp.postLogoutRedirectUris.join('\n'),
    allowedOriginsText: safeApp.allowedOrigins.join('\n'),
    claimKeysText: safeApp.claimKeys.join(', ')
  };
}

function decorateLog(record) {
  return {
    ...record,
    statusLabel: record.statusCode ? String(record.statusCode) : 'n/a',
    payloadJson: JSON.stringify(record.payload || {}, null, 2)
  };
}

function normalizeApp(app = {}) {
  const status = ['enabled', 'disabled', 'deleted'].includes(app.status) ? app.status : 'enabled';
  return {
    ...app,
    name: normalizeText(app.name, 160) || 'Connected app',
    description: normalizeText(app.description, 600),
    status,
    appType: normalizeText(app.appType, 80) || 'web',
    redirectUris: normalizeUriList(app.redirectUris),
    postLogoutRedirectUris: normalizeUriList(app.postLogoutRedirectUris),
    allowedOrigins: normalizeUriList(app.allowedOrigins),
    grantTypes: normalizeSelection(app.grantTypes, SUPPORTED_GRANTS, ['authorization_code']),
    scopes: normalizeSelection(app.scopes, DEFAULT_SCOPES, DEFAULT_SCOPES),
    claimKeys: normalizeSelection(app.claimKeys, DEFAULT_CLAIMS, DEFAULT_CLAIMS),
    onboardingMode: app.onboardingMode === 'open' ? 'open' : 'invite-only',
    walletChallengePolicy: normalizeWalletPolicy(app.walletChallengePolicy),
    signInChallengePolicy: normalizeSignInChallengePolicy(app.signInChallengePolicy),
    tokenEndpointAuthMethod: normalizeTokenAuthMethod(app.tokenEndpointAuthMethod),
    branding: normalizeBranding(app.branding || {}),
    emailTemplates: normalizeTemplates(app.emailTemplates || {}),
    messages: normalizeMessages(app.messages || {}),
    secretCredentials: Array.isArray(app.secretCredentials) ? app.secretCredentials : [],
    certificateCredentials: Array.isArray(app.certificateCredentials) ? app.certificateCredentials : []
  };
}

function normalizeUriList(value, fallback = []) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
  const normalized = source
    .map((item) => normalizeText(item, 500))
    .filter(Boolean)
    .filter((uri) => /^https?:\/\//i.test(uri) || uri.startsWith('http://localhost') || uri.startsWith('http://127.0.0.1'));
  return [...new Set(normalized)].slice(0, 20);
}

function normalizeSelection(value, allowed, fallback = []) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
  const selected = source.filter((item) => allowed.includes(item));
  return selected.length > 0 ? [...new Set(selected)] : [...fallback];
}

function normalizeBranding(value = {}, fallback = {}) {
  return {
    logoUrl: normalizeText(value.logoUrl, 500) || fallback.logoUrl || '',
    headerBackgroundColor: normalizeColor(value.headerBackgroundColor || fallback.headerBackgroundColor, '#334451'),
    footerBackgroundColor: normalizeColor(value.footerBackgroundColor || fallback.footerBackgroundColor, '#071928'),
    primaryColor: normalizeColor(value.primaryColor || fallback.primaryColor, '#216be6')
  };
}

function normalizeTemplates(value = {}, fallback = {}) {
  return {
    inviteSubject: normalizeText(value.inviteSubject || fallback.inviteSubject, 180) || 'You have been invited to use Aegis ID',
    inviteBody: normalizeText(value.inviteBody || fallback.inviteBody, 1200) || 'Open the invitation link and accept the credential in the Aegis ID mobile app.'
  };
}

function normalizeMessages(value = {}, fallback = {}) {
  return {
    signInTitle: normalizeText(value.signInTitle || fallback.signInTitle, 180) || 'Sign in with Aegis ID',
    successMessage: normalizeText(value.successMessage || fallback.successMessage, 500) || 'Authentication succeeded.',
    errorMessage: normalizeText(value.errorMessage || fallback.errorMessage, 500) || 'Authentication could not be completed.'
  };
}

function normalizeWalletPolicy(value = '') {
  return ['wallet', 'passkey', 'verified-id'].includes(value) ? value : 'wallet';
}

function normalizeSignInChallengePolicy(value = '') {
  return SIGN_IN_CHALLENGE_POLICIES.includes(value) ? value : 'disabled';
}

function normalizeTokenAuthMethod(value = '') {
  return ['client_secret_post', 'client_secret_basic', 'private_key_jwt'].includes(value) ? value : 'client_secret_post';
}

function normalizeCategory(value = '') {
  return ['auth', 'api', 'wallet'].includes(value) ? value : 'api';
}

function normalizeDate(value = '') {
  const text = normalizeText(value, 80);
  if (!text) {
    return '';
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item, 160)).filter(Boolean);
  }
  return String(value || '')
    .split(/[\s,]+/)
    .map((item) => normalizeText(item, 160))
    .filter(Boolean);
}

function normalizeColor(value = '', fallback = '#216be6') {
  const text = normalizeText(value, 20);
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function normalizeSubject(value = '') {
  return normalizeText(value, 220)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'aegis-user';
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase().slice(0, 220);
}

function normalizeText(value = '', max = 400) {
  return String(value || '').trim().slice(0, max);
}

function normalizeObject(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return JSON.parse(JSON.stringify(value));
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function enforceActiveCredentialLimit(credentials = [], label = 'credentials') {
  const activeCount = credentials.filter((credential) => !credential.revokedAt).length;
  if (activeCount >= MAX_APP_CREDENTIALS) {
    throw validationError(`A connected app can have at most ${MAX_APP_CREDENTIALS} active ${label}. Revoke or rotate an existing credential first.`);
  }
}

function getSecretEncryptionKey() {
  return crypto
    .createHash('sha256')
    .update(process.env.CONNECTED_APP_SECRET_ENCRYPTION_KEY || config.auth.sessionSecret || 'aegis-connected-app-secret-key')
    .digest();
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSecretEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url')
  ].join('.');
}

function decryptSecret(value) {
  const [version, ivText, tagText, encryptedText] = String(value || '').split('.');
  if (version !== 'v1' || !ivText || !tagText || !encryptedText) {
    throw validationError('Stored secret material is not readable. Rotate the secret and try again.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', getSecretEncryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function compareValues(left, right, direction) {
  const multiplier = direction === 'asc' ? 1 : -1;
  const leftValue = left || '';
  const rightValue = right || '';
  if (leftValue < rightValue) {
    return -1 * multiplier;
  }
  if (leftValue > rightValue) {
    return 1 * multiplier;
  }
  return 0;
}

function csvEscape(value) {
  const text = String(value || '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function grantLabel(value) {
  return {
    authorization_code: 'Authorization code',
    client_credentials: 'Client credentials',
    [CIBA_GRANT_TYPE]: 'Backchannel wallet challenge'
  }[value] || value;
}

function signInChallengeLabel(value) {
  return {
    disabled: 'No sign-in wallet challenge',
    wallet: 'Wallet approval at sign-in',
    passkey: 'Wallet plus passkey at sign-in',
    'verified-id': 'Verified credential at sign-in'
  }[value] || 'No sign-in wallet challenge';
}

function emptyPage() {
  return {
    rows: [],
    total: 0,
    hasRows: false,
    page: 1,
    pageSize: PAGE_SIZE_DEFAULT,
    totalPages: 1,
    hasPrevious: false,
    hasNext: false,
    search: '',
    category: '',
    sort: 'createdAt',
    direction: 'desc'
  };
}

function redact(value) {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) =>
        [/secret/i, /token/i, /authorization/i, /certificatePem/i].some((pattern) => pattern.test(key))
          ? [key, '[redacted]']
          : [key, redact(child)]
      )
    );
  }
  return value;
}

function ensureAppEnabled(app) {
  if (app.status !== 'enabled') {
    throw oauthError('invalid_client', 'Connected app is disabled.', 401);
  }
}

function ensureGrant(app, grantType) {
  if (!app.grantTypes.includes(grantType)) {
    throw oauthError('unsupported_grant_type', `${grantType} is not enabled for this client.`, 400);
  }
}

function validationError(message) {
  const error = new Error(message);
  error.status = 422;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function oauthError(code, message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.oauthError = code;
  return error;
}

module.exports = {
  authenticateConnectedClient,
  CIBA_GRANT_TYPE,
  createClientCredentialsToken,
  createBackchannelAuthenticationRequest,
  createConnectedApp,
  createConnectedAppSecret,
  createConnectedAppWalletChallenge,
  createConnectedAuthorizationCode,
  deleteConnectedApp,
  exchangeConnectedAuthorizationCode,
  exchangeBackchannelAuthenticationToken,
  exportConnectedAppLogsCsv,
  getConnectedApp,
  getConnectedAppByClientId,
  getConnectedAppsView,
  getDiscovery,
  getJwks,
  importConnectedAppCertificate,
  listConnectedAppLogs,
  logConnectedAppEvent,
  revealConnectedAppSecret,
  revokeConnectedAppSecret,
  setConnectedAppStatus,
  updateConnectedApp,
  verifyAccessToken
};
