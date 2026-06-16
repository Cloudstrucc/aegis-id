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
  assert.match(invitation.iosDeepLinkUrl, /^cloudstrucc-wallet:\/\/invite\?oob=/);
  assert.equal(invitation.phoneReachable, true);
  assert.match(invitation.qrCodeDataUrl, /^data:image\/png;base64,/);
  assert.match(invitation.iosQrCodeDataUrl, /^data:image\/png;base64,/);
});

test('createIosWalletDeepLink keeps the OOB payload and source endpoint', () => {
  const deepLink = createIosWalletDeepLink('http://10.0.0.240:4010?oob=abc123');
  const url = new URL(deepLink);

  assert.equal(url.protocol, 'cloudstrucc-wallet:');
  assert.equal(url.host, 'invite');
  assert.equal(url.searchParams.get('oob'), 'abc123');
  assert.equal(url.searchParams.get('endpoint'), 'http://10.0.0.240:4010');
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
              their_label: 'Cloudstrucc iOS Holder Stand-in'
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
