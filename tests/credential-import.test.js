const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Bulk invitations from a CSV, and the one-field issue form that came with
// them. The contract worth pinning down: validation reports every problem by
// row and column and mints nothing; a clean file mints every row in the
// background; the plan is checked before the first row rather than at the
// row that crosses the line.

const STORE_VARS = [
  'SUBSCRIBER_WORKSPACE_STORE_PATH',
  'ORG_ADMIN_STORE_PATH',
  'ORG_ADMIN_EVENT_STORE_PATH',
  'CREDENTIAL_IMPORT_STORE_PATH'
];

async function setup(t) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vanguard-credential-import-'));
  const previous = Object.fromEntries(STORE_VARS.map((name) => [name, process.env[name]]));
  const previousPolicy = process.env.ROOT_WALLET_POLICY_ENFORCED;
  process.env.SUBSCRIBER_WORKSPACE_STORE_PATH = path.join(tempDir, 'workspaces.json');
  process.env.ORG_ADMIN_STORE_PATH = path.join(tempDir, 'org-admin.json');
  process.env.ORG_ADMIN_EVENT_STORE_PATH = path.join(tempDir, 'org-admin-events.json');
  process.env.CREDENTIAL_IMPORT_STORE_PATH = path.join(tempDir, 'credential-imports.json');
  process.env.ROOT_WALLET_POLICY_ENFORCED = 'false';
  resetModules();

  t.after(() => {
    for (const name of STORE_VARS) {
      restoreEnv(name, previous[name]);
    }
    restoreEnv('ROOT_WALLET_POLICY_ENFORCED', previousPolicy);
    resetModules();
  });

  const workspace = {
    id: 'org-import',
    subscriptionId: 'sub-import',
    organization: 'Import Co',
    ownerEmail: 'admin@import.example',
    members: [{ email: 'admin@import.example', role: 'administrator', addedAt: new Date().toISOString() }],
    platforms: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(process.env.SUBSCRIBER_WORKSPACE_STORE_PATH, JSON.stringify([workspace], null, 2), 'utf8');
  // Comped so the plan's ceiling is the Basic one rather than Trial's.
  const subscription = { id: 'sub-import', email: 'admin@import.example', organization: 'Import Co', plan: 'basic', billingStatus: 'comped' };

  return {
    workspace,
    subscription,
    imports: require('../src/services/credential-import-service'),
    orgAdmin: require('../src/services/org-admin-service')
  };
}

test('the template carries the base columns plus one per claim, and parses back', async (t) => {
  const { workspace, imports } = await setup(t);
  const csv = await imports.buildTemplateCsv(workspace);
  const rows = imports.parseCsv(csv);

  assert.equal(rows.length, 2, 'heading plus one example row');
  assert.deepEqual(rows[0].slice(0, 8), imports.BASE_COLUMNS.map((column) => column.key));
  assert.ok(rows[0].includes('claim_department'));
  assert.equal(rows[0].length, rows[1].length, 'example row has a cell per column');
});

test('parseCsv handles quotes, embedded commas, CRLF and a BOM', async (t) => {
  const { imports } = await setup(t);
  const rows = imports.parseCsv('﻿email,display_name\r\na@x.io,"Smith, Jordan"\r\nb@x.io,"Say ""hi"""\n\n');
  assert.deepEqual(rows, [
    ['email', 'display_name'],
    ['a@x.io', 'Smith, Jordan'],
    ['b@x.io', 'Say "hi"']
  ]);
});

test('validation lists every problem by row and column and mints nothing', async (t) => {
  const { workspace, subscription, imports, orgAdmin } = await setup(t);
  await orgAdmin.issueCredential(workspace, subscription, { holderEmail: 'taken@import.example' });

  const csv = [
    'email,display_name,wallet_id,person_type,division,roles,invite_ttl_days',
    'ok@import.example,,,employee,,,30',
    'not-an-email,,,employee,,,30',
    'taken@import.example,,,employee,,,30',
    'dup@import.example,,,employee,,,30',
    'dup@import.example,,,employee,,,30',
    ',,,employee,,,30',
    'bad@import.example,,AEG-NOPE,visitor,Nowhere,Wizard,400'
  ].join('\n');

  const result = await imports.validateCsv(workspace, subscription, csv);
  const byRow = (row) => result.errors.filter((entry) => entry.row === row).map((entry) => `${entry.column}:${entry.message}`);

  assert.equal(result.rows.length, 0, 'a file with problems yields no rows to import');
  assert.deepEqual(byRow(2), []);
  assert.match(byRow(3)[0], /^A:.*not an email/);
  assert.match(byRow(4)[0], /^A:.*already holds a credential/);
  assert.deepEqual(byRow(5), []);
  assert.match(byRow(6)[0], /^A:.*repeated from row 5/);
  assert.match(byRow(7)[0], /^:Give an email, a wallet_id or a phone/);
  const row8 = byRow(8);
  assert.ok(row8.some((entry) => entry.startsWith('C:') && /Wallet ID/.test(entry)), row8.join(' | '));
  assert.ok(row8.some((entry) => entry.startsWith('D:') && /employee, contractor, administrator/.test(entry)));
  assert.ok(row8.some((entry) => entry.startsWith('E:') && /No division called "Nowhere"/.test(entry)));
  assert.ok(row8.some((entry) => entry.startsWith('F:') && /No role called "Wizard"/.test(entry)));
  assert.ok(row8.some((entry) => entry.startsWith('G:') && /1 to 365/.test(entry)));

  const state = await orgAdmin.getOrCreateState(workspace);
  assert.equal(state.credentials.length, 1, 'nothing issued by validation');
});

test('an unknown heading is refused at row 1 before any data row is read', async (t) => {
  const { workspace, subscription, imports } = await setup(t);
  const result = await imports.validateCsv(workspace, subscription, 'email,favourite_colour\na@b.io,blue');
  assert.deepEqual(result.errors.map((entry) => [entry.row, entry.column]), [[1, 'B']]);
  assert.match(result.errors[0].message, /Unknown column "favourite_colour"/);
});

test('a clean file is imported in the background with progress, and rows resolve names, divisions and roles', async (t) => {
  const { workspace, subscription, imports, orgAdmin } = await setup(t);
  const finance = await orgAdmin.createOrgUnit(workspace, subscription, { name: 'Finance', parentId: 'unit-root', roleIds: [], claimKeys: [] });

  const csv = [
    'email,display_name,person_type,division,roles,invite_ttl_days,claim_department',
    'jordan.smith@import.example,,employee,Finance,Employee;Contractor,45,Finance',
    'pat@import.example,Pat Lee,contractor,,,,',
    'admin.person@import.example,,administrator,,,,'
  ].join('\n');

  const job = await imports.startImport(workspace, subscription, csv);
  assert.equal(job.status, 'running');
  assert.equal(job.total, 3);
  assert.equal((await imports.getActiveJob(workspace.id))?.id, job.id);
  await assert.rejects(imports.startImport(workspace, subscription, csv), /already running/);

  const settled = await waitFor(() => imports.getJob(workspace.id, job.id), (entry) => entry.status !== 'running');
  assert.equal(settled.status, 'completed');
  assert.equal(settled.done, 3);
  assert.equal(settled.failed, 0);
  assert.equal(await imports.getActiveJob(workspace.id), null);
  assert.equal((await imports.getLatestJob(workspace.id)).id, job.id);

  const state = await orgAdmin.getOrCreateState(workspace);
  const byEmail = Object.fromEntries(state.credentials.map((credential) => [credential.holderEmail, credential]));

  const jordan = byEmail['jordan.smith@import.example'];
  assert.equal(jordan.displayName, 'Jordan Smith', 'display name derived from the address');
  assert.equal(jordan.claims.displayName, 'Jordan Smith');
  assert.equal(jordan.divisionId, finance.id, 'division resolved by name');
  assert.deepEqual(jordan.roleIds, ['role-employee', 'role-contractor'], 'roles resolved by name');
  assert.equal(jordan.inviteTtlDays, 45);
  assert.equal(jordan.claims.department, 'Finance');

  const pat = byEmail['pat@import.example'];
  assert.equal(pat.displayName, 'Pat Lee');
  assert.deepEqual(pat.roleIds, ['role-contractor'], 'role defaults from the person type');

  const admin = byEmail['admin.person@import.example'];
  assert.deepEqual(admin.roleIds, [], 'administrator eligibility is never assumed');
});

test('the plan ceiling is checked against the whole file before anything is issued', async (t) => {
  const { workspace, subscription, imports, orgAdmin } = await setup(t);
  const { effectiveEntitlement } = require('../src/services/plan-service');
  const limit = effectiveEntitlement(subscription).limits.maxCredentialsPerWorkspace;
  assert.ok(Number.isInteger(limit) && limit > 0, 'this test needs a plan with a ceiling');

  const lines = ['email'];
  for (let n = 0; n <= limit; n += 1) {
    lines.push(`person${n}@import.example`);
  }
  const result = await imports.validateCsv(workspace, subscription, lines.join('\n'));
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, new RegExp(`can issue ${limit} more`));

  await assert.rejects(imports.startImport(workspace, subscription, lines.join('\n')), (error) => {
    assert.equal(error.status, 422);
    assert.equal(error.details.length, 1);
    return true;
  });
  assert.equal((await orgAdmin.getOrCreateState(workspace)).credentials.length, 0);
});

test('the issue form needs only a contact; name and role are defaulted', async (t) => {
  const { workspace, subscription, orgAdmin } = await setup(t);
  const credential = await orgAdmin.issueCredential(workspace, subscription, { holderEmail: 'avery.chen@import.example' });
  assert.equal(credential.displayName, 'Avery Chen');
  assert.equal(credential.claims.displayName, 'Avery Chen');
  assert.equal(credential.claims.email, 'avery.chen@import.example');
  assert.deepEqual(credential.roleIds, ['role-employee']);
  assert.equal(credential.bindingMode, 'email');

  await assert.rejects(orgAdmin.issueCredential(workspace, subscription, {}), /Wallet ID, holder email, or holder phone/);
});

test('the test-data fill is off wherever NODE_ENV is production unless switched on', () => {
  const previousEnv = process.env.NODE_ENV;
  const previousFlag = process.env.TEST_FIXTURES_ENABLED;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.TEST_FIXTURES_ENABLED;
    delete require.cache[require.resolve('../src/config')];
    assert.equal(require('../src/config').app.testFixturesEnabled, false);

    process.env.TEST_FIXTURES_ENABLED = 'true';
    delete require.cache[require.resolve('../src/config')];
    assert.equal(require('../src/config').app.testFixturesEnabled, true);

    process.env.NODE_ENV = 'development';
    delete process.env.TEST_FIXTURES_ENABLED;
    delete require.cache[require.resolve('../src/config')];
    assert.equal(require('../src/config').app.testFixturesEnabled, true);
  } finally {
    restoreEnv('NODE_ENV', previousEnv);
    restoreEnv('TEST_FIXTURES_ENABLED', previousFlag);
    delete require.cache[require.resolve('../src/config')];
  }
});

async function waitFor(read, done, timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (value && done(value)) {
      return value;
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for the import to settle');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function resetModules() {
  for (const modulePath of [
    '../src/config',
    '../src/services/platform-service',
    '../src/services/org-admin-service',
    '../src/services/subscription-service',
    '../src/services/root-wallet-service',
    '../src/services/credential-import-service'
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
