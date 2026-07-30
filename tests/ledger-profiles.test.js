const test = require('node:test');
const assert = require('node:assert/strict');

const profiles = require('../src/adapters/ledger/ledger-profiles');

test('none is the default, non-writable profile', () => {
  const none = profiles.getProfile('none');
  assert.equal(none.writable, false);
  assert.equal(none.taaRequired, false);
});

test('von-local is writable with a local genesis and no TAA', () => {
  const von = profiles.getProfile('von-local');
  assert.equal(von.writable, true);
  assert.equal(von.taaRequired, false);
  assert.match(von.genesisSource, /von-network:9000\/genesis/);
});

test('CANdy and Sovrin production profiles require TAA and are Indy did namespaces', () => {
  for (const id of ['candy-prod', 'sovrin-main']) {
    const profile = profiles.getProfile(id);
    assert.equal(profile.writable, true);
    assert.equal(profile.taaRequired, true);
    assert.ok(profile.indyNamespace.length > 0);
  }
  assert.equal(profiles.getProfile('candy-prod').jurisdiction, 'CA');
  assert.equal(profiles.getProfile('sovrin-main').jurisdiction, 'global');
});

test('unknown profile throws a 400', () => {
  assert.throws(() => profiles.getProfile('does-not-exist'), (error) => error.status === 400);
});

test('isWriteReady is false for CANdy/Sovrin until genesis + TAA are configured', () => {
  // Default config has network=none and no genesis/TAA, so a fresh CANdy profile
  // is not write-ready (it still needs genesis + endorser + TAA onboarding).
  assert.equal(profiles.isWriteReady(profiles.getProfile('candy-prod')), false);
  assert.equal(profiles.isWriteReady(profiles.getProfile('none')), false);
});

test('listProfiles returns every registered network', () => {
  const ids = profiles.listProfiles().map((p) => p.id).sort();
  assert.deepEqual(ids, ['candy-prod', 'candy-test', 'none', 'sovrin-main', 'sovrin-staging', 'von-local']);
});
