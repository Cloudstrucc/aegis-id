// One-time code delivery for wallet recovery.
//
// Production requires a configured channel: if nothing is configured the code is
// NOT echoed back, because doing so would let anyone who can reach the API
// recover any wallet. Outside production the code is returned so local testing
// needs no mail server or SMS provider.

const config = require('../config');
const { getNotificationSettings } = require('./notification-settings-service');
const { sendEmail, sendSms, maskRecipient } = require('../adapters/notify/notification-adapter');
const { writeAuditEvent } = require('./audit-service');

function isProduction() {
  return config.app.env === 'production';
}

function buildMessage(code, walletId) {
  const subject = 'Your Aegis ID wallet recovery code';
  const text = [
    `Your Aegis ID verification code is ${code}.`,
    '',
    `Wallet: ${walletId}`,
    'This code expires in 10 minutes and can only be used once.',
    '',
    'If you did not request this, someone may be attempting to recover your wallet.',
    'Contact your organization administrator immediately.'
  ].join('\n');
  return { subject, text };
}

/**
 * Deliver a recovery code to the wallet's registered contact.
 *
 * Returns { delivered, channels, devCode } where devCode is only ever populated
 * outside production.
 */
async function deliverRecoveryCode({ code, walletId, email, phone }) {
  const settings = await getNotificationSettings();
  const { subject, text } = buildMessage(code, walletId);
  const channels = [];
  const failures = [];

  if (email) {
    try {
      const result = await sendEmail(settings, { to: email, subject, text });
      if (result.delivered) {
        channels.push({ channel: 'email', to: result.to });
      }
    } catch (error) {
      failures.push({ channel: 'email', message: error.message });
    }
  }

  if (phone) {
    try {
      const result = await sendSms(settings, { to: phone, body: `Aegis ID verification code: ${code}` });
      if (result.delivered) {
        channels.push({ channel: 'sms', to: result.to });
      }
    } catch (error) {
      failures.push({ channel: 'sms', message: error.message });
    }
  }

  const delivered = channels.length > 0;

  await writeAuditEvent('wallet.recovery.otp.dispatched', {
    walletId,
    delivered,
    channels: channels.map((entry) => entry.channel),
    failures: failures.map((entry) => `${entry.channel}: ${entry.message}`),
    recipient: maskRecipient(email || phone || '')
  });

  if (!delivered && isProduction()) {
    // Fail closed: never fall back to returning the code in production.
    const error = new Error(
      'No delivery channel is configured, so a verification code could not be sent. ' +
        'Ask a platform administrator to configure email or SMS delivery.'
    );
    error.status = 503;
    error.expose = true;
    throw error;
  }

  return {
    delivered,
    channels,
    failures,
    devCode: isProduction() ? undefined : code
  };
}

module.exports = { deliverRecoveryCode };
