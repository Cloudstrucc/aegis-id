const test = require('node:test');
const assert = require('node:assert/strict');

const chain = require('../src/services/evidence-chain');

function coreEvent(type, data) {
  return { id: `id-${type}`, type, data, createdAt: `2026-07-30T0${data.n}:00:00.000Z` };
}

test('canonicalize is stable regardless of key order', () => {
  const a = chain.canonicalize({ b: 1, a: 2, c: { y: 1, x: 2 } });
  const b = chain.canonicalize({ c: { x: 2, y: 1 }, a: 2, b: 1 });
  assert.equal(a, b);
});

test('chainAll builds a contiguous, linked chain from genesis', () => {
  const records = chain.chainAll([coreEvent('a', { n: 1 }), coreEvent('b', { n: 2 }), coreEvent('c', { n: 3 })]);
  assert.deepEqual(records.map((r) => r.seq), [0, 1, 2]);
  assert.equal(records[0].prevHash, chain.GENESIS_PREV_HASH);
  assert.equal(records[1].prevHash, records[0].hash);
  assert.equal(records[2].prevHash, records[1].hash);
  assert.equal(chain.isChained(records), true);
  assert.deepEqual(chain.verifyChain(records), { ok: true, count: 3 });
});

test('verifyChain detects a tampered payload and pinpoints the seq', () => {
  const records = chain.chainAll([coreEvent('a', { n: 1 }), coreEvent('b', { n: 2 }), coreEvent('c', { n: 3 })]);
  // Edit record 1's data without recomputing hashes (a silent tamper).
  records[1].data = { n: 2, tampered: true };
  const result = chain.verifyChain(records);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAtSeq, 1);
  assert.equal(result.reason, 'payload-tampered');
});

test('verifyChain detects a deleted record (broken link)', () => {
  const records = chain.chainAll([coreEvent('a', { n: 1 }), coreEvent('b', { n: 2 }), coreEvent('c', { n: 3 })]);
  const withGap = [records[0], records[2]]; // drop seq 1
  const result = chain.verifyChain(withGap);
  assert.equal(result.ok, false);
  // seq 2 now sits at index 1 → seq-out-of-order is the first broken invariant.
  assert.equal(result.reason, 'seq-out-of-order');
});

test('verifyChain detects reordering', () => {
  const records = chain.chainAll([coreEvent('a', { n: 1 }), coreEvent('b', { n: 2 }), coreEvent('c', { n: 3 })]);
  const swapped = [records[1], records[0], records[2]];
  assert.equal(chain.verifyChain(swapped).ok, false);
});
