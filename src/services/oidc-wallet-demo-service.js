const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { listCompletedConnections, sendWalletChallenge } = require('../adapters/aries/aries-lab-adapter');
const {
  getIssuerOrganization,
  listConnectedIssuerOrganizations
} = require('./issuer-organization-service');
const { listPendingExternalWalletChallenges } = require('./wallet-challenge-service');

const store = new FileJsonStore(config.paths.oidcWalletSessions, []);

function createId() {
  return crypto.randomUUID();
}

function createToken(byteLength = 24) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

function nowIso() {
  return new Date().toISOString();
}

function expiresAtIso() {
  return new Date(Date.now() + config.oidcWalletDemo.sessionTtlSeconds * 1000).toISOString();
}

async function createLoginRequest(baseUrl) {
  const session = {
    id: createId(),
    state: createToken(),
    nonce: createToken(),
    mode: config.oidcWalletDemo.mode,
    status: 'oidc-started',
    oidc: {
      issuer: config.oidcWalletDemo.issuer,
      clientId: config.oidcWalletDemo.clientId,
      scope: config.oidcWalletDemo.scope
    },
    createdAt: nowIso(),
    expiresAt: expiresAtIso()
  };

  await store.append(session);

  return {
    session,
    authorizationUrl: buildAuthorizationUrl(session, baseUrl)
  };
}

function buildAuthorizationUrl(session, baseUrl) {
  const redirectUri = new URL(config.oidcWalletDemo.redirectPath, baseUrl).toString();
  const authorizationEndpoint = new URL(config.oidcWalletDemo.authorizationEndpoint, baseUrl);
  authorizationEndpoint.searchParams.set('client_id', config.oidcWalletDemo.clientId);
  authorizationEndpoint.searchParams.set('redirect_uri', redirectUri);
  authorizationEndpoint.searchParams.set('response_type', 'code');
  authorizationEndpoint.searchParams.set('scope', config.oidcWalletDemo.scope);
  authorizationEndpoint.searchParams.set('state', session.state);
  authorizationEndpoint.searchParams.set('nonce', session.nonce);

  return authorizationEndpoint.toString();
}

async function completeOidcCallback({ state, code }) {
  const session = await findByState(state);
  assertSessionActive(session);

  if (!code) {
    const error = new Error('OIDC callback did not include an authorization code.');
    error.status = 400;
    throw error;
  }

  const oidcClaims = buildMockClaims(session);
  return updateSession(session.id, (record) => ({
    ...record,
    status: 'oidc-authenticated',
    oidc: {
      ...record.oidc,
      code,
      claims: oidcClaims,
      authenticatedAt: nowIso()
    }
  }));
}

async function getDemoSession(sessionId) {
  const session = (await store.read()).find((record) => record.id === sessionId);
  assertSessionActive(session);
  return session;
}

async function listWalletConnections() {
  const organizations = await listConnectedIssuerOrganizations();
  if (organizations.length > 0) {
    return organizations.map((organization) => ({
      id: organization.organizationId,
      organizationId: organization.organizationId,
      organizationName: organization.organizationName,
      label: organization.organizationName,
      connectionId: organization.issuerConnectionId,
      status: organization.status,
      type: 'issuer-organization'
    }));
  }

  const connections = await listCompletedConnections('issuer');
  return connections.map((connection) => ({
    id: connection.connection_id,
    organizationId: null,
    organizationName: null,
    label: connection.their_label || 'Vanguard Aegis ID wallet',
    connectionId: connection.connection_id,
    status: connection.rfc23_state || connection.state || 'unknown',
    type: 'raw-connection'
  }));
}

async function createWalletChallenge(sessionId, options = {}) {
  const session = await getDemoSession(sessionId);

  if (!['oidc-authenticated', 'wallet-challenge-sent'].includes(session.status)) {
    const error = new Error('Complete OIDC login before requesting a wallet challenge.');
    error.status = 409;
    throw error;
  }

  const nonce = createToken(18);
  const subject = session.oidc?.claims?.email || session.oidc?.claims?.sub || 'unknown-subject';
  const issuerOrganization = options.organizationId ? await getIssuerOrganization(options.organizationId) : null;
  if (options.organizationId && !issuerOrganization) {
    const error = new Error('Selected issuing org is not connected to the wallet yet.');
    error.status = 409;
    error.details = {
      hint: 'Create the org issuer invitation from the subscriber dashboard, accept it in the iOS wallet, then try again.'
    };
    throw error;
  }
  const connectionId = issuerOrganization?.issuerConnectionId || options.connectionId || undefined;
  const organizationName = issuerOrganization?.organizationName || options.organizationName || 'Vanguard Aries Issuer';
  const challenge = await sendWalletChallenge('issuer', {
    connectionId,
    comment: `${organizationName} OIDC step-up challenge ${nonce}`,
    content: [
      `${organizationName} OIDC wallet challenge`,
      `session=${session.id}`,
      `nonce=${nonce}`,
      `subject=${subject}`,
      `issuerOrg=${issuerOrganization?.organizationId || 'raw-connection'}`,
      'Accept this in the Vanguard Aegis ID wallet to unlock the protected web app.'
    ].join('\n')
  });

  return updateSession(session.id, (record) => ({
    ...record,
    status: 'wallet-challenge-sent',
    walletChallenge: {
      id: createId(),
      nonce,
      status: 'sent',
      agent: challenge.agent,
      organizationId: issuerOrganization?.organizationId || null,
      organizationName,
      connectionId: challenge.connectionId,
      threadId: challenge.ping?.thread_id || null,
      sentAt: nowIso()
    }
  }));
}

async function confirmWalletChallenge(sessionId) {
  const session = await getDemoSession(sessionId);

  if (session.status !== 'wallet-challenge-sent') {
    const error = new Error('Send the wallet challenge before confirming it.');
    error.status = 409;
    throw error;
  }

  return updateSession(session.id, (record) => ({
    ...record,
    status: 'authenticated',
    walletChallenge: {
      ...record.walletChallenge,
      status: 'accepted',
      acceptedAt: nowIso()
    },
    authenticatedAt: nowIso()
  }));
}

async function listPendingWalletChallenges(connectionId) {
  const records = await store.read();
  const oidcChallenges = records
    .filter((record) => {
      if (record.status !== 'wallet-challenge-sent' || record.walletChallenge?.status !== 'sent') {
        return false;
      }

      if (connectionId && record.walletChallenge.connectionId !== connectionId) {
        return false;
      }

      return new Date(record.expiresAt).getTime() >= Date.now();
    })
    .map((record) => ({
      sessionId: record.id,
      challengeId: record.walletChallenge.id,
      nonce: record.walletChallenge.nonce,
      status: record.walletChallenge.status,
      connectionId: record.walletChallenge.connectionId,
      organizationId: record.walletChallenge.organizationId || null,
      organizationName: record.walletChallenge.organizationName || 'Vanguard Aries Issuer',
      threadId: record.walletChallenge.threadId,
      sentAt: record.walletChallenge.sentAt,
      subject: record.oidc?.claims?.email || record.oidc?.claims?.sub || 'unknown-subject',
      issuer: record.oidc?.claims?.iss || record.oidc?.issuer,
      appName: 'OIDC Wallet Demo',
      action: 'sign-in',
      challengeType: 'authentication',
      title: 'OIDC Wallet Demo: Sign In',
      detail: `${record.oidc?.claims?.email || record.oidc?.claims?.sub || 'unknown-subject'} must accept a sign-in challenge.`,
      acceptPath: `/api/oidc-wallet/challenges/${record.id}/accept`,
      payloadFields: [
        { key: 'appName', value: 'OIDC Wallet Demo' },
        { key: 'action', value: 'sign-in' },
        { key: 'sessionId', value: record.id },
        { key: 'issuer', value: record.oidc?.claims?.iss || record.oidc?.issuer || '' }
      ]
    }));
  const externalChallenges = await listPendingExternalWalletChallenges(connectionId);
  return [...oidcChallenges, ...externalChallenges];
}

async function updateSession(sessionId, updater) {
  const records = await store.read();
  const index = records.findIndex((record) => record.id === sessionId);
  if (index === -1) {
    const error = new Error('Demo session not found.');
    error.status = 404;
    throw error;
  }

  records[index] = updater(records[index]);
  await store.write(records);
  return records[index];
}

async function findByState(state) {
  const session = (await store.read()).find((record) => record.state === state);
  if (!session) {
    const error = new Error('OIDC state was not recognized.');
    error.status = 400;
    throw error;
  }
  return session;
}

function assertSessionActive(session) {
  if (!session) {
    const error = new Error('Demo session not found.');
    error.status = 404;
    throw error;
  }

  if (new Date(session.expiresAt).getTime() < Date.now()) {
    const error = new Error('Demo session expired. Start a new OIDC login.');
    error.status = 410;
    throw error;
  }
}

function buildMockClaims(session) {
  return {
    iss: config.oidcWalletDemo.issuer,
    sub: 'vanguard-demo-user',
    aud: config.oidcWalletDemo.clientId,
    email: 'identity@vanguardcs.ca',
    name: 'Vanguard Demo User',
    acr: 'urn:vanguard:aegis-id:auth:oidc-password',
    nonce: session.nonce,
    auth_time: Math.floor(Date.now() / 1000)
  };
}

function buildFlowSteps(status) {
  return [
    {
      label: 'OIDC login',
      state: ['oidc-authenticated', 'wallet-challenge-sent', 'authenticated'].includes(status) ? 'complete' : 'active'
    },
    {
      label: 'Wallet challenge',
      state:
        status === 'authenticated'
          ? 'complete'
          : status === 'wallet-challenge-sent'
            ? 'active'
            : 'pending'
    },
    {
      label: 'App access',
      state: status === 'authenticated' ? 'complete' : 'pending'
    }
  ];
}

function isAuthenticated(session) {
  return session?.status === 'authenticated';
}

module.exports = {
  buildAuthorizationUrl,
  buildFlowSteps,
  confirmWalletChallenge,
  createLoginRequest,
  createWalletChallenge,
  completeOidcCallback,
  getDemoSession,
  isAuthenticated,
  listPendingWalletChallenges,
  listWalletConnections
};
