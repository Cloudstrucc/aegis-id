const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The settings that describe the published apps must reach production and
// nowhere else.
//
// Two properties, and the second is the one that is easy to get wrong: a
// non-prod deploy has to send an explicit empty value rather than simply
// leaving the setting out. App Service keeps whatever the previous deployment
// set, so omitting a key does not clear it — a value that reached dev once
// would stay there for good.

const SCRIPT = path.join(__dirname, '..', 'scripts', 'deploy-azure-webapp.sh');
const PROD_ONLY = ['SUPPORT_EMAIL', 'APP_STORE_URL', 'PLAY_STORE_URL', 'PRIVACY_POLICY_URL'];

function script() {
  return fs.readFileSync(SCRIPT, 'utf8');
}

test('every production-only setting is named in PROD_ONLY_KEYS', () => {
  const declared = script().match(/PROD_ONLY_KEYS=\(([^)]*)\)/);
  assert.ok(declared, 'PROD_ONLY_KEYS is not declared in the deploy script');

  const keys = declared[1].trim().split(/\s+/);
  assert.deepEqual(keys.sort(), [...PROD_ONLY].sort());
});

test('a non-prod deploy blanks them rather than skipping them', () => {
  const source = script();

  // The guard itself.
  assert.match(source, /if \[\[ "\$DEPLOY_ENV" != "prod" \]\]; then/);

  // Blanked, not merely unset. `unset` alone would fall through to
  // append_if_set, which omits an empty value — and an omitted setting is a
  // setting App Service leaves exactly as it found it.
  const guard = source.slice(source.indexOf('PROD_ONLY_KEYS=('));
  assert.match(guard, /unset "\$key"/);
  assert.match(guard, /app_settings\+=\("\$key="\)/);
});

test('they are still forwarded on a production deploy', () => {
  const source = script();
  for (const key of PROD_ONLY) {
    assert.match(
      source,
      new RegExp(`^\\s*(?:.*\\s)?${key}(?:\\s|\\\\).*$`, 'm'),
      `${key} is not in the list the deploy forwards`
    );
  }
});

test('they are tenant-scoped, so a tenant profile can override them', () => {
  const declared = script().match(/TENANT_KEYS=\(([\s\S]*?)\n\)/);
  assert.ok(declared, 'TENANT_KEYS is not declared in the deploy script');

  for (const key of PROD_ONLY) {
    assert.match(declared[1], new RegExp(`\\b${key}\\b`), `${key} is not tenant-scoped`);
  }
});

test('the template documents them as production only', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');

  assert.match(template, /PRODUCTION ONLY/);
  for (const key of PROD_ONLY) {
    // Empty in the template: a real address or listing URL committed here would
    // be one somebody copies into a non-production environment by hand.
    assert.match(template, new RegExp(`^${key}=$`, 'm'), `${key} should be present and empty`);
  }
});
