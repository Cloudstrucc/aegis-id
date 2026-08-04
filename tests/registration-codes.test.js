const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Phase 3: registration codes.
//
// A code is a free paid subscription, so it is treated like a credential: only
// a hash is stored, it is scoped to an environment so a dev code cannot buy a
// prod plan, and every failure gives the same answer so the endpoint cannot be
// used to discover which codes exist.

const MODULES = [
  '../src/config',
  '../src/services/registration-code-service',
  '../src/services/audit-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(deployEnv, run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-codes-'));
  const previous = { ...process.env };
  process.env.APP_ENV = deployEnv;
  process.env.REGISTRATION_CODE_STORE_PATH = path.join(dir, 'codes.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  resetModules();
  try {
    await run({ dir, codes: require('../src/services/registration-code-service') });
  } finally {
    process.env = previous;
    resetModules();
  }
}

/**
 * Re-open the same store as a different environment, which is how a code
 * minted for dev is checked against prod.
 */
async function asEnvironment(dir, deployEnv, run) {
  const previous = { ...process.env };
  process.env.APP_ENV = deployEnv;
  process.env.REGISTRATION_CODE_STORE_PATH = path.join(dir, 'codes.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  resetModules();
  try {
    await run(require('../src/services/registration-code-service'));
  } finally {
    process.env = previous;
    resetModules();
  }
}

test('a code grants its plan when redeemed in a permitted environment', async () => {
  await withEnv('dev', async ({ codes }) => {
    const { code } = await codes.createRegistrationCode({
      planId: 'pro',
      environments: ['dev'],
      actorEmail: 'admin@example.com'
    });

    const redeemed = await codes.redeemRegistrationCode(code, { email: 'tester@example.com' });
    assert.equal(redeemed.planId, 'pro');
    assert.equal(redeemed.plan.maxWorkspaces, 2);
  });
});

test('a dev code is worthless against prod', async () => {
  await withEnv('dev', async ({ dir, codes }) => {
    const { code } = await codes.createRegistrationCode({ planId: 'enterprise', environments: ['dev'] });

    // The whole point of scoping: leaking the dev codes must not cost revenue.
    await asEnvironment(dir, 'prod', async (prodCodes) => {
      await assert.rejects(() => prodCodes.redeemRegistrationCode(code, {}), /not valid/);
      assert.equal(await prodCodes.previewRegistrationCode(code), null);
    });

    // Still good where it was minted.
    await asEnvironment(dir, 'dev', async (devCodes) => {
      assert.equal((await devCodes.redeemRegistrationCode(code, {})).planId, 'enterprise');
    });
  });
});

test('a code is never stored in plaintext', async () => {
  await withEnv('dev', async ({ dir, codes }) => {
    const { code } = await codes.createRegistrationCode({ planId: 'basic', environments: ['dev'] });
    const stored = await fs.readFile(path.join(dir, 'codes.json'), 'utf8');

    const normalized = code.replace(/-/g, '');
    assert.equal(stored.includes(code), false);
    assert.equal(stored.includes(normalized), false, 'nor without its formatting');
  });
});

test('a single-use code cannot be redeemed twice', async () => {
  await withEnv('qa', async ({ codes }) => {
    const { code } = await codes.createRegistrationCode({ planId: 'basic', environments: ['qa'] });
    await codes.redeemRegistrationCode(code, { email: 'first@example.com' });
    await assert.rejects(() => codes.redeemRegistrationCode(code, { email: 'second@example.com' }), /not valid/);
  });
});

test('a multi-use code spends one redemption at a time', async () => {
  await withEnv('qa', async ({ codes }) => {
    const { code } = await codes.createRegistrationCode({
      planId: 'basic',
      environments: ['qa'],
      maxRedemptions: 3
    });

    for (let index = 0; index < 3; index += 1) {
      await codes.redeemRegistrationCode(code, { email: `t${index}@example.com` });
    }
    await assert.rejects(() => codes.redeemRegistrationCode(code, {}), /not valid/);

    const [record] = await codes.listRegistrationCodes();
    assert.equal(record.redemptionCount, 3);
    assert.equal(record.remaining, 0);
    assert.equal(record.isSpent, true);
  });
});

test('an expired code is refused', async () => {
  await withEnv('dev', async ({ dir, codes }) => {
    const { code } = await codes.createRegistrationCode({
      planId: 'basic',
      environments: ['dev'],
      expiresInDays: 1
    });

    // Move the expiry into the past rather than waiting a day.
    const records = JSON.parse(await fs.readFile(path.join(dir, 'codes.json'), 'utf8'));
    records[0].expiresAt = new Date(Date.now() - 1000).toISOString();
    await fs.writeFile(path.join(dir, 'codes.json'), JSON.stringify(records, null, 2));

    await assert.rejects(() => codes.redeemRegistrationCode(code, {}), /not valid/);
  });
});

test('a revoked code stops working but keeps its history', async () => {
  await withEnv('dev', async ({ codes }) => {
    const { code, record } = await codes.createRegistrationCode({
      planId: 'pro',
      environments: ['dev'],
      maxRedemptions: 5
    });
    await codes.redeemRegistrationCode(code, { email: 'early@example.com' });
    await codes.revokeRegistrationCode(record.id, { actorEmail: 'admin@example.com' });

    await assert.rejects(() => codes.redeemRegistrationCode(code, {}), /not valid/);

    const [after] = await codes.listRegistrationCodes();
    assert.equal(after.isRevoked, true);
    assert.equal(after.redemptionCount, 1, 'what it already granted is still recorded');
  });
});

test('every failure gives the same answer', async () => {
  await withEnv('dev', async ({ dir, codes }) => {
    const { code } = await codes.createRegistrationCode({ planId: 'basic', environments: ['dev'] });
    await codes.redeemRegistrationCode(code, {});

    const messages = [];
    for (const candidate of [code, 'ZZZZ-ZZZZ-ZZZZ', '', 'nonsense']) {
      await codes.redeemRegistrationCode(candidate, {}).catch((error) => messages.push(error.message));
    }

    // A spent code, an unknown code and junk must be indistinguishable, or the
    // endpoint becomes a way to find out which codes exist.
    assert.equal(new Set(messages).size, 1, `got: ${[...new Set(messages)].join(' | ')}`);
    assert.match(messages[0], /not valid/);
  });
});

test('a code cannot be minted for every environment at once', async () => {
  await withEnv('dev', async ({ codes }) => {
    // "all" would quietly include prod, which is a free paid subscription.
    await assert.rejects(
      () => codes.createRegistrationCode({ planId: 'pro', environments: ['all'] }),
      /explicitly/
    );
    await assert.rejects(() => codes.createRegistrationCode({ planId: 'pro', environments: [] }), /at least one/);
  });
});

test('a code cannot be minted for a plan that does not exist', async () => {
  await withEnv('dev', async ({ codes }) => {
    await assert.rejects(() => codes.createRegistrationCode({ planId: 'pilot', environments: ['dev'] }), /Choose a plan/);
    await assert.rejects(() => codes.createRegistrationCode({ planId: '', environments: ['dev'] }), /Choose a plan/);
  });
});

test('a free plan cannot have a code, because there is nothing to bypass', async () => {
  await withEnv('dev', async ({ codes }) => {
    await assert.rejects(
      () => codes.createRegistrationCode({ planId: 'trial', environments: ['dev'] }),
      /free, so it needs no code/
    );
  });
});

test('the admin list shows enough to tell codes apart but not to redeem one', async () => {
  await withEnv('dev', async ({ codes }) => {
    const { code, record } = await codes.createRegistrationCode({
      planId: 'pro',
      environments: ['dev', 'qa'],
      note: 'Android testers'
    });

    const [listed] = await codes.listRegistrationCodes();
    assert.equal(listed.id, record.id);
    assert.equal(listed.planLabel, 'Pro');
    assert.deepEqual(listed.environments, ['dev', 'qa']);
    assert.equal(listed.note, 'Android testers');
    // The hint identifies it without being enough to redeem.
    assert.equal(listed.hint, code.slice(0, 4));
    assert.equal(JSON.stringify(listed).includes(code), false);
  });
});

test('the admin page renders, and shows a new code exactly once', async () => {
  // A page that only ever gets a 401 in testing is a page nobody has rendered.
  // This compiles the real template with the real locals, so a template error
  // fails here rather than in front of an administrator.
  const express = require('express');
  const hbs = require('hbs');
  hbs.registerHelper('eq', (left, right) => left === right);

  const app = express();
  app.set('views', path.resolve(__dirname, '..', 'views'));
  app.set('view engine', 'hbs');

  await withEnv('dev', async ({ codes }) => {
    const { code, record } = await codes.createRegistrationCode({
      planId: 'pro',
      environments: ['dev'],
      note: 'Android testers'
    });

    const render = (locals) =>
      new Promise((resolve, reject) => {
        app.render('pages/registration-codes', { layout: false, ...locals }, (error, html) =>
          error ? reject(error) : resolve(html)
        );
      });

    const issuedHtml = await render({
      codes: await codes.listRegistrationCodes(),
      planChoices: [{ id: 'pro', label: 'Pro', price: '$149/month' }],
      environmentChoices: [{ name: 'dev', isCurrent: true, isProduction: false }],
      environment: 'dev',
      issued: { code, record }
    });
    assert.match(issuedHtml, /Copy this code now/);
    assert.ok(issuedHtml.includes(code), 'the one time it is shown');
    assert.match(issuedHtml, /Android testers/);

    // Every later view of the page shows only the hint.
    const listHtml = await render({
      codes: await codes.listRegistrationCodes(),
      planChoices: [],
      environmentChoices: [],
      environment: 'dev',
      issued: null
    });
    assert.equal(listHtml.includes(code), false, 'the code is gone for good');
    assert.match(listHtml, new RegExp(record.hint));
    assert.match(listHtml, /Usable/);
  });
});

test('issuing and redeeming are both on the evidence chain', async () => {
  await withEnv('dev', async ({ codes }) => {
    const { verifyAuditChain } = require('../src/services/audit-service');
    const { code } = await codes.createRegistrationCode({
      planId: 'pro',
      environments: ['dev'],
      actorEmail: 'admin@example.com'
    });
    await codes.redeemRegistrationCode(code, { email: 'tester@example.com' });
    await codes.redeemRegistrationCode('WRON-GCOD-EXXX', {}).catch(() => {});

    const events = JSON.parse(await fs.readFile(process.env.AUDIT_STORE_PATH, 'utf8'));
    const types = events.map((entry) => entry.type);
    assert.ok(types.includes('subscription.code.issued'));
    assert.ok(types.includes('subscription.code.redeemed'));
    assert.ok(types.includes('subscription.code.rejected'), 'a failed attempt is evidence too');

    const issued = events.find((entry) => entry.type === 'subscription.code.issued');
    assert.equal(issued.data.createdBy, 'admin@example.com');
    // The audit trail must not carry the code itself either.
    assert.equal(JSON.stringify(events).includes(code.replace(/-/g, '')), false);

    assert.equal((await verifyAuditChain()).ok, true);
  });
});
