const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// The Business Expenses example app serves its own copies of Bootstrap,
// Bootswatch, Bootstrap Icons and pdf.js.
//
// This file lives at the repo root rather than in the example app because the
// example app has no test runner of its own — which is precisely how it came
// to be loading four files from cdn.jsdelivr.net while the platform next to it
// self-hosted everything. Nothing failed, because nothing was looking.
//
// What a CDN link costs, and why this is worth a test: every page view handed
// a third party the holder's IP address and the page they were on, the app's
// own cookie notice said no third party was involved, and the Content Security
// Policy had to admit an entire external origin for scripts, styles, fonts and
// workers to allow it. One pasted `<script src="https://…">` undoes all three
// at once, and does not look like a regression — the page still works.

const APP_DIR = path.join(__dirname, '..', 'examples', 'business-expenses');
const VENDOR_DIR = path.join(APP_DIR, 'public', 'vendor');

function walk(dir, predicate) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(full, predicate));
    } else if (predicate(full)) {
      found.push(full);
    }
  }
  return found;
}

test('the example app loads nothing from an origin that is not its own', () => {
  // Its own markup and its own scripts — not public/vendor, which is other
  // people's code and full of license URLs and SVG namespaces.
  const sources = [
    ...walk(path.join(APP_DIR, 'views'), (file) => file.endsWith('.hbs')),
    ...fs
      .readdirSync(path.join(APP_DIR, 'public'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(js|mjs|css)$/.test(entry.name))
      .map((entry) => path.join(APP_DIR, 'public', entry.name))
  ];

  assert.ok(sources.length > 10, 'expected to find the example app sources');

  for (const file of sources) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = path.relative(path.join(__dirname, '..'), file);

    // A tag or an import naming an absolute origin. Template expressions are
    // not matched, so a form posting to {{aegisBaseUrl}} is fine — that is the
    // holder deliberately going to Aegis, not an asset fetched behind them.
    const tags = source.match(/(?:src|href)=["']https?:\/\/[^"']+["']/gi) || [];
    const imports = source.match(/import\(["']https?:\/\/[^"']+["']\)/gi) || [];
    const offenders = [...tags, ...imports];

    assert.deepEqual(
      offenders,
      [],
      `${relative} loads an asset from a third-party origin:\n  ${offenders.join('\n  ')}\n` +
        'Vendor it with scripts/fetch-example-vendor.sh and reference it under /vendor.'
    );
  }
});

test('the example app Content Security Policy admits no external origin', () => {
  const source = fs.readFileSync(path.join(APP_DIR, 'src', 'server.js'), 'utf8');
  const policy = source.slice(
    source.indexOf('contentSecurityPolicy'),
    source.indexOf('app.use(morgan')
  );

  assert.ok(policy.includes('defaultSrc'), 'could not find the policy to check');

  // formAction names config.aegisBaseUrl, which is where the holder is sent to
  // sign in — a navigation they take, not a request made on their behalf. Any
  // other origin in the policy means something is being fetched from it.
  const origins = (policy.match(/https?:\/\/[a-z0-9.-]+/gi) || []).filter(
    (origin) => !origin.startsWith('http://www.w3.org')
  );

  assert.deepEqual(
    origins,
    [],
    `the policy still names ${origins.join(', ')} — if nothing is loaded from there, take it out`
  );
});

test('every vendored asset is present and matches the manifest', () => {
  const manifest = fs.readFileSync(path.join(VENDOR_DIR, 'manifest.txt'), 'utf8');

  const rows = manifest
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => {
      const [sha, bytes, relative, source] = line.trim().split(/\s+/);
      return { sha, bytes: Number(bytes), relative, source };
    });

  assert.ok(rows.length >= 7, 'the manifest lists fewer files than expected');

  for (const row of rows) {
    const file = path.join(VENDOR_DIR, row.relative);
    assert.ok(fs.existsSync(file), `${row.relative} is in the manifest but not in the tree`);

    const bytes = fs.readFileSync(file);
    assert.equal(bytes.length, row.bytes, `${row.relative} is not the size the manifest records`);
    assert.equal(
      crypto.createHash('sha256').update(bytes).digest('hex'),
      row.sha,
      `${row.relative} does not match its recorded hash — re-run scripts/fetch-example-vendor.sh`
    );
  }

  // The reverse direction: a file dropped into public/vendor by hand is
  // exactly what the manifest exists to make visible.
  const onDisk = walk(VENDOR_DIR, (file) => !file.endsWith('manifest.txt')).map((file) =>
    path.relative(VENDOR_DIR, file)
  );
  assert.deepEqual(
    onDisk.sort(),
    rows.map((row) => row.relative).sort(),
    'public/vendor holds a file the manifest does not list'
  );
});

test('the Bootswatch theme no longer pulls a typeface from Google', () => {
  const theme = fs.readFileSync(
    path.join(VENDOR_DIR, 'bootstrap', 'bootstrap.flatly.min.css'),
    'utf8'
  );

  // Bootswatch themes open with @import url(https://fonts.googleapis.com/...).
  // Self-hosting the stylesheet and leaving that line in would have moved the
  // third-party request rather than removed it — and an @import blocks
  // rendering, so it was the one on the critical path. The app's own faces are
  // in public/fonts.css; it never used Lato.
  assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(theme));
  assert.ok(theme.includes('--bs-body-bg'), 'the theme does not look like Bootstrap CSS');
});
