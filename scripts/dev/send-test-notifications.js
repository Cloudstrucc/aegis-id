#!/usr/bin/env node
// Send one of every notification the platform can deliver, for testing.
//
// Every outbound message goes through deliverMessage, so this drives that
// directly with sample data — the same templates, the same channel matrix, the
// same transport that real flows use. Locally the filesystem transport writes
// each message to artifacts/mail/ (no real send); on a hosted environment it
// uses whatever email/SMS an admin configured at /admin/notifications, so run
// this against a mailbox you own.
//
// Usage:
//   node scripts/dev/send-test-notifications.js                 # all types
//   node scripts/dev/send-test-notifications.js mfa-otp         # one type
//   TEST_EMAIL=me@example.com node scripts/dev/send-test-notifications.js
//   TEST_PHONE=+16135550100 node scripts/dev/send-test-notifications.js mfa-otp
//
// It does not create accounts or touch real records — it only exercises the
// message templates and delivery. For a true end-to-end trigger (register,
// forgot password, …) see docs/notifications/README.md.

const { deliverMessage } = require('../../src/services/otp-delivery-service');

const email = process.env.TEST_EMAIL || 'notify-test@example.com';
const phone = process.env.TEST_PHONE || null;
const base = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

// Sample variables for each template. These are throwaway values — the codes
// and links do not resolve to anything.
const SAMPLES = {
  'mfa-otp': { code: '482913' },
  'password-reset': { resetUrl: `${base}/auth/reset/sample-token`, expiresInMinutes: 30 },
  'email-verification': { verifyUrl: `${base}/auth/verify-email/sample-token`, expiresInHours: 24, displayName: 'Sample Holder' },
  'account-reenrolment': { reenrolUrl: `${base}/auth/reenrol/sample-token`, expiresInMinutes: 60, displayName: 'Sample Holder' },
  'approver-recovery': { approvalUrl: `${base}/auth/recover/approvals/sample-token`, expiresInHours: 72, organizationName: 'Contoso', requesterEmail: 'admin@contoso.example' },
  'approver-recovery-status': { statusUrl: `${base}/auth/recover/approvals/sample-status`, expiresInHours: 72, organizationName: 'Contoso', approvalsRequired: 2 },
  'wallet-recovery': { code: '204815', walletId: 'AEG-SAMP-LE00-0000-0000' }
};

async function main() {
  const requested = process.argv.slice(2);
  const types = requested.length ? requested : Object.keys(SAMPLES);

  for (const type of types) {
    if (!SAMPLES[type]) {
      console.error(`Unknown type "${type}". Known: ${Object.keys(SAMPLES).join(', ')}`);
      process.exitCode = 1;
      continue;
    }
    try {
      const result = await deliverMessage({
        type,
        email,
        phone,
        variables: SAMPLES[type],
        // Uncomment to test an organization's own branding on the message:
        // context: { branding: { displayName: 'Contoso', productName: 'Contoso ID' } }
        context: {}
      });
      const where = result.channels.map((c) => `${c.channel}→${c.to}`).join(', ') || 'nowhere';
      const failed = result.failures.map((f) => `${f.channel}: ${f.message}`).join('; ');
      console.log(`${result.delivered ? 'sent  ' : 'FAILED'} ${type.padEnd(24)} ${where}${failed ? `  [${failed}]` : ''}`);
    } catch (error) {
      console.error(`error  ${type}: ${error.message}`);
      process.exitCode = 1;
    }
  }

  const config = require('../../src/config');
  if (config.app.env !== 'production') {
    console.log(`\nLocal filesystem transport: read the messages in ${config.paths.mailDrop}`);
  }
}

main();
