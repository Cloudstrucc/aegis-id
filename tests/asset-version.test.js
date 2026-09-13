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
    const js = html.match(/src="\/scripts\/main\.js\?v=([0-9a-f]{10})"/);
    assert.ok(css, 'stylesheet is linked with ?v=<hash>');
    assert.ok(js, 'script is linked with ?v=<hash>');
    assert.equal(css[1], js[1], 'one version for both');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
