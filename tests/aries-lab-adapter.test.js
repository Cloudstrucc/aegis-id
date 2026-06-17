const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  createIosWalletDeepLink,
  createOutOfBandInvitation,
  describeConnectionError,
  sendWalletChallenge
} = require('../src/adapters/aries/aries-lab-adapter');

test('Aries status unwraps refused admin port errors with a useful hint', () => {
  const details = describeConnectionError({
    name: 'TypeError',
    message: 'fetch failed',
    cause: {
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED 127.0.0.1:4011'
    }
  });

  assert.equal(details.error, 'ECONNREFUSED');
  assert.match(details.message, /not listening/);
  assert.match(details.hint, /Docker Desktop/);
});

test('Aries status reports timeout errors with container guidance', () => {
  const details = describeConnectionError({
    name: 'TimeoutError',
    message: 'The operation was aborted due to timeout'
  });

  assert.equal(details.error, 'TimeoutError');
  assert.match(details.hint, /container/);
});

test('createOutOfBandInvitation returns an iOS-scannable OOB QR payload', async (t) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    requests.push({
      method: req.method,
      url: req.url,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
    });

    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        invitation_url: 'http://10.0.0.240:4010?oob=eyJAdHlwZSI6Imh0dHBzOi8vZGlkY29tbS5vcmcvb3V0LW9mLWJhbmQvMS4xL2ludml0YXRpb24iLCJAaWQiOiJpbnZpdGUifQ'
      })
    );
  });

  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());

  const { port } = server.address();
  const invitation = await createOutOfBandInvitation('issuer', {
    baseUrl: `http://127.0.0.1:${port}`
  });

  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/out-of-band/create-invitation?auto_accept=true');
  assert.deepEqual(requests[0].body.handshake_protocols, ['https://didcomm.org/didexchange/1.0']);
  assert.equal(requests[0].body.use_did_method, 'did:peer:2');
  assert.match(invitation.invitationUrl, /\?oob=/);
  assert.match(invitation.iosDeepLinkUrl, /^aegisid:\/\/invite\?oob=/);
  assert.equal(invitation.phoneReachable, true);
  assert.match(invitation.qrCodeDataUrl, /^data:image\/png;base64,/);
  assert.match(invitation.iosQrCodeDataUrl, /^data:image\/png;base64,/);
});

test('createOutOfBandInvitation sends configured ACA-Py admin API key', async (t) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    requests.push({
      method: req.method,
      url: req.url,
      apiKey: req.headers['x-api-key']
    });

    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        invitation_url: 'http://10.0.0.240:4010?oob=eyJAdHlwZSI6Imh0dHBzOi8vZGlkY29tbS5vcmcvb3V0LW9mLWJhbmQvMS4xL2ludml0YXRpb24iLCJAaWQiOiJpbnZpdGUifQ'
      })
    );
  });

  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());

  const previousIssuerUrl = process.env.ARIES_ISSUER_ADMIN_URL;
  const previousAdminApiKey = process.env.ARIES_ADMIN_API_KEY;
  const previousIssuerApiKey = process.env.ARIES_ISSUER_ADMIN_API_KEY;
  process.env.ARIES_ISSUER_ADMIN_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.ARIES_ADMIN_API_KEY = 'test-admin-key';
  process.env.ARIES_ISSUER_ADMIN_API_KEY = '';
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/adapters/aries/aries-lab-adapter')];
  const { createOutOfBandInvitation: createWithEnv } = require('../src/adapters/aries/aries-lab-adapter');

  t.after(() => {
    if (previousIssuerUrl === undefined) {
      delete process.env.ARIES_ISSUER_ADMIN_URL;
    } else {
      process.env.ARIES_ISSUER_ADMIN_URL = previousIssuerUrl;
    }
    if (previousAdminApiKey === undefined) {
      delete process.env.ARIES_ADMIN_API_KEY;
    } else {
      process.env.ARIES_ADMIN_API_KEY = previousAdminApiKey;
    }
    restoreEnv('ARIES_ISSUER_ADMIN_API_KEY', previousIssuerApiKey);
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/adapters/aries/aries-lab-adapter')];
  });

  await createWithEnv('issuer');

  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].apiKey, 'test-admin-key');
});

test('createIosWalletDeepLink keeps the OOB payload, source endpoint, and org metadata', () => {
  const deepLink = createIosWalletDeepLink(
    'http://10.0.0.240:4010?oob=abc123&vanguard_org_id=org-1&vanguard_org_name=Vanguard'
  );
  const url = new URL(deepLink);

  assert.equal(url.protocol, 'aegisid:');
  assert.equal(url.host, 'invite');
  assert.equal(url.searchParams.get('oob'), 'abc123');
  assert.equal(url.searchParams.get('endpoint'), 'http://10.0.0.240:4010');
  assert.equal(url.searchParams.get('vanguard_org_id'), 'org-1');
  assert.equal(url.searchParams.get('vanguard_org_name'), 'Vanguard');
});

test('acceptInvitationWithHolder posts OOB payload through holder and resolves issuer connection', async (t) => {
  const requests = [];
  const invitationUrl =
    'http://issuer.example:4010?oob=eyJAdHlwZSI6Imh0dHBzOi8vZGlkY29tbS5vcmcvb3V0LW9mLWJhbmQvMS4xL2ludml0YXRpb24iLCJAaWQiOiJpbnZpdGUtMSIsImxhYmVsIjoiVmFuZ3VhcmQgSXNzdWVyIn0';
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    requests.push({ method: req.method, url: req.url, body, apiKey: req.headers['x-api-key'] });

    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/out-of-band/receive-invitation?auto_accept=true&use_existing_connection=true') {
      res.end(JSON.stringify({ connection_id: 'holder-conn-1', invi_msg_id: 'invite-1' }));
      return;
    }

    if (req.url === '/connections/holder-conn-1') {
      res.end(JSON.stringify({ connection_id: 'holder-conn-1', state: 'active', rfc23_state: 'completed' }));
      return;
    }

    if (req.url === '/connections') {
      res.end(
        JSON.stringify({
          results: [
            {
              connection_id: 'issuer-conn-1',
              invitation_msg_id: 'invite-1',
              state: 'active',
              rfc23_state: 'completed'
            }
          ]
        })
      );
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());

  const previousHolderUrl = process.env.ARIES_HOLDER_ADMIN_URL;
  const previousIssuerUrl = process.env.ARIES_ISSUER_ADMIN_URL;
  const previousAdminApiKey = process.env.ARIES_ADMIN_API_KEY;
  const previousHolderApiKey = process.env.ARIES_HOLDER_ADMIN_API_KEY;
  const previousIssuerApiKey = process.env.ARIES_ISSUER_ADMIN_API_KEY;
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  process.env.ARIES_HOLDER_ADMIN_URL = baseUrl;
  process.env.ARIES_ISSUER_ADMIN_URL = baseUrl;
  process.env.ARIES_ADMIN_API_KEY = 'test-admin-key';
  process.env.ARIES_HOLDER_ADMIN_API_KEY = '';
  process.env.ARIES_ISSUER_ADMIN_API_KEY = '';
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/adapters/aries/aries-lab-adapter')];
  const { acceptInvitationWithHolder } = require('../src/adapters/aries/aries-lab-adapter');

  t.after(() => {
    restoreEnv('ARIES_HOLDER_ADMIN_URL', previousHolderUrl);
    restoreEnv('ARIES_ISSUER_ADMIN_URL', previousIssuerUrl);
    restoreEnv('ARIES_ADMIN_API_KEY', previousAdminApiKey);
    restoreEnv('ARIES_HOLDER_ADMIN_API_KEY', previousHolderApiKey);
    restoreEnv('ARIES_ISSUER_ADMIN_API_KEY', previousIssuerApiKey);
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/adapters/aries/aries-lab-adapter')];
  });

  const result = await acceptInvitationWithHolder(invitationUrl, { attempts: 1, delayMs: 1 });

  assert.equal(result.holderConnectionId, 'holder-conn-1');
  assert.equal(result.issuerConnectionId, 'issuer-conn-1');
  assert.equal(result.invitationMessageId, 'invite-1');
  assert.equal(result.holderState, 'completed');
  assert.equal(result.issuerState, 'completed');
  assert.equal(requests[0].apiKey, 'test-admin-key');
  assert.equal(requests[0].body['@id'], 'invite-1');
});

test('sendWalletChallenge posts trust ping and basic message to a completed connection', async (t) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    requests.push({ method: req.method, url: req.url, body });

    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/connections') {
      res.end(
        JSON.stringify({
          results: [
            {
              connection_id: 'conn-1',
              state: 'active',
              rfc23_state: 'completed',
              their_label: 'Vanguard iOS Holder Stand-in'
            }
          ]
        })
      );
      return;
    }

    if (req.url.endsWith('/send-ping')) {
      res.end(JSON.stringify({ thread_id: 'thread-1' }));
      return;
    }

    res.end(JSON.stringify({}));
  });

  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());

  const previousIssuerUrl = process.env.ARIES_ISSUER_ADMIN_URL;
  process.env.ARIES_ISSUER_ADMIN_URL = `http://127.0.0.1:${server.address().port}`;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/adapters/aries/aries-lab-adapter')];
  const { sendWalletChallenge: sendWithEnv } = require('../src/adapters/aries/aries-lab-adapter');

  t.after(() => {
    if (previousIssuerUrl === undefined) {
      delete process.env.ARIES_ISSUER_ADMIN_URL;
    } else {
      process.env.ARIES_ISSUER_ADMIN_URL = previousIssuerUrl;
    }
    delete require.cache[require.resolve('../src/config')];
    delete require.cache[require.resolve('../src/adapters/aries/aries-lab-adapter')];
  });

  const result = await sendWithEnv('issuer', {
    comment: 'challenge-comment',
    content: 'challenge-content'
  });

  assert.equal(result.connectionId, 'conn-1');
  assert.equal(result.ping.thread_id, 'thread-1');
  assert.deepEqual(
    requests.map((request) => request.url),
    ['/connections', '/connections/conn-1/send-ping', '/connections/conn-1/send-message']
  );
  assert.equal(requests[1].body.comment, 'challenge-comment');
  assert.equal(requests[2].body.content, 'challenge-content');
});

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
