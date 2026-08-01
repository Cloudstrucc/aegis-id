'use strict';

// The end-to-end journey: create an account, register an organization, set up a
// wallet, issue and accept a credential, then exercise the OIDC gate, an expense
// approval and a document signature — and confirm the evidence ledger survives.
//
// Runs against a throwaway Aegis instance with its own data directory, so every
// run starts from nothing. Localhost only.

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Runner } = require('./lib/runner');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..', '..');

const options = {
  headless: process.argv.includes('--headless'),
  keep: process.argv.includes('--keep'),
  aegisPort: Number(process.env.E2E_AEGIS_PORT || 3210),
  expensesPort: Number(process.env.E2E_EXPENSES_PORT || 4310)
};

const started = new Date();
const stamp = started.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const artifactsDir = path.join(ROOT, 'artifacts', 'e2e', stamp);
const dataDir = path.join(artifactsDir, 'data');

const AEGIS = `http://127.0.0.1:${options.aegisPort}`;
const EXPENSES = `http://127.0.0.1:${options.expensesPort}`;

const processes = [];
const runner = new Runner({ artifactsDir });

// --- small helpers ----------------------------------------------------------

async function api(url, { method = 'GET', body, headers = {}, redirect = 'manual' } = {}) {
  const response = await fetch(url, {
    method,
    redirect,
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json — fine, callers that need it will say so */
  }
  return { status: response.status, headers: response.headers, text, json };
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** Poll until `check` returns truthy, so no step depends on a fixed sleep. */
async function waitFor(description, check, { timeoutMs = 20000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function startServer(name, cwd, env, readyUrl) {
  const child = spawn('node', ['src/server.js'], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  processes.push({ name, child });

  const logFile = path.join(artifactsDir, `${name}.log`);
  child.stdout.on('data', (chunk) => fs.appendFile(logFile, chunk).catch(() => {}));
  child.stderr.on('data', (chunk) => fs.appendFile(logFile, chunk).catch(() => {}));

  return waitFor(`${name} to answer`, async () => {
    try {
      const probe = await fetch(readyUrl, { redirect: 'manual' });
      return probe.status > 0;
    } catch {
      return false;
    }
  });
}

function stopServers() {
  for (const { child } of processes) {
    child.kill('SIGTERM');
  }
}

async function openInBrowser(url) {
  if (options.headless) {
    return;
  }
  try {
    await execFileAsync('open', [url]);
  } catch {
    /* a browser is a convenience, never a requirement */
  }
}

async function simulatorBooted() {
  try {
    const { stdout } = await execFileAsync('xcrun', ['simctl', 'list', 'devices', 'booted']);
    return /\(Booted\)/.test(stdout);
  } catch {
    return false;
  }
}

async function openDeepLink(url) {
  await execFileAsync('xcrun', ['simctl', 'openurl', 'booted', url]);
}

// --- the journey ------------------------------------------------------------

async function main() {
  await fs.mkdir(dataDir, { recursive: true });
  await runner.init();

  const unique = Date.now().toString(36);
  const holderEmail = `holder-${unique}@aegis.test`;
  const orgName = `E2E Org ${unique}`;
  const state = { holderEmail, orgName };

  runner.info(`artifacts: ${artifactsDir}`);
  runner.info(`aegis: ${AEGIS}   business expenses: ${EXPENSES}`);

  // Every store points into this run's own directory, so nothing touches the
  // developer's working data and each run genuinely starts from scratch.
  const storeEnv = Object.fromEntries(
    [
      ['USER_STORE_PATH', 'users.json'],
      ['SUBSCRIPTION_STORE_PATH', 'subscriptions.json'],
      ['SUBSCRIBER_WORKSPACE_STORE_PATH', 'workspaces.json'],
      ['TRANSACTION_STORE_PATH', 'transactions.json'],
      ['ISSUER_ORG_STORE_PATH', 'issuer-organizations.json'],
      ['ORG_ADMIN_STORE_PATH', 'org-admin.json'],
      ['ORG_ADMIN_EVENT_STORE_PATH', 'org-admin-events.json'],
      ['CONNECTED_APP_STORE_PATH', 'connected-apps.json'],
      ['CONNECTED_APP_LOG_STORE_PATH', 'connected-app-logs.json'],
      ['OIDC_WALLET_SESSION_STORE_PATH', 'oidc-wallet-sessions.json'],
      ['OIDC_CODE_STORE_PATH', 'oidc-codes.json'],
      ['WALLET_CHALLENGE_STORE_PATH', 'wallet-challenges.json'],
      ['WALLET_PASSKEY_STORE_PATH', 'wallet-passkeys.json'],
      ['AUDIT_STORE_PATH', 'audit-events.json'],
      ['WALLET_STORE_PATH', 'wallets.json'],
      ['WALLET_CONTACT_CHALLENGE_STORE_PATH', 'wallet-contact-challenges.json'],
      ['WALLET_RECOVERY_CODE_STORE_PATH', 'wallet-recovery-codes.json'],
      ['WALLET_RECOVERY_REQUEST_STORE_PATH', 'wallet-recovery-requests.json'],
      ['NOTIFICATION_SETTINGS_STORE_PATH', 'notification-settings.json']
    ].map(([key, file]) => [key, path.join(dataDir, file)])
  );

  await runner.step('Start Aegis ID on an isolated data directory', async () => {
    await startServer(
      'aegis',
      ROOT,
      {
        ...storeEnv,
        APP_ENV: 'local',
        NODE_ENV: 'development',
        LOCAL_TEST_MODE: 'true',
        PORT: String(options.aegisPort),
        PUBLIC_BASE_URL: AEGIS,
        APP_PUBLIC_BASE_URL: AEGIS,
        BUSINESS_EXPENSES_APP_URL: EXPENSES,
        SESSION_SECRET: `e2e-${unique}`
      },
      `${AEGIS}/api/health`
    );
    return AEGIS;
  });

  await runner.step('Register a wallet and receive a Wallet ID', async (record) => {
    const result = await api(`${AEGIS}/api/wallet/register`, {
      method: 'POST',
      body: { email: holderEmail, phone: '613-555-0100', devicePublicKey: `e2e-device-${unique}` }
    });
    expect(result.status === 201, `expected 201, got ${result.status}: ${result.text.slice(0, 160)}`);
    expect(result.json?.walletId, 'no Wallet ID returned');
    state.walletId = result.json.walletId;
    record.detail = state.walletId;
    return state.walletId;
  });

  await runner.step('Recovery codes are issued and never stored in plaintext', async () => {
    const result = await api(`${AEGIS}/api/wallet/${state.walletId}/recovery-codes/regenerate`, { method: 'POST', body: {} });
    expect(result.status === 201, `expected 201, got ${result.status}`);
    const codes = result.json?.codes || [];
    expect(codes.length === 10, `expected 10 codes, got ${codes.length}`);
    state.recoveryCode = codes[0];

    const stored = await fs.readFile(path.join(dataDir, 'wallet-recovery-codes.json'), 'utf8');
    expect(!stored.includes(codes[0]), 'a plaintext recovery code was persisted');
    return `${codes.length} codes, none stored in plaintext`;
  });

  await runner.step('Create an organization with a credential for the holder', async () => {
    const { createOrganization } = require('./lib/seed');
    const seeded = await createOrganization({ dataDir, orgName, holderEmail, walletId: state.walletId });
    Object.assign(state, seeded);
    return `${orgName} (${state.organizationId})`;
  });

  await runner.step('Connect the wallet to the organization', async () => {
    const result = await api(
      `${AEGIS}/api/wallet/organization-invitations/${state.invitationId}/accept`,
      { method: 'POST', body: { walletId: state.walletId, source: 'e2e' } }
    );
    expect(result.status === 200, `expected 200, got ${result.status}: ${result.text.slice(0, 160)}`);
    expect(result.json?.status === 'connected', `expected connected, got ${result.json?.status}`);
    return result.json.organizationName;
  });

  await runner.step('Accept the credential, which grants consent', async () => {
    const before = await api(
      `${AEGIS}/api/wallet/credential-invitations/${state.credentialId}/status?organizationId=${state.organizationId}`
    );
    expect(before.json?.status === 'invited', `expected invited, got ${before.json?.status}`);

    const accepted = await api(`${AEGIS}/api/wallet/credential-invitations/${state.credentialId}/accept`, {
      method: 'POST',
      body: { organizationId: state.organizationId, walletId: state.walletId, source: 'e2e' }
    });
    expect(accepted.status === 200, `expected 200, got ${accepted.status}: ${accepted.text.slice(0, 160)}`);
    // The route wraps the credential, so the detail lives one level down.
    const credential = accepted.json?.credential || {};
    expect(credential.status === 'active', `expected active, got ${credential.status}`);
    expect(credential.consentStatus === 'granted', `expected consent granted, got ${credential.consentStatus}`);
    return `bound by ${credential.bindingMode}, consent ${credential.consentStatus}`;
  });

  await runner.step('A different wallet cannot accept that credential', async () => {
    const other = await api(`${AEGIS}/api/wallet/register`, {
      method: 'POST',
      body: { email: `other-${unique}@aegis.test`, devicePublicKey: `e2e-other-${unique}` }
    });
    const attempt = await api(`${AEGIS}/api/wallet/credential-invitations/${state.credentialId}/accept`, {
      method: 'POST',
      body: { organizationId: state.organizationId, walletId: other.json.walletId }
    });
    expect(attempt.status >= 400, `expected a rejection, got ${attempt.status}`);
    return attempt.json?.error?.message || 'rejected';
  });

  await runner.step('OIDC wallet challenge reaches the wallet', async (record) => {
    const { raiseOidcChallenge } = require('./lib/seed');
    const session = await raiseOidcChallenge({
      dataDir,
      baseUrl: AEGIS,
      email: holderEmail,
      organizationId: state.organizationId
    });
    state.oidcSessionId = session.id;

    await openInBrowser(`${AEGIS}/demo/oidc-wallet/sessions/${session.id}/challenge`);

    // The wallet polls by organization, so this is exactly what the app asks for.
    const pending = await waitFor('the challenge to be deliverable to the wallet', async () => {
      const result = await api(`${AEGIS}/api/oidc-wallet/challenges?organizationId=${state.organizationId}`);
      return (result.json?.challenges || []).length > 0 ? result.json.challenges : null;
    });
    record.detail = `${pending.length} challenge(s) polled by organization`;

    const accept = await api(`${AEGIS}${pending[0].acceptPath}`, { method: 'POST', body: { subject: holderEmail } });
    expect(accept.status < 400, `accepting the challenge failed: ${accept.status} ${accept.text.slice(0, 160)}`);
    return record.detail;
  });

  const expensesUp = await runner.step(
    'Start Business Expenses',
    async () => {
      await startServer(
        'business-expenses',
        path.join(ROOT, 'examples', 'business-expenses'),
        {
          PORT: String(options.expensesPort),
          APP_PUBLIC_BASE_URL: EXPENSES,
          AEGIS_ID_BASE_URL: AEGIS,
          SESSION_SECRET: `e2e-expenses-${unique}`
        },
        `${EXPENSES}/`
      );
      await openInBrowser(EXPENSES);
      return EXPENSES;
    },
    { optional: true }
  );

  if (expensesUp) {
    await runner.step('Business Expenses no longer needs a configured organization', async () => {
      const landing = await api(`${EXPENSES}/`, { headers: { accept: 'text/html' } });
      expect(landing.status === 200, `expected 200, got ${landing.status}`);
      expect(!/AEGIS_ORGANIZATION_ID/i.test(landing.text), 'landing page still asks for a configured organization');

      const gated = await api(`${EXPENSES}/expenses`, { headers: { accept: 'text/html' } });
      expect(gated.status === 303, `expenses should redirect to sign-in, got ${gated.status}`);
      return 'sign-in gated, no configured organization required';
    });

    await runner.step('Expense approval raises a wallet challenge', async (record) => {
      const { approveExpenseViaApi } = require('./lib/seed');
      const challenge = await approveExpenseViaApi({
        baseUrl: AEGIS,
        organizationId: state.organizationId,
        subject: holderEmail
      });
      record.detail = `challenge ${challenge.id} (${challenge.delivery?.status})`;

      const accept = await api(`${AEGIS}/api/wallet-challenges/${challenge.id}/accept`, {
        method: 'POST',
        body: { acceptedBy: holderEmail, source: 'e2e-wallet' }
      });
      expect(accept.status < 400, `approving failed: ${accept.status} ${accept.text.slice(0, 160)}`);
      expect(accept.json?.status === 'accepted', `expected accepted, got ${accept.json?.status}`);
      return record.detail;
    });

    await runner.step('Document signature raises and records a wallet signature', async (record) => {
      const { signDocumentViaApi } = require('./lib/seed');
      const challenge = await signDocumentViaApi({
        baseUrl: AEGIS,
        organizationId: state.organizationId,
        subject: holderEmail
      });
      const accept = await api(`${AEGIS}/api/wallet-challenges/${challenge.id}/accept`, {
        method: 'POST',
        body: { acceptedBy: holderEmail, source: 'e2e-wallet' }
      });
      expect(accept.json?.status === 'accepted', `expected accepted, got ${accept.json?.status}`);
      record.detail = `signed ${challenge.id}`;
      return record.detail;
    });
  }

  await runner.step(
    'Drive the wallet in the iOS Simulator',
    async (record) => {
      expect(await simulatorBooted(), 'no booted simulator — open Simulator.app and boot a device');
      await runner.simulatorShot(record, 'before-deep-link');
      await openDeepLink(`aegisid://org-invite?invitation_id=${state.invitationId}&organization_id=${state.organizationId}&organization_name=${encodeURIComponent(orgName)}&vanguard_web_app_url=${encodeURIComponent(AEGIS)}`);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await runner.simulatorShot(record, 'after-org-invite');
      return 'deep link delivered to the booted device';
    },
    { optional: true }
  );

  await runner.step('The evidence ledger is intact', async (record) => {
    const { verifyAuditChain } = requireFresh('../../src/services/audit-service', storeEnv);
    const result = await verifyAuditChain();
    expect(result.ok, `chain broken at seq ${result.brokenAtSeq}: ${result.reason}`);
    record.detail = `${result.count} records verified`;
    return record.detail;
  });

  await runner.step('The journey left the expected evidence', async () => {
    const raw = await fs.readFile(path.join(dataDir, 'audit-events.json'), 'utf8');
    const types = new Set(JSON.parse(raw).map((event) => event.type));
    const expected = ['wallet.registered', 'wallet.organization.accepted', 'wallet.credential.accepted'];
    const missing = expected.filter((type) => !types.has(type));
    expect(missing.length === 0, `missing evidence: ${missing.join(', ')}`);
    return [...types].sort().join(', ');
  });
}

/** Load a platform module bound to this run's stores. */
function requireFresh(modulePath, env) {
  Object.assign(process.env, env);
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  delete require.cache[require.resolve('../../src/config')];
  return require(modulePath);
}

main()
  .catch((error) => {
    runner.write('fail', `journey aborted: ${error.message}`);
    runner.steps.push({ name: 'Journey aborted', status: 'fail', detail: error.message, ms: 0, screenshots: [] });
  })
  .finally(async () => {
    const summary = await runner.finish({
      'Aegis ID': AEGIS,
      'Business Expenses': EXPENSES,
      Artifacts: artifactsDir,
      Started: started.toISOString()
    });

    console.log('');
    console.log(`  ${summary.pass} passed · ${summary.fail} failed · ${summary.skip} skipped · ${(summary.ms / 1000).toFixed(1)}s`);
    console.log(`  Report: ${path.join(artifactsDir, 'report.html')}`);
    console.log('');

    if (options.keep) {
      console.log('  --keep: servers left running. Press Ctrl+C to stop.');
      return;
    }

    stopServers();
    setTimeout(() => process.exit(summary.fail > 0 ? 1 : 0), 300);
  });
