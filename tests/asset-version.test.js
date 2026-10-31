const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Static assets are cached for a day in production. Without a version on the
// URL, every deploy left customers on the previous stylesheet for up to 24
// hours — and a template that needed the new one rendered broken. The layout
// must link the stylesheet and script with a content-derived version.

test('the layout links main.css and main.js with a content version', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const html = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/support`, (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => resolve(body));
      }).on('error', reject);
    });
    const css = html.match(/href="\/styles\/main\.css\?v=([0-9a-f]{10})"/);
    const brand = html.match(/href="\/styles\/brand-layer\.css\?v=([0-9a-f]{10})"/);
    const js = html.match(/src="\/scripts\/main\.js\?v=([0-9a-f]{10})"/);
    assert.ok(css, 'stylesheet is linked with ?v=<hash>');
    assert.ok(brand, 'brand layer is linked with ?v=<hash>');
    assert.ok(js, 'script is linked with ?v=<hash>');
    assert.equal(css[1], js[1], 'one version for both');
    assert.equal(brand[1], css[1], 'the brand layer shares that version');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// The version is a hash of the files the layout links. A stylesheet left out
// of that hash is served stale after a deploy that only changed it — which is
// the bug this whole mechanism exists to prevent.
test('the version changes when any linked asset changes', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const config = require('../src/config');
  const { createApp } = require('../src/app');

  const brandLayer = path.join(config.paths.public, 'styles', 'brand-layer.css');
  const original = fs.readFileSync(brandLayer);

  const versionOf = async () => {
    delete require.cache[require.resolve('../src/app')];
    const server = http.createServer(require('../src/app').createApp());
    await new Promise((resolve) => server.listen(0, resolve));
    try {
      const { port } = server.address();
      const html = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/support`, (response) => {
          let body = '';
          response.on('data', (chunk) => { body += chunk; });
          response.on('end', () => resolve(body));
        }).on('error', reject);
      });
      return html.match(/href="\/styles\/main\.css\?v=([0-9a-f]{10})"/)[1];
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  };

  const before = await versionOf();
  try {
    fs.writeFileSync(brandLayer, Buffer.concat([original, Buffer.from('\n/* cache-bust probe */\n')]));
    const after = await versionOf();
    assert.notEqual(after, before, 'editing brand-layer.css must change the asset version');
  } finally {
    fs.writeFileSync(brandLayer, original);
    delete require.cache[require.resolve('../src/app')];
  }
});
