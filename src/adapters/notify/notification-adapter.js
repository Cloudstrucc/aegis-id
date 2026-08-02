// Delivery adapters for one-time codes and wallet notices.
//
// Email uses nodemailer over SMTP, which covers Microsoft 365 / Exchange Online,
// Gmail / Google Workspace, and any on-premises relay. SMS posts JSON to a
// configured endpoint so Twilio or any other provider can be used without
// binding the platform to one vendor.
//
// When a channel is disabled the adapter reports `delivered: false` rather than
// throwing, so the caller decides whether that is fatal. For local development
// choose the "filesystem" preset, which writes messages to disk instead of
// sending them — codes are never echoed back in a response.

const fs = require('node:fs/promises');
const path = require('node:path');
const nodemailer = require('nodemailer');

const config = require('../../config');

/**
 * Write a message to disk instead of sending it. This is what makes local
 * development testable without an SMTP account or an SMS provider, and it is
 * what the end-to-end journey asserts against. Selected per channel by choosing
 * the "filesystem" preset.
 */
async function dropToFilesystem(channel, message) {
  const dir = config.paths.mailDrop;
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}-${channel}.txt`);
  const lines = [
    `Channel: ${channel}`,
    `To: ${message.to}`,
    message.subject ? `Subject: ${message.subject}` : null,
    `Sent: ${new Date().toISOString()}`,
    '',
    message.text || message.body || ''
  ].filter((line) => line !== null);
  await fs.writeFile(file, lines.join('\n'), 'utf8');
  return { delivered: true, channel, to: maskRecipient(message.to), file };
}

function maskRecipient(value = '') {
  const raw = String(value);
  if (raw.includes('@')) {
    const [user, domain] = raw.split('@');
    return `${user.slice(0, 2)}***@${domain}`;
  }
  return raw.length > 4 ? `***${raw.slice(-4)}` : '***';
}

async function sendEmail(settings, { to, subject, text, html }) {
  const email = settings.email || {};
  if (!email.enabled) {
    return { delivered: false, reason: 'email-disabled' };
  }
  if (email.preset === 'filesystem') {
    return dropToFilesystem('email', { to, subject, text });
  }
  if (!email.host || !email.fromAddress) {
    return { delivered: false, reason: 'email-not-configured' };
  }

  const transport = nodemailer.createTransport({
    host: email.host,
    port: email.port || 587,
    secure: Boolean(email.secure), // false = STARTTLS on 587, which Exchange and Gmail expect
    requireTLS: email.requireTls !== false,
    auth: email.username ? { user: email.username, pass: email.password } : undefined
  });

  await transport.sendMail({
    from: email.fromName ? `"${email.fromName}" <${email.fromAddress}>` : email.fromAddress,
    to,
    subject,
    text,
    html
  });

  return { delivered: true, channel: 'email', to: maskRecipient(to) };
}

async function sendSms(settings, { to, body }) {
  const sms = settings.sms || {};
  if (!sms.enabled) {
    return { delivered: false, reason: 'sms-disabled' };
  }
  if (sms.preset === 'filesystem') {
    return dropToFilesystem('sms', { to, body });
  }
  if (!sms.endpoint) {
    return { delivered: false, reason: 'sms-not-configured' };
  }

  const endpoint = sms.endpoint.replace('{accountSid}', encodeURIComponent(sms.accountSid || ''));
  const headers = { 'Content-Type': 'application/json' };
  if (sms.accountSid && sms.authToken) {
    const basic = Buffer.from(`${sms.accountSid}:${sms.authToken}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  } else if (sms.authToken) {
    headers.Authorization = `Bearer ${sms.authToken}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ To: to, From: sms.fromNumber, Body: body }),
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(`SMS provider rejected the request (${response.status}).`);
    error.details = detail.slice(0, 300);
    throw error;
  }

  return { delivered: true, channel: 'sms', to: maskRecipient(to) };
}

// Verify credentials without sending anything, for the "Test connection" button.
async function verifyEmail(settings) {
  const email = settings.email || {};
  if (email.preset === 'filesystem') {
    return { ok: true, detail: `Messages are written to ${config.paths.mailDrop}` };
  }
  if (!email.host) {
    throw new Error('An SMTP host is required.');
  }
  const transport = nodemailer.createTransport({
    host: email.host,
    port: email.port || 587,
    secure: Boolean(email.secure),
    requireTLS: email.requireTls !== false,
    auth: email.username ? { user: email.username, pass: email.password } : undefined
  });
  await transport.verify();
  return { ok: true };
}

module.exports = { maskRecipient, sendEmail, sendSms, verifyEmail };
