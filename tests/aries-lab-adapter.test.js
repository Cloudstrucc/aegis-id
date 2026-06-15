const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  createOutOfBandInvitation,
  describeConnectionError
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
  assert.equal(invitation.phoneReachable, true);
  assert.match(invitation.qrCodeDataUrl, /^data:image\/png;base64,/);
});
