const test = require('node:test');
const assert = require('node:assert/strict');

const walletId = require('../src/services/wallet-id');

test('generated Wallet IDs match the AEG-XXXX-XXXX-XXXX format', () => {
  for (let index = 0; index < 200; index += 1) {
    const id = walletId.generateWalletId();
    assert.match(id, /^AEG-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  }
});

test('ambiguous characters I, L, O, U never appear in generated IDs', () => {
  for (let index = 0; index < 500; index += 1) {
    const id = walletId.generateWalletId().replace(/^AEG-/, '');
    assert.equal(/[ILOU]/.test(id), false, `found ambiguous character in ${id}`);
  }
});

test('generated Wallet IDs validate and round-trip', () => {
  for (let index = 0; index < 200; index += 1) {
    const id = walletId.generateWalletId();
    assert.equal(walletId.isValidWalletId(id), true);
    assert.equal(walletId.parseWalletId(id), id);
  }
});

test('parsing is case- and dash-insensitive', () => {
  const id = walletId.generateWalletId();
  const stripped = id.replace(/-/g, '');
  assert.equal(walletId.parseWalletId(stripped), id);
  assert.equal(walletId.parseWalletId(id.toLowerCase()), id);
  assert.equal(walletId.parseWalletId(`  ${id.toLowerCase()}  `), id);
});

test('a single-character typo is rejected by the check symbol', () => {
  let rejected = 0;
  const attempts = 200;

  for (let index = 0; index < attempts; index += 1) {
    const id = walletId.generateWalletId();
    const significant = id.replace(/^AEG-/, '').replace(/-/g, '');
    // Corrupt one character in the body to a different valid symbol.
    const position = index % 15;
    const current = significant[position];
    const replacement = walletId.ALPHABET[(walletId.ALPHABET.indexOf(current) + 1) % walletId.ALPHABET.length];
    const corrupted = `${significant.slice(0, position)}${replacement}${significant.slice(position + 1)}`;
    if (!walletId.isValidWalletId(corrupted)) {
      rejected += 1;
    }
  }

  assert.equal(rejected, attempts, 'every single-character typo must be rejected');
});

test('adjacent transpositions are rejected', () => {
  let rejected = 0;
  let considered = 0;

  for (let index = 0; index < 300; index += 1) {
    const id = walletId.generateWalletId();
    const significant = id.replace(/^AEG-/, '').replace(/-/g, '');
    const position = index % 14;
    const [a, b] = [significant[position], significant[position + 1]];
    if (a === b) {
      continue; // swapping identical characters is a no-op
    }
    considered += 1;
    const swapped = `${significant.slice(0, position)}${b}${a}${significant.slice(position + 2)}`;
    if (!walletId.isValidWalletId(swapped)) {
      rejected += 1;
    }
  }

  assert.ok(considered > 0);
  assert.equal(rejected, considered, 'every adjacent transposition must be rejected');
});

test('structurally invalid inputs are rejected', () => {
  assert.equal(walletId.parseWalletId(''), null);
  assert.equal(walletId.parseWalletId('AEG-TOO-SHORT'), null);
  assert.equal(walletId.parseWalletId('AEG-4K7P-2M9X-QT3B-EXTRA-LONG'), null);
  assert.equal(walletId.isValidWalletId(null), false);
  assert.equal(walletId.isValidWalletId(undefined), false);
});

test('generated Wallet IDs are unique across a large sample', () => {
  const seen = new Set();
  for (let index = 0; index < 10000; index += 1) {
    seen.add(walletId.generateWalletId());
  }
  assert.equal(seen.size, 10000, 'no collisions expected');
});
