const assert = require('node:assert/strict');
const test = require('node:test');

process.env.IOS_APP_TEAM_ID = 'TEAM123456';
process.env.IOS_APP_BUNDLE_IDS = [
  'ca.vanguardcs.aegisid.wallet',
  'ca.vanguardcs.aegisid.wallet.dev',
  'ca.vanguardcs.aegisid.wallet.qa'
].join(',');

const { createApp } = require('../src/app');

test('Apple app-site association advertises all configured iOS wallet bundle IDs', async () => {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/.well-known/apple-app-site-association`);
    const body = await response.json();

    const expectedAppIds = [
      'TEAM123456.ca.vanguardcs.aegisid.wallet',
      'TEAM123456.ca.vanguardcs.aegisid.wallet.dev',
      'TEAM123456.ca.vanguardcs.aegisid.wallet.qa'
    ];

    assert.deepEqual(body.webcredentials.apps, expectedAppIds);
    assert.deepEqual(body.applinks.details[0].appIDs, expectedAppIds);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
