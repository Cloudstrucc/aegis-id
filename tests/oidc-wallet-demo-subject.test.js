const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// The mock identity provider must sign in whoever the tester chose, otherwise
// the wallet challenge is addressed to a fixed demo user and never reaches the
// tester's own wallet.

const MODULES = ['../src/config', '../src/services/oidc-wallet-demo-service'];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withDemo(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-oidc-demo-'));
  const previous = { ...process.env };
  process.env.OIDC_WALLET_SESSION_STORE_PATH = path.join(dir, 'sessions.json');
  process.env.WALLET_CHALLENGE_STORE_PATH = path.join(dir, 'challenges.json');
  process.env.ISSUER_ORG_STORE_PATH = path.join(dir, 'orgs.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  resetModules();
  try {
    await run(require('../src/services/oidc-wallet-demo-service'));
  } finally {
    process.env = previous;
    resetModules();
  }
}

test('the mock provider signs in the chosen user', async () => {
  await withDemo(async (demo) => {
    const { session } = await demo.createLoginRequest('http://localhost:3000');
    await demo.setMockLogin(session.state, { email: 'holder@example.com', name: 'Real Holder' });

    const authenticated = await demo.completeOidcCallback({ state: session.state, code: 'mock-code-1' });

    assert.equal(authenticated.oidc.claims.email, 'holder@example.com');
    assert.equal(authenticated.oidc.claims.name, 'Real Holder');
    assert.equal(authenticated.oidc.claims.sub, 'holder@example.com');
  });
});

test('the demo user is still the fallback when nothing is chosen', async () => {
  await withDemo(async (demo) => {
    const { session } = await demo.createLoginRequest('http://localhost:3000');
    const authenticated = await demo.completeOidcCallback({ state: session.state, code: 'mock-code-1' });

    assert.equal(authenticated.oidc.claims.email, 'identity@vanguardcs.ca');
    assert.equal(authenticated.oidc.claims.sub, 'vanguard-demo-user');
  });
});

test('a blank email does not overwrite an existing choice', async () => {
  await withDemo(async (demo) => {
    const { session } = await demo.createLoginRequest('http://localhost:3000');
    await demo.setMockLogin(session.state, { email: 'holder@example.com' });
    await demo.setMockLogin(session.state, { email: '' });

    const authenticated = await demo.completeOidcCallback({ state: session.state, code: 'mock-code-1' });
    assert.equal(authenticated.oidc.claims.email, 'holder@example.com');
  });
});
