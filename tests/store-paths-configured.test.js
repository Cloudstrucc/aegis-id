const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Guards the trap this repo keeps falling into.
//
// Hosted state lives on the /home mount; wwwroot is replaced on every deploy.
// A store whose *_STORE_PATH is not set as an app setting silently falls back
// to data/<file> inside wwwroot and is wiped on the next deployment. The deploy
// script only forwards a variable when it is non-empty, so listing it there is
// not enough — each environment file has to define the value too.
//
// This has already cost real wallet data once. Failing here is much cheaper.

const ROOT = path.resolve(__dirname, '..');
const ENV_FILES = ['.env', '.env.dev', '.env.qa'];

function declaredStorePaths() {
  const source = fs.readFileSync(path.join(ROOT, 'src/config/index.js'), 'utf8');
  const matches = source.match(/process\.env\.(\w+_STORE_PATH)/g) || [];
  return [...new Set(matches.map((entry) => entry.replace('process.env.', '')))];
}

test('every store path the code reads is forwarded by the deploy script', () => {
  const script = fs.readFileSync(path.join(ROOT, 'scripts/deploy-azure-webapp.sh'), 'utf8');
  const missing = declaredStorePaths().filter((name) => !script.includes(name));

  assert.deepEqual(
    missing,
    [],
    `not forwarded by scripts/deploy-azure-webapp.sh, so these stores land in wwwroot: ${missing.join(', ')}`
  );
});

// The same trap, one level wider.
//
// A store path that is not forwarded loses data. Any *other* setting that is
// not forwarded is just as invisible: the code reads it, the local run works,
// and the hosted environment silently behaves as though it were never set.
// That happened to the Stripe keys — they were added to .env.example and to
// the code, and nowhere else, so payment would have been quietly off on every
// deployed environment.
//
// Settings that are genuinely local-only, or that Azure provides itself, are
// listed here with the reason.
const NOT_DEPLOYED = new Map([
  ['NODE_ENV', 'set by App Service itself'],
  ['PORT', 'set by App Service itself'],
  ['WEBSITE_HOSTNAME', 'provided by App Service'],
  ['LOCAL_TEST_MODE', 'localhost-only affordance; deliberately never deployed'],
  ['MAIL_DROP_PATH', 'filesystem transport is local-only'],
  ['APP_ENV', 'set per environment by the deploy script itself'],
  ['DEPLOY_ENV', 'set per environment by the deploy script itself'],
  ['IOS_ENV_FILE', 'release tooling, not the web app'],

  // Aries lab only. AGENTS.md is explicit that the lab is never on the product
  // path, so these are correctly absent from a product deployment.
  ['LEDGER_NETWORK', 'aries-lab only'],
  ['LEDGER_GENESIS_URL', 'aries-lab only'],
  ['LEDGER_TAA_ACCEPT', 'aries-lab only'],
  ['LEDGER_TAA_MECHANISM', 'aries-lab only'],
  ['LEDGER_TAA_TEXT_SHA256', 'aries-lab only'],
  ['LEDGER_ENDORSER_DID', 'aries-lab only'],
  ['TAILS_SERVER_BASE_URL', 'aries-lab only'],
  ['AEGIS_INDY_DID_NAMESPACE', 'aries-lab only'],
  ['ISSUER_WALLET_DB_URL', 'aries-lab only'],
  ['AEGIS_ISSUER_DID_METHOD', "aries-lab only; product path defaults to 'web'"],

  // Pre-existing gaps, allowlisted so this guard can start protecting new
  // settings today rather than waiting on unrelated work. Each falls back to a
  // usable default, so nothing is broken — but none of them can be configured
  // per environment either, which is not obviously intended.
  //   IOS_APP_BUNDLE_IDS           - defaults cover the three shipped bundles
  //   DIGITAL_SIGNATURE_APP_URL    - derived from BUSINESS_EXPENSES_APP_URL
  //   AUDIT_SIGNING_LOCAL_KEY_PATH - only read in local-key signing mode, and
  //                                  its default sits in wwwroot
  //   AUDIT_ANCHOR_DIR             - same, defaults to data/audit-heads
  ['IOS_APP_BUNDLE_IDS', 'pre-existing gap; safe default'],
  ['DIGITAL_SIGNATURE_APP_URL', 'pre-existing gap; derived default'],
  ['AUDIT_SIGNING_LOCAL_KEY_PATH', 'pre-existing gap; local-key signing only'],
  ['AUDIT_ANCHOR_DIR', 'pre-existing gap; local-key signing only']
]);

test('every setting the code reads is forwarded by the deploy script', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/config/index.js'), 'utf8');
  const script = fs.readFileSync(path.join(ROOT, 'scripts/deploy-azure-webapp.sh'), 'utf8');

  const declared = [...new Set((source.match(/process\.env\.(\w+)/g) || []).map((entry) => entry.replace('process.env.', '')))];
  const missing = declared.filter((name) => !NOT_DEPLOYED.has(name) && !script.includes(name));

  assert.deepEqual(
    missing,
    [],
    `read by src/config but never sent to Azure, so they are unset on every hosted environment: ${missing.join(', ')}`
  );
});

test('every store path has a value in each hosted environment file', () => {
  const declared = declaredStorePaths();
  const problems = [];

  for (const envFile of ENV_FILES) {
    const body = fs.readFileSync(path.join(ROOT, envFile), 'utf8');
    for (const name of declared) {
      const line = body.split('\n').find((entry) => entry.trim().startsWith(`${name}=`));
      if (!line) {
        // The deploy script skips unset variables, so the app setting is never
        // applied and the store quietly falls back into wwwroot.
        problems.push(`${envFile} is missing ${name}`);
        continue;
      }
      const value = line.slice(line.indexOf('=') + 1).trim();
      if (!value) {
        problems.push(`${envFile} sets ${name} to an empty value`);
      } else if (!value.startsWith('/home/')) {
        problems.push(`${envFile} points ${name} at ${value}, which is not on the persistent mount`);
      }
    }
  }

  assert.deepEqual(problems, [], problems.join('\n'));
});
