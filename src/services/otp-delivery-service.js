// Outbound message delivery for one-time codes, reset links and wallet notices.
//
// Every message the platform sends to a person goes through deliverMessage, so
// there is one place that decides which channels a given kind of message may
// use, one audit trail, and one delivery log an admin can read.
//
// Codes are never returned to the caller. For local development configure the
// "filesystem" preset, which writes messages to disk instead of sending them.

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { channelAllowed, getNotificationSettings } = require('./notification-settings-service');
const { sendEmail, sendSms, maskRecipient } = require('../adapters/notify/notification-adapter');
const { writeAuditEvent } = require('./audit-service');

const logStore = new FileJsonStore(config.paths.notificationLog, []);
const LOG_LIMIT = 200;

/**
 * Message templates. Each returns { subject, text, sms } from its variables, so
 * wording lives in one place rather than being spread across call sites.
 */
const TEMPLATES = {
  'mfa-otp': ({ code }) => ({
    subject: 'Your Aegis ID sign-in code',
    text: [
      `Your Aegis ID sign-in code is ${code}.`,
      '',
      'This code expires in 10 minutes and can only be used once.',
      '',
      'If you did not try to sign in, change your password immediately.'
    ].join('\n'),
    sms: `Aegis ID sign-in code: ${code}`
  }),
  'password-reset': ({ resetUrl, expiresInMinutes }) => ({
    subject: 'Reset your Aegis ID password',
    text: [
      'Someone asked to reset the password on your Aegis ID account.',
      '',
      resetUrl,
      '',
      `This link expires in ${expiresInMinutes} minutes and can only be used once.`,
      '',
      'If this was not you, no action is needed — your password has not changed.'
    ].join('\n'),
    sms: `Reset your Aegis ID password: ${resetUrl}`
  }),
  'email-verification': ({ verifyUrl, expiresInHours, displayName }) => ({
    subject: 'Confirm your Aegis ID email address',
    text: [
      `${displayName ? `Hello ${displayName},` : 'Hello,'}`,
      '',
      'Confirm this address to finish setting up your Aegis ID account:',
      '',
      verifyUrl,
      '',
      `This link expires in ${expiresInHours} hours and can only be used once.`,
      '',
      'If you did not create an account, you can ignore this message.'
    ].join('\n'),
    sms: `Confirm your Aegis ID email: ${verifyUrl}`
  }),
  'account-reenrolment': ({ reenrolUrl, expiresInMinutes, displayName }) => ({
    subject: 'Set up a new passkey for your Aegis ID account',
    text: [
      `${displayName ? `Hello ${displayName},` : 'Hello,'}`,
      '',
      'An administrator has authorised you to register a new passkey, because',
      'you no longer have your old one or any recovery codes.',
      '',
      reenrolUrl,
      '',
      `This link expires in ${expiresInMinutes} minutes and can only be used once.`,
      '',
      'If you did not ask for this, tell your administrator immediately —',
      'someone may be trying to take over your account.'
    ].join('\n'),
    sms: `Set up a new Aegis ID passkey: ${reenrolUrl}`
  }),
  'wallet-recovery': ({ code, walletId }) => ({
    subject: 'Your Aegis ID wallet recovery code',
    text: [
      `Your Aegis ID verification code is ${code}.`,
      '',
      `Wallet: ${walletId}`,
      'This code expires in 10 minutes and can only be used once.',
      '',
      'If you did not request this, someone may be attempting to recover your wallet.',
      'Contact your organization administrator immediately.'
    ].join('\n'),
    sms: `Aegis ID verification code: ${code}`
  })
};

async function recordDelivery(entry) {
  const log = await logStore.read();
  log.unshift(entry);
  await logStore.write(log.slice(0, LOG_LIMIT));
}

/**
 * Send one message over every channel its type permits and that has a
 * recipient. Returns { delivered, channels, failures } — never the message
 * body, and never the code.
 */
async function deliverMessage({ type, email, phone, variables = {}, context = {} }) {
  const template = TEMPLATES[type];
  if (!template) {
    throw new Error(`Unknown message type: ${type}`);
  }

  const settings = await getNotificationSettings();
  const { subject, text, sms } = template(variables);
  const channels = [];
  const failures = [];

  if (email && channelAllowed(settings, type, 'email')) {
    try {
      const result = await sendEmail(settings, { to: email, subject, text });
      if (result.delivered) {
        channels.push({ channel: 'email', to: result.to });
      } else {
        failures.push({ channel: 'email', message: result.reason });
      }
    } catch (error) {
      failures.push({ channel: 'email', message: error.message });
    }
  }

  if (phone && channelAllowed(settings, type, 'sms')) {
    try {
      const result = await sendSms(settings, { to: phone, body: sms });
      if (result.delivered) {
        channels.push({ channel: 'sms', to: result.to });
      } else {
        failures.push({ channel: 'sms', message: result.reason });
      }
    } catch (error) {
      failures.push({ channel: 'sms', message: error.message });
    }
  }

  const delivered = channels.length > 0;
  const recipient = maskRecipient(email || phone || '');

  await recordDelivery({
    at: new Date().toISOString(),
    type,
    delivered,
    recipient,
    channels: channels.map((entry) => entry.channel),
    failures: failures.map((entry) => `${entry.channel}: ${entry.message}`),
    ...context
  });

  await writeAuditEvent('notification.dispatched', {
    messageType: type,
    delivered,
    channels: channels.map((entry) => entry.channel),
    failures: failures.map((entry) => `${entry.channel}: ${entry.message}`),
    recipient,
    ...context
  });

  return { delivered, channels, failures };
}

/**
 * Deliver a wallet recovery code. Fails closed: if nothing was sent the caller
 * must not proceed, because the code cannot reach its owner.
 */
async function deliverRecoveryCode({ code, walletId, email, phone }) {
  const result = await deliverMessage({
    type: 'wallet-recovery',
    email,
    phone,
    variables: { code, walletId },
    context: { walletId }
  });

  if (!result.delivered) {
    const error = new Error(
      'No delivery channel is configured, so a verification code could not be sent. ' +
        'Ask a platform administrator to configure email or SMS delivery.'
    );
    error.status = 503;
    error.expose = true;
    throw error;
  }

  return result;
}

async function listDeliveryLog(limit = 50) {
  const log = await logStore.read();
  return log.slice(0, limit);
}

module.exports = { deliverMessage, deliverRecoveryCode, listDeliveryLog };
