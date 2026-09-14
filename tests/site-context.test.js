const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Phase A of custom domains: the deployment's base URL is read in exactly one
// place. Everything that emits a URL asks the request (`req.site.baseUrl`) or
// the organization (`baseUrlForWorkspace`). This is the guard that keeps a
// new call site from quietly reintroducing the single-host assumption that
// the rest of the feature is built on removing.

const ROOT = path.resolve(__dirname, '..');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : full.endsWith('.js') ? [full] : [];
  });
}

test('only site-context-service reads the deployment base URL', () => {
  const offenders = walk(path.join(ROOT, 'src'))
    .filter((file) => !file.endsWith('config/index.js') && !file.endsWith('site-context-service.js'))
    .filter((file) => /config\.app\.publicBaseUrl/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(ROOT, file));
  assert.deepEqual(offenders, [], `read config.app.publicBaseUrl directly: ${offenders.join(', ')}`);
});

test('every request carries its site, and the platform site answers with the configured base URL', async () => {
  const previous = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'https://id.example.test/';
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/services/site-context-service')];
  try {
    const { platformBaseUrl, platformHost, resolveSite, baseUrlForWorkspace } = require('../src/services/site-context-service');
    assert.equal(platformBaseUrl(), 'https://id.example.test', 'trailing slash dropped');
    assert.equal(platformHost(), 'id.example.test');
    assert.equal(await baseUrlForWorkspace('any-workspace'), 'https://id.example.test');

    // Phase A: any host is the platform site — nothing is refused yet.
    const site = resolveSite('10.0.0.5:3000');
    assert.equal(site.kind, 'platform');
    assert.equal(site.baseUrl, 'https://id.example.test');
    assert.equal(site.workspaceId, null);
  } finally {
    if (previous === undefined) {
      delete process.env.PUBLIC_BASE_URL;
    } else {
      process.env.PUBLIC_BASE_URL = previous;
    }
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/services/site-context-service')];
  }
});

test('the middleware exposes req.site and site to templates', () => {
  const { attachSiteContext } = require('../src/middleware/site-context');
  const req = { hostname: 'localhost', get: () => 'localhost:3000' };
  const res = { locals: {} };
  let called = false;
  attachSiteContext(req, res, () => { called = true; });

  assert.equal(called, true);
  assert.equal(req.site.kind, 'platform');
  assert.equal(req.site.hostname, 'localhost');
  assert.match(req.site.baseUrl, /^https?:\/\//);
  assert.equal(res.locals.site, req.site, 'templates see the same object');
});
