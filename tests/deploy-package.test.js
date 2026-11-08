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

// The checkout guard. The package is built from the working tree, so the tree
// is what ships: a modified file, or one git has never seen, goes out with it
// and the deploy succeeds either way. A cache-bust probe left in `public/`
// reached dev, qa and prod exactly like that, and nothing failed, because
// nothing was looking. These tests drive the real shell function against
// throwaway repositories rather than reading it, because what matters is the
// exit status it hands the deploy script.

const os = require('node:os');
const { spawnSync } = require('node:child_process');

const GUARD = path.join(__dirname, '..', 'scripts', 'git-guard.sh');

function git(repo, ...args) {
  const result = spawnSync(
    'git',
    ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', ...args],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function guard(repo, deployEnv = 'dev', allowDirty = '0') {
  const result = spawnSync(
    'bash',
    ['-c', 'source "$1"; assert_clean_checkout "$2" "$3" "$4"', 'guard', GUARD, repo, deployEnv, allowDirty],
    { encoding: 'utf8' }
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

// A repository whose one commit exists on a remote — the state a deploy should
// be run from, and the baseline every case below departs from.
function pushedCheckout(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'aegis-checkout-guard-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const remote = path.join(root, 'remote.git');
  const repo = path.join(root, 'repo');
  spawnSync('git', ['init', '-q', '--bare', remote]);
  spawnSync('git', ['init', '-q', repo]);

  fs.writeFileSync(path.join(repo, '.gitignore'), 'artifacts/\nnode_modules/\n');
  fs.writeFileSync(path.join(repo, 'app.js'), 'ok\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'first');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', 'origin', 'HEAD');

  return repo;
}

test('a clean, pushed checkout passes and says what it is packaging', (t) => {
  const repo = pushedCheckout(t);
  const { status, output } = guard(repo, 'prod');

  assert.equal(status, 0, output);
  assert.match(output, new RegExp(git(repo, 'rev-parse', '--short=12', 'HEAD')));
  assert.match(output, /Packaging/);
});

test('a file git has never seen is refused, and named', (t) => {
  const repo = pushedCheckout(t);
  fs.writeFileSync(path.join(repo, 'cache-bust-probe.js'), '// just checking\n');

  const { status, output } = guard(repo, 'dev');

  // The untracked case is the one that cost us: `zip -r .` packages it, and
  // the page still renders, so there is no other signal.
  assert.equal(status, 1, output);
  assert.match(output, /cache-bust-probe\.js/);
});

test('an ignored file is not dirt', (t) => {
  const repo = pushedCheckout(t);
  fs.mkdirSync(path.join(repo, 'artifacts'));
  fs.writeFileSync(path.join(repo, 'artifacts', 'build.log'), 'noise\n');

  // If the guard blocked on these the override would be set permanently, and
  // a guard nobody can satisfy is worse than none.
  assert.equal(guard(repo, 'prod').status, 0);
});

test('a modified tracked file is refused unless the override is given', (t) => {
  const repo = pushedCheckout(t);
  fs.appendFileSync(path.join(repo, 'app.js'), 'const debug = true\n');

  const refused = guard(repo, 'dev');
  assert.equal(refused.status, 1, refused.output);
  assert.match(refused.output, /app\.js/);

  const overridden = guard(repo, 'dev', '1');
  assert.equal(overridden.status, 0, overridden.output);
  // An override that says nothing is how this becomes the default.
  assert.match(overridden.output, /allow-dirty/);
  assert.match(overridden.output, /app\.js/);
});

test('an unpushed commit stops prod and only warns dev', (t) => {
  const repo = pushedCheckout(t);
  fs.writeFileSync(path.join(repo, 'later.js'), 'later\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'not pushed anywhere');

  const onDev = guard(repo, 'dev');
  assert.equal(onDev.status, 0, onDev.output);
  assert.match(onDev.output, /not on any remote branch/);

  // Prod is the environment somebody asks "what is running?" about.
  assert.equal(guard(repo, 'prod').status, 1);
  assert.equal(guard(repo, 'prod', '1').status, 0);
});

for (const name of Object.keys(SCRIPTS)) {
  test(`${name} checks the checkout before it builds or uploads anything`, () => {
    const source = read(name);

    const guardAt = source.indexOf('assert_clean_checkout');
    assert.ok(guardAt > 0, 'the script does not check the checkout at all');

    // Refusing after npm install, after az login, or — worst — after the
    // upload, would be a guard in name only. Matched at the start of a line so
    // a comment mentioning `npm install` is not mistaken for running it.
    const steps = {
      'npm install': /^[ \t]*npm install\b/m,
      'az login': /^[ \t]*az login\b/m,
      'zip -r': /^[ \t]*zip -r\b/m,
      'az webapp deploy': /^[ \t]*az webapp deploy\b/m
    };

    for (const [label, pattern] of Object.entries(steps)) {
      const at = source.search(pattern);
      assert.ok(at > 0, `${name} no longer runs ${label}; this test needs updating`);
      assert.ok(at > guardAt, `${name} reaches "${label}" before it checks the checkout`);
    }
  });
}
