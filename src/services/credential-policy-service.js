const config = require('../config');

function buildDemoEmployeeClaims(input = {}) {
  return {
    employeeId: input.employeeId || 'CS-10027',
    displayName: input.displayName || 'Cloudstrucc Team Member',
    email: input.email || 'identity@cloudstrucc.com',
    department: input.department || 'Architecture',
    role: input.role || 'Verified Identity Pilot',
    assuranceLevel: 'FIDO2_YUBIKEY',
    employmentStatus: 'active'
  };
}

function getPresentationPolicy() {
  return {
    credentialType: config.verifiedId.credentialType,
    acceptedIssuers: config.verifiedId.authorityDid ? [config.verifiedId.authorityDid] : ['did:web:cloudstrucc.example'],
    requestedClaims: ['employeeId', 'email', 'employmentStatus', 'assuranceLevel'],
    authorizationRules: [
      {
        grant: 'employee_portal_access',
        when: {
          employmentStatus: 'active',
          assuranceLevel: 'FIDO2_YUBIKEY'
        }
      }
    ]
  };
}

function evaluatePresentation(claims = {}) {
  const policy = getPresentationPolicy();
  const missingClaims = policy.requestedClaims.filter((claimName) => !claims[claimName]);
  const matchingRule = policy.authorizationRules.find((rule) =>
    Object.entries(rule.when).every(([claimName, expected]) => claims[claimName] === expected)
  );

  return {
    granted: missingClaims.length === 0 && Boolean(matchingRule),
    grant: matchingRule?.grant || null,
    missingClaims
  };
}

module.exports = {
  buildDemoEmployeeClaims,
  evaluatePresentation,
  getPresentationPolicy
};
