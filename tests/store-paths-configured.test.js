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
