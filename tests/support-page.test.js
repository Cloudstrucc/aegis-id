const test = require('node:test');
const assert = require('node:assert/strict');

// The support page, which the App Store listing points at.
//
// The property that matters is that it renders for somebody who is not signed
// in, because the people who most need it are the ones who cannot sign in — and
// because a store listing cannot point at a page behind a login. A 401 or a
// redirect here would pass unnoticed until review checked the URL.

async function withApp(run) {
  // The whole src tree, not just config: every route and service captured a
  // reference to the config object when it was first required, so clearing
  // config alone leaves the previous SUPPORT_EMAIL in place and the second
  // case silently asserts against the first case's page.
  for (const cached of Object.keys(require.cache)) {
    if (cached.includes(`${require('node:path').sep}src${require('node:path').sep}`)) {
      delete require.cache[cached];
    }
  }
  const { createApp } = require('../src/app');

  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('the support page renders to an anonymous visitor', async () => {
  const previous = process.env.SUPPORT_EMAIL;
  process.env.SUPPORT_EMAIL = 'help@example.test';

  try {
    await withApp(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/support`, { redirect: 'manual' });
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(body, /Get help with Aegis ID/);

      // The contact route, and the recovery paths somebody arrives here for.
      assert.match(body, /help@example\.test/);
      assert.match(body, /\/auth\/recover/);

      // Recovery codes rotate the key rather than restoring it. Saying so is
      // the whole reason the page exists for a holder with a lost phone.
      assert.match(body, /never leaves the device/);
    });
  } finally {
    if (previous === undefined) {
      delete process.env.SUPPORT_EMAIL;
    } else {
      process.env.SUPPORT_EMAIL = previous;
    }
  }
});

test('with no address configured the support page says so rather than inventing one', async () => {
  const previous = process.env.SUPPORT_EMAIL;
  delete process.env.SUPPORT_EMAIL;

  try {
    await withApp(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/support`);
      const body = await response.text();

      assert.equal(response.status, 200);
      assert.match(body, /No support address is configured/);
      assert.doesNotMatch(body, /mailto:/);
    });
  } finally {
    if (previous !== undefined) {
      process.env.SUPPORT_EMAIL = previous;
    }
  }
});
