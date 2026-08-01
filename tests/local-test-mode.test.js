const test = require('node:test');
const assert = require('node:assert/strict');

// The local sign-in bypass must be impossible to enable anywhere but a
// developer's own machine. Three independent conditions guard it, and these
// tests assert each one fails closed on its own.

const MODULES = ['../src/config', '../src/middleware/local-test-mode'];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

function withEnv(env, run) {
  const previous = { ...process.env };
  delete process.env.LOCAL_TEST_MODE;
  delete process.env.NODE_ENV;
  Object.assign(process.env, env);
  resetModules();
  try {
    return run({
      config: require('../src/config'),
      middleware: require('../src/middleware/local-test-mode')
    });
  } finally {
    process.env = previous;
    resetModules();
  }
}

const loopbackRequest = { socket: { remoteAddress: '127.0.0.1' }, ip: '127.0.0.1' };
const remoteRequest = { socket: { remoteAddress: '203.0.113.10' }, ip: '203.0.113.10' };

test('the bypass is off when the flag is not set', () => {
  withEnv({}, ({ config, middleware }) => {
    assert.equal(config.app.localTestMode, false);
    assert.equal(middleware.isLocalTestRequest(loopbackRequest), false);
  });
});

test('the bypass activates only with the flag, a dev build, and a loopback request', () => {
  withEnv({ LOCAL_TEST_MODE: 'true', NODE_ENV: 'development' }, ({ config, middleware }) => {
    assert.equal(config.app.localTestMode, true);
    assert.equal(middleware.isLocalTestRequest(loopbackRequest), true);
  });
});

test('GUARD — a production build refuses the flag entirely', () => {
  // dev, qa and prod all run NODE_ENV=production, so this one condition
  // excludes every hosted environment even from a loopback request.
  withEnv({ LOCAL_TEST_MODE: 'true', NODE_ENV: 'production' }, ({ config, middleware }) => {
    assert.equal(config.app.localTestMode, false, 'must never be active in a production build');
    assert.equal(middleware.isLocalTestRequest(loopbackRequest), false);
    assert.equal(config.app.localTestModeRequested, true, 'but the request is still recorded');
  });
});

test('GUARD — a non-loopback request is refused even on a dev build', () => {
  withEnv({ LOCAL_TEST_MODE: 'true', NODE_ENV: 'development' }, ({ middleware }) => {
    assert.equal(middleware.isLocalTestRequest(remoteRequest), false);
  });
});

test('loopback detection accepts the forms Node reports and rejects others', () => {
  withEnv({ LOCAL_TEST_MODE: 'true', NODE_ENV: 'development' }, ({ middleware }) => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']) {
      assert.equal(middleware.isLoopbackRequest({ socket: { remoteAddress: address } }), true, address);
    }
    for (const address of ['10.0.0.5', '192.168.1.20', '203.0.113.10', '', undefined]) {
      assert.equal(
        middleware.isLoopbackRequest({ socket: { remoteAddress: address } }),
        false,
        String(address)
      );
    }
  });
});

test('a proxied header cannot fake a loopback address', () => {
  withEnv({ LOCAL_TEST_MODE: 'true', NODE_ENV: 'development' }, ({ middleware }) => {
    // Only the real socket address is consulted, never a client-supplied header.
    const spoofed = {
      socket: { remoteAddress: '203.0.113.10' },
      ip: '203.0.113.10',
      headers: { 'x-forwarded-for': '127.0.0.1' }
    };
    assert.equal(middleware.isLocalTestRequest(spoofed), false);
  });
});

test('the middleware exposes the state without granting anything by itself', () => {
  withEnv({ LOCAL_TEST_MODE: 'true', NODE_ENV: 'development' }, ({ middleware }) => {
    const res = { locals: {} };
    let called = false;
    middleware.attachLocalTestMode(loopbackRequest, res, () => {
      called = true;
    });
    assert.equal(called, true);
    assert.equal(res.locals.localTestMode, true);
  });
});
