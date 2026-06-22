const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const { createDidWebRouter } = require('../src/routes/did-web');

async function withServer(app, callback) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const { port } = server.address();
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('DID:web routes return public DID document and DID configuration when enabled', async () => {
  const app = express();
  app.use(
    createDidWebRouter({
      didWebService: {
        isEnabled: () => true,
        getDidDocument: async () => ({ id: 'did:web:aegis.example.com' }),
        getDidConfiguration: async () => ({
          '@context': 'https://identity.foundation/.well-known/did-configuration/v1',
          linked_dids: ['jwt-value']
        })
      }
    })
  );

  await withServer(app, async (baseUrl) => {
    const didResponse = await fetch(`${baseUrl}/.well-known/did.json`);
    const didDocument = await didResponse.json();

    assert.equal(didResponse.status, 200);
    assert.match(didResponse.headers.get('content-type'), /^application\/did\+json/);
    assert.equal(didResponse.headers.get('cache-control'), 'public, max-age=300');
    assert.equal(didDocument.id, 'did:web:aegis.example.com');

    const configResponse = await fetch(`${baseUrl}/.well-known/did-configuration.json`);
    const didConfiguration = await configResponse.json();

    assert.equal(configResponse.status, 200);
    assert.deepEqual(didConfiguration.linked_dids, ['jwt-value']);
  });
});

test('DID:web routes return 404 when disabled', async () => {
  const app = express();
  app.use(
    createDidWebRouter({
      didWebService: {
        isEnabled: () => false
      }
    })
  );

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/.well-known/did.json`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error.message, 'DID:web is not enabled for this environment.');
  });
});
