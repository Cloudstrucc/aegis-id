const test = require('node:test');
const assert = require('node:assert/strict');

const { describeConnectionError } = require('../src/adapters/aries/aries-lab-adapter');

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
