#!/usr/bin/env node
'use strict';

// Independent verifier for the tamper-evident evidence ledger (plan §5.A.3).
//
// Recomputes every hash, checks the prev-hash links, and (when signing is
// enabled) verifies signatures. Exit code 0 = intact, 1 = broken, 2 = error.
//
// Usage:
//   node scripts/verify-audit-chain.js
//   AUDIT_STORE_PATH=/path/to/audit-events.json node scripts/verify-audit-chain.js

const { verifyAuditChain } = require('../src/services/audit-service');

(async () => {
  const result = await verifyAuditChain();
  console.log(JSON.stringify(result, null, 2));

  if (result.ok) {
    console.log(`\n✓ Evidence ledger intact — ${result.count} record(s) verified.`);
    process.exit(0);
  }

  console.error(`\n✗ Evidence ledger FAILED verification: ${result.reason} at seq ${result.brokenAtSeq}.`);
  process.exit(1);
})().catch((error) => {
  console.error('Verifier error:', error);
  process.exit(2);
});
