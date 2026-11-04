const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// What goes into the deployment package, and where the package is written.
//
// Both properties bit silently rather than loudly. `artifacts/` is a gigabyte
// of signed app bundles and end-to-end output that was being copied into
// wwwroot on every deploy; nothing served it, so the only symptom was a build
// that took minutes longer than it needed to. And a fixed package path means
// two overlapping deploys — dev while qa is still uploading — write the same
// file, so the second truncates the first mid-upload.

const SCRIPTS = {
  'deploy-azure-webapp.sh': path.join(__dirname, '..', 'scripts', 'deploy-azure-webapp.sh'),
  'deploy-azure-business-expenses.sh': path.join(__dirname, '..', 'scripts', 'deploy-azure-business-expenses.sh')
};

function read(name) {
  return fs.readFileSync(SCRIPTS[name], 'utf8');
}

test('the platform package leaves out everything that is never served', () => {
  const source = read('deploy-azure-webapp.sh');
  const excluded = [...source.matchAll(/-x "([^"]+)"/g)].map((match) => match[1]);

  for (const pattern of ['node_modules/*', '.git/*', 'data/*', 'artifacts/*', 'ios/*', 'android/*']) {
    assert.ok(excluded.includes(pattern), `the package does not exclude ${pattern}`);
  }
});

for (const name of Object.keys(SCRIPTS)) {
  test(`${name} writes a package path that is unique to the run`, () => {
    const source = read(name);

    // Nothing may fall back to one shared name: that is the collision.
    assert.doesNotMatch(source, /ZIP_PATH="\$\{ZIP_PATH:-[^}]*\}"/);

    const assignment = source.match(/^\s*ZIP_PATH="([^"]*\$\$[^"]*)"$/m);
    assert.ok(assignment, 'ZIP_PATH is not derived per run');

    // The three things that distinguish one run from another.
    for (const part of ['DEPLOY_ENV', 'zip_tenant_slug', '$$']) {
      assert.ok(assignment[1].includes(part), `the package path does not vary by ${part}`);
    }
  });

  test(`${name} removes only a package it named itself`, () => {
    const source = read(name);

    assert.match(source, /trap cleanup_zip EXIT/);

    // A ZIP_PATH the caller passed in is their file, in a place they chose.
    // Deleting it would be a surprise, so the flag — not the trap — decides.
    assert.match(source, /ZIP_PATH_IS_TEMPORARY=0/);
    assert.match(source, /ZIP_PATH_IS_TEMPORARY=1/);
    assert.match(source, /if \[ "\$\{ZIP_PATH_IS_TEMPORARY:-0\}" = "1" \]/);
  });
}
