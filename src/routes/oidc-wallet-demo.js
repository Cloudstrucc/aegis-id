const express = require('express');

const config = require('../config');
const { writeAuditEvent } = require('../services/audit-service');
const {
  buildFlowSteps,
  completeOidcCallback,
  confirmWalletChallenge,
  createLoginRequest,
  createWalletChallenge,
  getDemoSession,
  isAuthenticated,
  listPendingWalletChallenges,
  listWalletConnections
} = require('../services/oidc-wallet-demo-service');

const router = express.Router();

router.get('/demo/oidc-wallet', async (req, res) => {
  const connectionState = await loadConnectionState();

  res.render('pages/oidc-wallet-demo', {
    title: 'OIDC Wallet Challenge Demo',
    description: 'Example OIDC app that requires a Cloudstrucc wallet challenge before access.',
    demoMode: config.oidcWalletDemo.mode,
    clientId: config.oidcWalletDemo.clientId,
    issuer: config.oidcWalletDemo.issuer,
    connectionCount: connectionState.connections.length,
    connectionError: connectionState.error
  });
});

router.post('/demo/oidc-wallet/login', async (req, res, next) => {
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
    description: 'Mock OIDC authorization page for the Cloudstrucc wallet challenge demo.',
    clientId: req.query.client_id,
    scope: req.query.scope,
    state: req.query.state,
    nonce: req.query.nonce,
    redirectUri: req.query.redirect_uri
  });
});

router.post('/demo/oidc-wallet/mock-authorize', (req, res) => {
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

router.post('/demo/oidc-wallet/sessions/:sessionId/challenge', async (req, res, next) => {
  try {
    const session = await createWalletChallenge(req.params.sessionId, {
      connectionId: req.body.connectionId
    });

    await writeAuditEvent('oidc-wallet-demo.challenge.sent', {
      sessionId: session.id,
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

router.post('/demo/oidc-wallet/sessions/:sessionId/complete', async (req, res, next) => {
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
      description: 'Protected app unlocked by OIDC plus Cloudstrucc wallet challenge.',
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

router.post('/api/oidc-wallet/challenges/:sessionId/accept', async (req, res, next) => {
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
        id: connection.connection_id,
        label: connection.their_label || 'Cloudstrucc wallet',
        state: connection.rfc23_state || connection.state || 'unknown',
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
    selected: connection.id === session.walletChallenge?.connectionId || (!session.walletChallenge && index === connectionsLastIndex(connectionState.connections))
  }));

  return {
    title: 'Wallet Challenge Required',
    description: 'OIDC succeeded. Complete the Cloudstrucc wallet challenge to enter the app.',
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

function getRequestBaseUrl(req) {
  if (config.oidcWalletDemo.publicBaseUrl) {
    return config.oidcWalletDemo.publicBaseUrl;
  }

  return `${req.protocol}://${req.get('host')}`;
}

module.exports = router;
