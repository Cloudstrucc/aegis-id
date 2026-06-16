const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDemoEmployeeClaims,
  evaluatePresentation,
  getPresentationPolicy
} = require('../src/services/credential-policy-service');

test('buildDemoEmployeeClaims applies the Vanguard assurance vocabulary', () => {
  const claims = buildDemoEmployeeClaims({ email: 'pilot@vanguardcs.ca' });

  assert.equal(claims.email, 'pilot@vanguardcs.ca');
  assert.equal(claims.assuranceLevel, 'FIDO2_YUBIKEY');
  assert.equal(claims.employmentStatus, 'active');
});

test('evaluatePresentation grants access only for active YubiKey-backed credentials', () => {
  const decision = evaluatePresentation({
    employeeId: 'CS-10027',
    email: 'pilot@vanguardcs.ca',
    employmentStatus: 'active',
    assuranceLevel: 'FIDO2_YUBIKEY'
  });

  assert.equal(decision.granted, true);
  assert.equal(decision.grant, 'employee_portal_access');
  assert.deepEqual(decision.missingClaims, []);
});

test('presentation policy requests the minimum claims used by the authorization rule', () => {
  const policy = getPresentationPolicy();

  assert.deepEqual(policy.requestedClaims, ['employeeId', 'email', 'employmentStatus', 'assuranceLevel']);
});
