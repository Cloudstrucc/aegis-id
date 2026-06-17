const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../src/app');

test('Verified ID card logo is loadable by cross-origin provider portals', async () => {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/images/cloudstrucc-verified-id-logo-mark.png`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^image\/png/);
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
