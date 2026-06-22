const express = require('express');

const config = require('../config');
const { requireAuthenticated } = require('../middleware/auth');
const { writeAuditEvent } = require('../services/audit-service');
const {
  buildFlowSteps,
  completeOidcCallback,
  confirmWalletChallenge,
  createLoginRequest,
  createWalletChallenge,
  declineWalletChallenge,
  getDemoSession,
  isAuthenticated,
  listPendingWalletChallenges,
  listWalletConnections
} = require('../services/oidc-wallet-demo-service');
const { authorize } = require('../middleware/authorization');

const router = express.Router();
router.use('/demo/oidc-wallet', requireAuthenticated);

router.get('/demo/oidc-wallet', async (req, res) => {
  const connectionState = await loadConnectionState();

  res.render('pages/oidc-wallet-demo', {
    title: 'OIDC Wallet Challenge Demo',
    description: 'Example OIDC app that requires a Vanguard Aegis ID wallet challenge before access.',
    demoMode: config.oidcWalletDemo.mode,
    clientId: config.oidcWalletDemo.clientId,
    issuer: config.oidcWalletDemo.issuer,
    connectionCount: connectionState.connections.length,
    connectionError: connectionState.error
  });
});

router.post('/demo/oidc-wallet/login', authorize('oidcDemo.use'), async (req, res, next) => {
  try {
    const { session, authorizationUrl } = await createLoginRequest(getRequestBaseUrl(req));
    await writeAuditEvent('oidc-wallet-demo.login.started', {
      sessionId: session.id,
      mode: session.mode,
      issuer: session.oidc.issuer
    });

    res.redirect(303, authorizationUrl);
  } catch (error) {
    next(error);
  }
});

router.get('/demo/oidc-wallet/mock-authorize', (req, res) => {
  res.render('pages/oidc-wallet-mock-authorize', {
    title: 'Mock OIDC Provider',
    description: 'Mock OIDC authorization page for the Vanguard Aegis ID wallet challenge demo.',
    clientId: req.query.client_id,
    scope: req.query.scope,
    state: req.query.state,
    nonce: req.query.nonce,
    redirectUri: req.query.redirect_uri
  });
});

router.post('/demo/oidc-wallet/mock-authorize', authorize('api.oidcProvider.external'), (req, res) => {
  const redirectUri = new URL(req.body.redirectUri);
  redirectUri.searchParams.set('code', `mock-code-${Date.now()}`);
  redirectUri.searchParams.set('state', req.body.state);
  res.redirect(303, redirectUri.toString());
});

router.get('/demo/oidc-wallet/callback', async (req, res, next) => {
  try {
    const session = await completeOidcCallback({
      state: req.query.state,
      code: req.query.code
    });

    await writeAuditEvent('oidc-wallet-demo.oidc.completed', {
      sessionId: session.id,
      subject: session.oidc.claims.sub,
      email: session.oidc.claims.email
    });

    res.redirect(303, `/demo/oidc-wallet/sessions/${session.id}/challenge`);
  } catch (error) {
    next(error);
  }
});

router.get('/demo/oidc-wallet/sessions/:sessionId/challenge', async (req, res, next) => {
  try {
    const session = await getDemoSession(req.params.sessionId);
    if (isAuthenticated(session)) {
      return res.redirect(303, `/demo/oidc-wallet/sessions/${session.id}/app`);
    }

    const connectionState = await loadConnectionState();
    return res.render('pages/oidc-wallet-challenge', buildChallengeView(session, connectionState));
  } catch (error) {
    next(error);
  }
});

router.post('/demo/oidc-wallet/sessions/:sessionId/challenge', authorize('oidcDemo.use'), async (req, res, next) => {
  try {
    const issuerChoice = parseIssuerChoice(req.body.issuerChoice);
    const session = await createWalletChallenge(req.params.sessionId, {
      organizationId: issuerChoice.organizationId,
      connectionId: issuerChoice.connectionId
    });

    await writeAuditEvent('oidc-wallet-demo.challenge.sent', {
      sessionId: session.id,
      organizationId: session.walletChallenge.organizationId,
      organizationName: session.walletChallenge.organizationName,
      connectionId: session.walletChallenge.connectionId,
      threadId: session.walletChallenge.threadId
    });

    res.redirect(303, `/demo/oidc-wallet/sessions/${session.id}/challenge`);
  } catch (error) {
    try {
      const session = await getDemoSession(req.params.sessionId);
      const connectionState = await loadConnectionState();
      return res.status(error.status || 500).render(
        'pages/oidc-wallet-challenge',
        buildChallengeView(session, connectionState, {
          title: 'Challenge could not be sent',
          message: error.message,
          details: error.details
        })
      );
    } catch (renderError) {
      return next(renderError);
    }
  }
});

router.post('/demo/oidc-wallet/sessions/:sessionId/complete', authorize('oidcDemo.use'), async (req, res, next) => {
  try {
    const session = await confirmWalletChallenge(req.params.sessionId);
    await writeAuditEvent('oidc-wallet-demo.challenge.accepted', {
      sessionId: session.id,
      connectionId: session.walletChallenge.connectionId,
      challengeId: session.walletChallenge.id
    });

    res.redirect(303, `/demo/oidc-wallet/sessions/${session.id}/app`);
  } catch (error) {
    next(error);
  }
});

router.get('/demo/oidc-wallet/sessions/:sessionId/app', async (req, res, next) => {
  try {
    const session = await getDemoSession(req.params.sessionId);
    if (!isAuthenticated(session)) {
      return res.redirect(303, `/demo/oidc-wallet/sessions/${session.id}/challenge`);
    }

    return res.render('pages/oidc-wallet-app', {
      title: 'Protected OIDC App',
      description: 'Protected app unlocked by OIDC plus Vanguard Aegis ID wallet challenge.',
      session,
      claims: session.oidc.claims,
      flowSteps: buildFlowSteps(session.status)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/api/oidc-wallet/challenges', async (req, res, next) => {
  try {
    res.json({
      challenges: await listPendingWalletChallenges(req.query.connectionId)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/api/oidc-wallet/challenges/:sessionId/accept', authorize('api.walletChallenge.external'), async (req, res, next) => {
  try {
    const session = await confirmWalletChallenge(req.params.sessionId);
    await writeAuditEvent('oidc-wallet-demo.challenge.accepted', {
      sessionId: session.id,
      connectionId: session.walletChallenge.connectionId,
      challengeId: session.walletChallenge.id,
      source: 'wallet-api'
    });

    res.json({
      ok: true,
      status: session.status,
      appUrl: `/demo/oidc-wallet/sessions/${session.id}/app`
    });
  } catch (error) {
    next(error);
  }
});

router.post('/api/oidc-wallet/challenges/:sessionId/decline', authorize('api.walletChallenge.external'), async (req, res, next) => {
  try {
    const session = await declineWalletChallenge(req.params.sessionId, {
      reason: req.body.reason
    });
    await writeAuditEvent('oidc-wallet-demo.challenge.declined', {
      sessionId: session.id,
      connectionId: session.walletChallenge.connectionId,
      challengeId: session.walletChallenge.id,
      reason: session.walletChallenge.declineReason,
      source: 'wallet-api'
    });

    res.json({
      ok: true,
      status: session.status,
      walletChallenge: session.walletChallenge
    });
  } catch (error) {
    next(error);
  }
});

router.get('/api/oidc-wallet/sessions/:sessionId', async (req, res, next) => {
  try {
    const session = await getDemoSession(req.params.sessionId);
    res.json({
      id: session.id,
      status: session.status,
      walletChallenge: session.walletChallenge || null,
      appUrl: isAuthenticated(session) ? `/demo/oidc-wallet/sessions/${session.id}/app` : null
    });
  } catch (error) {
    next(error);
  }
});

async function loadConnectionState() {
  try {
    const connections = await listWalletConnections();
    return {
      connections: connections.map((connection) => ({
        id: connection.id,
        organizationId: connection.organizationId,
        choiceValue: connection.organizationId ? `org:${connection.organizationId}` : `conn:${connection.connectionId}`,
        label: connection.label,
        state: connection.status,
        connectionId: connection.connectionId,
        type: connection.type,
        selected: false
      })),
      error: null
    };
  } catch (error) {
    return {
      connections: [],
      error: error.hint || error.message
    };
  }
}

function buildChallengeView(session, connectionState, challengeError = null) {
  const connections = connectionState.connections.map((connection, index) => ({
    ...connection,
    selected:
      connection.organizationId === session.walletChallenge?.organizationId ||
      connection.connectionId === session.walletChallenge?.connectionId ||
      (!session.walletChallenge && index === connectionsLastIndex(connectionState.connections))
  }));

  return {
    title: 'Wallet Challenge Required',
    description: 'OIDC succeeded. Complete the Vanguard Aegis ID wallet challenge to enter the app.',
    session,
    claims: session.oidc.claims,
    flowSteps: buildFlowSteps(session.status),
    connections,
    connectionError: connectionState.error,
    hasConnections: connections.length > 0,
    challengeSent: session.status === 'wallet-challenge-sent',
    challengeError
  };
}

function connectionsLastIndex(connections) {
  return Math.max(0, connections.length - 1);
}

function parseIssuerChoice(value = '') {
  if (value.startsWith('org:')) {
    return { organizationId: value.slice(4), connectionId: undefined };
  }
  if (value.startsWith('conn:')) {
    return { organizationId: undefined, connectionId: value.slice(5) };
  }
  return { organizationId: undefined, connectionId: undefined };
}

function getRequestBaseUrl(req) {
  if (config.oidcWalletDemo.publicBaseUrl) {
    return config.oidcWalletDemo.publicBaseUrl;
  }

  return `${req.protocol}://${req.get('host')}`;
}

module.exports = router;
