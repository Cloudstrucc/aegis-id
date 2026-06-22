const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

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

test('Verified ID callback records unknown states as external presentation ledger transactions', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-vid-callback-'));
  const previousEnv = snapshotEnv([
    'APP_ENV',
    'NODE_ENV',
    'TRANSACTION_STORE_PATH',
    'AUDIT_STORE_PATH',
    'VID_CALLBACK_API_KEY',
    'VID_MODE'
  ]);
  process.env.APP_ENV = 'test';
  process.env.NODE_ENV = 'test';
  process.env.TRANSACTION_STORE_PATH = path.join(tempDir, 'transactions.json');
  process.env.AUDIT_STORE_PATH = path.join(tempDir, 'audit-events.json');
  process.env.VID_CALLBACK_API_KEY = 'test-callback-key';
  process.env.VID_MODE = 'live';
  resetModules();

  t.after(() => {
    restoreEnv(previousEnv);
    resetModules();
  });

  const apiRouter = require('../src/routes/api');
  const { listTransactions } = require('../src/services/transaction-store');
  const { listAuditEvents } = require('../src/services/audit-service');
  const app = buildApp(apiRouter);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/verifier/callback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'api-key': 'test-callback-key'
      },
      body: JSON.stringify({
        requestId: 'manual-request-1',
        state: 'external-state-1',
        requestStatus: 'presentation_verified',
        subject: 'did:example:holder',
        registration: {
          clientName: 'Manual Microsoft Verified ID request'
        },
        verifiedCredentialsData: [
          {
            claims: {
              employeeId: 'VCS-10027',
              email: 'person@example.com',
              employmentStatus: 'active',
              assuranceLevel: 'FIDO2_YUBIKEY'
            }
          }
        ]
      })
    });

    const body = await response.json();
    assert.equal(response.status, 202);
    assert.equal(body.accepted, true);
    assert.equal(body.external, true);
    assert.equal(body.transactionId, 'manual-request-1');
    assert.equal(body.decision.granted, true);

    const transactions = await listTransactions();
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].source, 'external-verified-id-callback');
    assert.equal(transactions[0].status, 'verified');
    assert.equal(transactions[0].appName, 'Manual Microsoft Verified ID request');
    assert.equal(transactions[0].claims.email, 'person@example.com');

    const auditEvents = await listAuditEvents();
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].type, 'verified-id.presentation.callback');
    assert.equal(auditEvents[0].data.external, true);
  });
});

test('Verified ID callback updates known presentation state without creating duplicates', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-vid-known-callback-'));
  const previousEnv = snapshotEnv([
    'APP_ENV',
    'NODE_ENV',
    'TRANSACTION_STORE_PATH',
    'AUDIT_STORE_PATH',
    'VID_CALLBACK_API_KEY',
    'VID_MODE'
  ]);
  process.env.APP_ENV = 'test';
  process.env.NODE_ENV = 'test';
  process.env.TRANSACTION_STORE_PATH = path.join(tempDir, 'transactions.json');
  process.env.AUDIT_STORE_PATH = path.join(tempDir, 'audit-events.json');
  process.env.VID_CALLBACK_API_KEY = 'test-callback-key';
  process.env.VID_MODE = 'live';
  resetModules();

  t.after(() => {
    restoreEnv(previousEnv);
    resetModules();
  });

  const apiRouter = require('../src/routes/api');
  const { listTransactions, saveTransaction } = require('../src/services/transaction-store');
  await saveTransaction({
    id: 'known-presentation-1',
    kind: 'presentation',
    state: 'known-state-1',
    status: 'created',
    mode: 'live',
    requestUrl: 'openid-vc://?request_uri=https://verifiedid.did.msidentity.com/request/known'
  });

  const app = buildApp(apiRouter);

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/verifier/callback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'api-key': 'test-callback-key'
      },
      body: JSON.stringify({
        requestId: 'provider-request-id',
        state: 'known-state-1',
        requestStatus: 'presentation_verified',
        subject: 'did:example:holder',
        claims: {
          employeeId: 'VCS-10028',
          email: 'known@example.com',
          employmentStatus: 'active',
          assuranceLevel: 'FIDO2_YUBIKEY'
        }
      })
    });

    const body = await response.json();
    assert.equal(response.status, 202);
    assert.equal(body.accepted, true);
    assert.equal(body.external, false);
    assert.equal(body.transactionId, 'known-presentation-1');

    const transactions = await listTransactions();
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].id, 'known-presentation-1');
    assert.equal(transactions[0].status, 'verified');
    assert.equal(transactions[0].claims.email, 'known@example.com');
  });
});

function buildApp(apiRouter) {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }
    res.status(error.status || 500).json({
      error: {
        message: error.message
      }
    });
  });
  return app;
}

function resetModules() {
  for (const modulePath of [
    '../src/config',
    '../src/routes/api',
    '../src/services/audit-service',
    '../src/services/file-json-store',
    '../src/services/transaction-store'
  ]) {
    delete require.cache[require.resolve(modulePath)];
  }
}

function snapshotEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}
