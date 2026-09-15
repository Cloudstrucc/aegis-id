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

test('WALLET_SIGNIN_FORCE_ENABLED pins wallet approval on, over a stored off', async () => {
  await withEnv(async () => {
    const fs = require('node:fs/promises');
    // A store that explicitly turned wallet off, as a prod store might hold.
    await fs.writeFile(process.env.SIGN_IN_METHOD_STORE_PATH, JSON.stringify({
      password: { enabled: true, firstFactor: true, satisfiesSecond: false },
      wallet: { enabled: false, firstFactor: false, satisfiesSecond: false }
    }));

    process.env.WALLET_SIGNIN_FORCE_ENABLED = 'true';
    resetModules();
    const forced = require('../src/services/sign-in-methods-service');
    assert.equal(await forced.isFirstFactorEnabled('wallet'), true, 'the force overrides the stored off');
    assert.equal(await forced.satisfiesSecondFactor('wallet'), true);
    // Password is untouched and still a first factor, so wallet is never the
    // only way in.
    assert.equal(await forced.isFirstFactorEnabled('password'), true);

    delete process.env.WALLET_SIGNIN_FORCE_ENABLED;
    resetModules();
    const unforced = require('../src/services/sign-in-methods-service');
    assert.equal(await unforced.isFirstFactorEnabled('wallet'), false, 'without the force the stored off stands');
  });
});
