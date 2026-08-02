const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Phase 3: the sign-in method registry, and the lockout invariant that keeps an
// admin from removing every way into the platform.

const MODULES = [
  '../src/config',
  '../src/services/sign-in-methods-service',
  '../src/services/audit-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-signin-'));
  const previous = { ...process.env };
  process.env.SIGN_IN_METHOD_STORE_PATH = path.join(dir, 'sign-in-methods.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  resetModules();
  try {
    await run({ dir });
  } finally {
    process.env = previous;
    resetModules();
  }
}

test('password and passkey are available out of the box', async () => {
  await withEnv(async () => {
    const service = require('../src/services/sign-in-methods-service');
    assert.equal(await service.isFirstFactorEnabled('password'), true);
    assert.equal(await service.isFirstFactorEnabled('passkey'), true);
  });
});

test('a verified passkey completes a sign-in but a password never does', async () => {
  await withEnv(async () => {
    const service = require('../src/services/sign-in-methods-service');
    assert.equal(await service.satisfiesSecondFactor('passkey'), true);
    assert.equal(await service.satisfiesSecondFactor('password'), false);
  });
});

test('methods that are not built yet cannot be switched on', async () => {
  await withEnv(async () => {
    const service = require('../src/services/sign-in-methods-service');
    await service.updateSignInMethods(
      {
        method_password_enabled: 'true',
        method_password_first: 'true',
        method_entra_enabled: 'true',
        method_entra_first: 'true'
      },
      'admin@example.com'
    );

    // Entra is declared in the catalog so it can be shown in the admin UI, but
    // enabling it before it exists would hand people a button that cannot work.
    assert.equal(await service.isFirstFactorEnabled('entra'), false);
  });
});

test('the last first-factor method cannot be disabled', async () => {
  await withEnv(async () => {
    const service = require('../src/services/sign-in-methods-service');
    await assert.rejects(
      () => service.updateSignInMethods({}, 'admin@example.com'),
      /At least one sign-in method must stay enabled/
    );

    // The refusal must leave the previous configuration intact.
    assert.equal(await service.isFirstFactorEnabled('password'), true);
  });
});

test('wallet approval cannot be the only way in', async () => {
  await withEnv(async () => {
    const service = require('../src/services/sign-in-methods-service');
    // Pretend wallet sign-in has shipped, so only the bootstrap rule is under
    // test rather than the not-implemented guard.
    service.CATALOG.wallet.implemented = true;
    try {
      await assert.rejects(
        () =>
          service.updateSignInMethods(
            { method_wallet_enabled: 'true', method_wallet_first: 'true' },
            'admin@example.com'
          ),
        /cannot be the only sign-in method/
      );
    } finally {
      service.CATALOG.wallet.implemented = false;
    }
  });
});

test('disabling a method takes effect', async () => {
  await withEnv(async () => {
    const service = require('../src/services/sign-in-methods-service');
    await service.updateSignInMethods(
      { method_password_enabled: 'true', method_password_first: 'true' },
      'admin@example.com'
    );
    assert.equal(await service.isFirstFactorEnabled('passkey'), false);
    assert.equal(await service.isFirstFactorEnabled('password'), true);
  });
});
