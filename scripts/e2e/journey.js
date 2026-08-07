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
  // The wallet's Local build is compiled against the standard ports, so the
  // journey claims those by default and the simulator can reach it. --isolated
  // moves off them when you would rather leave your own servers running.
  isolated: process.argv.includes('--isolated'),
  installWallet: process.argv.includes('--install-wallet')
};

const STANDARD_PORTS = { aegis: 3000, expenses: 4300 };
const ISOLATED_PORTS = { aegis: 3210, expenses: 4310 };

const started = new Date();
const stamp = started.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const artifactsDir = path.join(ROOT, 'artifacts', 'e2e', stamp);
const dataDir = path.join(artifactsDir, 'data');

// Filled in by resolvePorts() before anything starts.
let ports = { aegis: 0, expenses: 0 };
let AEGIS = '';
let EXPENSES = '';
let portNote = '';

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

/** Who, if anyone, is holding a port — used to explain a clash rather than guess. */
async function portHolder(port) {
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc']);
    const pid = /^p(\d+)/m.exec(stdout)?.[1];
    const command = /^c(.+)/m.exec(stdout)?.[1];
    return pid ? { pid, command: command || 'unknown' } : null;
  } catch {
    return null; // lsof exits non-zero when nothing is listening
  }
}

/**
 * Claim the standard ports when they are free so the wallet's Local build can
 * reach this run, and step aside onto the isolated ones when they are not.
 * Nothing already running is ever stopped — that is the developer's call.
 */
async function resolvePorts() {
  const wanted = options.isolated ? ISOLATED_PORTS : STANDARD_PORTS;
  const notes = [];

  // Each app moves independently, so one busy port does not cost the other its
  // standard one — a Business Expenses instance on 4300 still leaves the wallet
  // able to reach Aegis on 3000.
  for (const app of ['aegis', 'expenses']) {
    const holder = await portHolder(wanted[app]);
    if (!holder) {
      ports[app] = wanted[app];
      continue;
    }

    const fallback = ISOLATED_PORTS[app];
    if (fallback === wanted[app] || (await portHolder(fallback))) {
      throw new Error(
        `ports ${wanted[app]} and ${fallback} are both in use (pid ${holder.pid}, ${holder.command}) — stop one and retry`
      );
    }

    ports[app] = fallback;
    notes.push(`port ${wanted[app]} is in use (pid ${holder.pid}, ${holder.command}) — using ${fallback} for ${app}`);
  }

  portNote = notes.join('; ');
  AEGIS = `http://127.0.0.1:${ports.aegis}`;
  EXPENSES = `http://127.0.0.1:${ports.expenses}`;
}

/** The wallet's Local build is compiled against a fixed URL, so only that port works. */
function walletCanReachAegis() {
  return ports.aegis === STANDARD_PORTS.aegis;
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

// The Local scheme builds the Debug-Local configuration and shares the Dev
// bundle id, so both appear the same to simctl. Either one satisfies the leg.
const WALLET_BUNDLE_ID = 'ca.vanguardcs.aegisid.wallet.dev';
const WALLET_CONFIGURATION = 'Debug-Local';

/**
 * Each configuration registers its own URL scheme (Local uses aegisid-local,
 * Dev aegisid-dev, prod aegisid), so ask the project rather than assume.
 */
async function walletUrlScheme() {
  try {
    const { stdout } = await execFileAsync('xcodebuild', [
      '-project', path.join(ROOT, 'ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj'),
      '-scheme', 'VanguardAegisWallet Local',
      '-showBuildSettings'
    ], { maxBuffer: 8 * 1024 * 1024 });
    return /AEGIS_URL_SCHEME = (\S+)/.exec(stdout)?.[1] || 'aegisid';
  } catch {
    return 'aegisid';
  }
}

async function walletInstalled() {
  try {
    const { stdout } = await execFileAsync('xcrun', ['simctl', 'listapps', 'booted']);
    return stdout.includes(WALLET_BUNDLE_ID);
  } catch {
    return false;
  }
}

/** Build the Local scheme and install it on the booted device. Opt-in: it is slow. */
async function installWallet() {
  const derived = path.join(artifactsDir, 'ios-build');
  await execFileAsync(
    'xcodebuild',
    [
      '-project', path.join(ROOT, 'ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj'),
      '-scheme', 'VanguardAegisWallet Local',
      '-configuration', WALLET_CONFIGURATION,
      '-sdk', 'iphonesimulator',
      '-derivedDataPath', derived,
      '-destination', 'generic/platform=iOS Simulator',
      'build'
    ],
    { maxBuffer: 32 * 1024 * 1024 }
  );

  const products = path.join(derived, 'Build', 'Products', `${WALLET_CONFIGURATION}-iphonesimulator`);
  const entries = await fs.readdir(products);
  const app = entries.find((entry) => entry.endsWith('.app'));
  if (!app) {
    throw new Error(`no .app produced in ${products}`);
  }
  await execFileAsync('xcrun', ['simctl', 'install', 'booted', path.join(products, app)]);
  return app;
}

/**
 * Bring the wallet to the front before deep-linking. Opening a custom scheme
 * from the home screen makes iOS put up an "Open in …?" confirmation that
 * nothing here can dismiss, and the link never reaches the app.
 */
async function launchWallet() {
  await execFileAsync('xcrun', ['simctl', 'launch', 'booted', WALLET_BUNDLE_ID]);
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

const ANDROID_PACKAGE = 'ca.vanguardcs.aegisid.wallet.local';
const ANDROID_SCHEME = 'aegisid-local';

async function adb(args) {
  const { stdout } = await execFileAsync(
    path.join(process.env.HOME || '', 'Library/Android/sdk/platform-tools/adb'),
    args,
    { maxBuffer: 8 * 1024 * 1024 }
  );
  return stdout;
}

async function androidDeviceBooted() {
  try {
    const stdout = await adb(['devices']);
    return /\bdevice\s*$/m.test(stdout);
  } catch {
    return false;
  }
}

async function androidAppInstalled() {
  try {
    const stdout = await adb(['shell', 'pm', 'list', 'packages', ANDROID_PACKAGE]);
    return stdout.includes(ANDROID_PACKAGE);
  } catch {
    return false;
  }
}

/** Build and install the local flavour. Opt-in: Gradle is slow. */
async function installAndroidWallet() {
  await execFileAsync(
    path.join(ROOT, 'android/VanguardAegisWallet/gradlew'),
    [':app:assembleLocalDebug'],
    { cwd: path.join(ROOT, 'android/VanguardAegisWallet'), maxBuffer: 32 * 1024 * 1024 }
  );
  const apk = path.join(
    ROOT,
    'android/VanguardAegisWallet/app/build/outputs/apk/local/debug/app-local-debug.apk'
  );
  await adb(['install', '-r', apk]);
  return path.basename(apk);
}

async function androidScreenshot(record, label) {
  try {
    const file = path.join(artifactsDir, 'screenshots', `android-${slugForFile(label)}.png`);
    const raw = await execFileAsync(
      path.join(process.env.HOME || '', 'Library/Android/sdk/platform-tools/adb'),
      ['exec-out', 'screencap', '-p'],
      { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }
    );
    await fs.writeFile(file, raw.stdout);
    record?.screenshots.push({ kind: 'simulator', label, file: path.relative(artifactsDir, file) });
  } catch {
    /* a screenshot is never worth failing the run over */
  }
}

function slugForFile(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

async function openDeepLink(url) {
  try {
    await execFileAsync('xcrun', ['simctl', 'openurl', 'booted', url]);
  } catch (error) {
    // Code 115 is "nothing on this device claims that URL scheme", which in
    // practice always means the wallet is not installed on the booted device.
    if (/code=115/.test(error.message)) {
      throw new Error(`no app on the booted device claims ${new URL(url).protocol}// — re-run with --install-wallet`);
    }
    throw error;
  }
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
  if (portNote) {
    runner.info(portNote);
  }

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
        PORT: String(ports.aegis),
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
          PORT: String(ports.expenses),
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
      expect(
        walletCanReachAegis(),
        `the wallet's Local build points at port ${STANDARD_PORTS.aegis}, which this run could not claim — ${portNote}`
      );

      if (!(await walletInstalled())) {
        expect(
          options.installWallet,
          'the wallet app is not installed on the booted simulator — re-run with --install-wallet to build and install it'
        );
        runner.info('building the Local wallet scheme — this takes a few minutes');
        const app = await installWallet();
        runner.info(`installed ${app} on the booted device`);
      }

      await launchWallet();
      await runner.simulatorShot(record, 'wallet-launched');
      const scheme = await walletUrlScheme();
      await openDeepLink(`${scheme}://org-invite?invitation_id=${state.invitationId}&organization_id=${state.organizationId}&organization_name=${encodeURIComponent(orgName)}&vanguard_web_app_url=${encodeURIComponent(AEGIS)}`);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await runner.simulatorShot(record, 'after-org-invite');
      // The wallet forces setup on a fresh install, so the invitation waits
      // behind that screen. The screenshots show where it got to; finishing the
      // flow is a human's job, since simctl cannot tap.
      return `${scheme}:// org-invite delivered to the running wallet`;
    },
    { optional: true }
  );

  await runner.step(
    'Drive the wallet on an Android emulator',
    async (record) => {
      expect(await androidDeviceBooted(), 'no booted emulator — start one with: emulator -avd Aegis_API35_arm64');
      expect(
        walletCanReachAegis(),
        `the Android local flavour points at port ${STANDARD_PORTS.aegis} via 10.0.2.2, which this run could not claim — ${portNote}`
      );

      if (!(await androidAppInstalled())) {
        expect(
          options.installWallet,
          'the wallet is not installed on the emulator — re-run with --install-wallet to build and install it'
        );
        runner.info('building the Android local flavour — this takes a few minutes');
        runner.info(`installed ${await installAndroidWallet()}`);
      }

      // Bring the app to the front first: a freshly installed package is in the
      // stopped state, and implicit intents skip stopped packages.
      await adb(['shell', 'am', 'start', '-n', `${ANDROID_PACKAGE}/ca.vanguardcs.aegisid.wallet.MainActivity`]);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await androidScreenshot(record, 'wallet-launched');

      // Quoted for the *device* shell: an unquoted & is a background operator
      // there and silently truncates the URL at the first parameter.
      const link =
        `${ANDROID_SCHEME}://org-invite?invitation_id=${state.invitationId}` +
        `&organization_id=${state.organizationId}` +
        `&organization_name=${encodeURIComponent(orgName)}` +
        `&vanguard_web_app_url=${encodeURIComponent('http://10.0.2.2:' + ports.aegis)}`;
      await adb(['shell', `am start -a android.intent.action.VIEW -d '${link}'`]);

      await new Promise((resolve) => setTimeout(resolve, 3000));
      await androidScreenshot(record, 'after-org-invite');
      return `${ANDROID_SCHEME}:// org-invite delivered to the running wallet`;
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

resolvePorts()
  .then(main)
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
