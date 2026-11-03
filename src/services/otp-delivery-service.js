// Outbound message delivery for one-time codes, reset links and wallet notices.
//
// Every message the platform sends to a person goes through deliverMessage, so
// there is one place that decides which channels a given kind of message may
// use, one audit trail, and one delivery log an admin can read.
//
// Codes are never returned to the caller. For local development configure the
// "filesystem" preset, which writes messages to disk instead of sending them.
//
// Wording lives in src/emails, one catalogue per supported locale, and is
// rendered to HTML, plain text and SMS from a single block list so the parts
// cannot drift. The locale is decided by the caller — it is a property of the
// recipient, and only the caller knows who they are.

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { channelAllowed, getNotificationSettings } = require('./notification-settings-service');
const { sendEmail, sendSms, maskRecipient } = require('../adapters/notify/notification-adapter');
const { writeAuditEvent } = require('./audit-service');
const { normalizeBranding, platformBaseUrl } = require('./site-context-service');
const { DEFAULT_LOCALE } = require('./i18n-service');
const { buildMessage, messageTypes } = require('../emails');

const logStore = new FileJsonStore(config.paths.notificationLog, []);
const LOG_LIMIT = 200;

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
async function deliverMessage({ type, email, phone, locale, variables = {}, context = {} }) {
  const settings = await getNotificationSettings();
  // Every message names the product. On the platform that is "Aegis ID"; a
  // message sent on an organization's behalf carries its own name via
  // context.branding, so a Contoso holder's code arrives from Contoso.
  const branding = normalizeBranding(context.branding || {});
  const message = buildMessage({
    type,
    locale: locale || DEFAULT_LOCALE,
    variables,
    brand: branding.shortName,
    // Absolute, because the lockup in the message is fetched by the reader's
    // mail client and a relative path would resolve against nothing.
    baseUrl: context.baseUrl || platformBaseUrl(),
    // Named in the footer only when the message really is on somebody's
    // behalf. A caller that passes no branding at all gets the platform
    // defaults back, whose displayName is the brand itself — so the test is
    // "did a caller supply one", not "is this the platform".
    organizationName: context.branding?.displayName ? branding.displayName : '',
    supportEmail: branding.supportEmail
  });
  const { subject, text, html, sms } = message;
  const channels = [];
  const failures = [];

  if (email && channelAllowed(settings, type, 'email')) {
    try {
      const result = await sendEmail(settings, { to: email, subject, text, html, locale: message.locale });
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
    locale: message.locale,
    delivered,
    recipient,
    channels: channels.map((entry) => entry.channel),
    failures: failures.map((entry) => `${entry.channel}: ${entry.message}`),
    ...context
  });

  await writeAuditEvent('notification.dispatched', {
    messageType: type,
    locale: message.locale,
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
async function deliverRecoveryCode({ code, walletId, email, phone, locale }) {
  const result = await deliverMessage({
    type: 'wallet-recovery',
    email,
    phone,
    locale,
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

module.exports = { deliverMessage, deliverRecoveryCode, listDeliveryLog, messageTypes };
