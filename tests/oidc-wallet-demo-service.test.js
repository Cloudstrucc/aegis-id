const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

test('OIDC wallet demo creates an OIDC session and unlocks after wallet challenge confirmation', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudstrucc-oidc-wallet-'));
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
              their_label: 'Cloudstrucc iOS Holder Stand-in'
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
  const previousIssuerUrl = process.env.ARIES_ISSUER_ADMIN_URL;
  process.env.OIDC_WALLET_SESSION_STORE_PATH = path.join(tempDir, 'sessions.json');
  process.env.ARIES_ISSUER_ADMIN_URL = `http://127.0.0.1:${server.address().port}`;
  resetDemoModules();

  t.after(() => {
    restoreEnv('OIDC_WALLET_SESSION_STORE_PATH', previousSessionPath);
    restoreEnv('ARIES_ISSUER_ADMIN_URL', previousIssuerUrl);
    resetDemoModules();
  });

  const {
    completeOidcCallback,
    confirmWalletChallenge,
    createLoginRequest,
    createWalletChallenge,
    isAuthenticated
  } = require('../src/services/oidc-wallet-demo-service');

  const login = await createLoginRequest('http://localhost:3000');
  assert.match(login.authorizationUrl, /\/demo\/oidc-wallet\/mock-authorize/);

  const oidcSession = await completeOidcCallback({
    state: login.session.state,
    code: 'mock-code'
  });
  assert.equal(oidcSession.status, 'oidc-authenticated');
  assert.equal(oidcSession.oidc.claims.email, 'identity@cloudstrucc.com');

  const challengedSession = await createWalletChallenge(oidcSession.id);
  assert.equal(challengedSession.status, 'wallet-challenge-sent');
  assert.equal(challengedSession.walletChallenge.connectionId, 'issuer-conn-1');
  assert.equal(challengedSession.walletChallenge.threadId, 'challenge-thread');

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
