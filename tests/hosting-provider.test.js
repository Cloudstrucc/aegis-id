const test = require('node:test');
const assert = require('node:assert/strict');

// The Azure hosting provider. The ARM calls themselves need a real
// subscription, so what is covered here is what is ours: manual is always a
// no-op that reports ready, and azure refuses cleanly when the deployment is
// not configured for it.

function load(env) {
  const previous = { ...process.env };
  Object.assign(process.env, env);
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/src/config') || key.includes('/src/services/hosting-provider')) {
      delete require.cache[key];
    }
  }
  const mod = require('../src/services/hosting-provider');
  return { mod, restore: () => { process.env = previous; } };
}

test('the manual provider binds nothing and is always ready', async () => {
  const { mod, restore } = load({ CUSTOM_HOSTING_PROVIDER: 'manual' });
  try {
    assert.equal(mod.provider(), 'manual');
    assert.deepEqual(await mod.bindHostname('id.contoso.example'), { ready: true });
    await mod.unbindHostname('id.contoso.example'); // no throw
  } finally {
    restore();
  }
});

test('the none provider is a no-op too', async () => {
  const { mod, restore } = load({ CUSTOM_HOSTING_PROVIDER: 'none' });
  try {
    assert.deepEqual(await mod.bindHostname('id.contoso.example'), { ready: true });
  } finally {
    restore();
  }
});

test('the azure provider refuses when the site is not configured', async () => {
  const { mod, restore } = load({
    CUSTOM_HOSTING_PROVIDER: 'azure',
    HOSTING_AZURE_SUBSCRIPTION_ID: '',
    AZURE_SUBSCRIPTION_ID: '',
    WEBSITE_RESOURCE_GROUP: '',
    AZURE_RESOURCE_GROUP: '',
    WEBSITE_SITE_NAME: '',
    AZURE_WEBAPP_NAME: ''
  });
  try {
    assert.equal(mod.provider(), 'azure');
    await assert.rejects(mod.bindHostname('id.contoso.example'), (error) => {
      assert.equal(error.status, 500);
      assert.match(error.message, /not fully configured/);
      return true;
    });
  } finally {
    restore();
  }
});
