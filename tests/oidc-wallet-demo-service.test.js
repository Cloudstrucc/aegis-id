const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

test('OIDC wallet demo creates an OIDC session and unlocks after wallet challenge confirmation', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vanguard-oidc-wallet-'));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    requests.push({ method: req.method, url: req.url, body });

    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/connections') {
      res.end(
        JSON.stringify({
          results: [
            {
              connection_id: 'issuer-conn-1',
              state: 'active',
              rfc23_state: 'completed',
              their_label: 'Vanguard iOS Holder Stand-in'
            }
          ]
        })
      );
      return;
    }

    if (req.url.endsWith('/send-ping')) {
      res.end(JSON.stringify({ thread_id: 'challenge-thread' }));
      return;
    }

    res.end(JSON.stringify({}));
  });

  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());

  const previousSessionPath = process.env.OIDC_WALLET_SESSION_STORE_PATH;
  const previousIssuerOrgPath = process.env.ISSUER_ORG_STORE_PATH;
  const previousIssuerUrl = process.env.ARIES_ISSUER_ADMIN_URL;
  process.env.OIDC_WALLET_SESSION_STORE_PATH = path.join(tempDir, 'sessions.json');
  process.env.ISSUER_ORG_STORE_PATH = path.join(tempDir, 'issuer-organizations.json');
  process.env.ARIES_ISSUER_ADMIN_URL = `http://127.0.0.1:${server.address().port}`;
  await fs.writeFile(
    process.env.ISSUER_ORG_STORE_PATH,
    JSON.stringify(
      [
        {
          id: 'issuer-org-record-1',
          subscriptionId: 'subscription-1',
          organizationId: 'org-1',
          organizationName: 'Vanguard Cloud Services',
          label: 'Vanguard Cloud Services Issuer',
          invitationId: 'invitation-1',
          issuerConnectionId: 'issuer-conn-1',
          holderConnectionId: 'holder-conn-1',
          status: 'connected',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      null,
      2
    ),
    'utf8'
  );
  resetDemoModules();

  t.after(() => {
    restoreEnv('OIDC_WALLET_SESSION_STORE_PATH', previousSessionPath);
    restoreEnv('ISSUER_ORG_STORE_PATH', previousIssuerOrgPath);
    restoreEnv('ARIES_ISSUER_ADMIN_URL', previousIssuerUrl);
    resetDemoModules();
  });

  const {
    completeOidcCallback,
    confirmWalletChallenge,
    createLoginRequest,
    createWalletChallenge,
    isAuthenticated,
    listPendingWalletChallenges,
    listWalletConnections
  } = require('../src/services/oidc-wallet-demo-service');

  const login = await createLoginRequest('http://localhost:3000');
  assert.match(login.authorizationUrl, /\/demo\/oidc-wallet\/mock-authorize/);

  const oidcSession = await completeOidcCallback({
    state: login.session.state,
    code: 'mock-code'
  });
  assert.equal(oidcSession.status, 'oidc-authenticated');
  assert.equal(oidcSession.oidc.claims.email, 'identity@vanguardcs.ca');

  const connections = await listWalletConnections();
  assert.equal(connections[0].type, 'issuer-organization');
  assert.equal(connections[0].organizationId, 'org-1');
  assert.equal(connections[0].label, 'Vanguard Cloud Services');

  const challengedSession = await createWalletChallenge(oidcSession.id, { organizationId: 'org-1' });
  assert.equal(challengedSession.status, 'wallet-challenge-sent');
  assert.equal(challengedSession.walletChallenge.organizationId, 'org-1');
  assert.equal(challengedSession.walletChallenge.organizationName, 'Vanguard Cloud Services');
  assert.equal(challengedSession.walletChallenge.connectionId, 'issuer-conn-1');
  assert.equal(challengedSession.walletChallenge.threadId, 'challenge-thread');

  const pendingChallenges = await listPendingWalletChallenges('issuer-conn-1');
  assert.equal(pendingChallenges[0].organizationId, 'org-1');
  assert.equal(pendingChallenges[0].organizationName, 'Vanguard Cloud Services');

  const authenticatedSession = await confirmWalletChallenge(challengedSession.id);
  assert.equal(authenticatedSession.status, 'authenticated');
  assert.equal(authenticatedSession.walletChallenge.status, 'accepted');
  assert.equal(isAuthenticated(authenticatedSession), true);
  assert.equal(requests.some((request) => request.url.endsWith('/send-message')), true);
});

function resetDemoModules() {
  for (const modulePath of [
    '../src/config',
    '../src/adapters/aries/aries-lab-adapter',
    '../src/services/issuer-organization-service',
    '../src/services/oidc-wallet-demo-service'
  ]) {
    delete require.cache[require.resolve(modulePath)];
  }
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
