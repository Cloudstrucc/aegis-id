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
const MailComposer = require('nodemailer/lib/mail-composer');

const config = require('../../config');

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';

// One token per application, reused until it is nearly expired. Asking for a
// new one on every message would make a sign-in code wait on a second round
// trip to a second service, and Entra rate-limits the endpoint.
const tokenCache = new Map();

async function graphToken(email) {
  const key = `${email.tenantId}:${email.clientId}`;
  const cached = tokenCache.get(key);
  // Sixty seconds of headroom, so a token cannot expire between being handed
  // out and being used.
  if (cached && cached.expiresAt - 60_000 > Date.now()) {
    return cached.value;
  }

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(email.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: email.clientId,
        client_secret: email.clientSecret,
        scope: GRAPH_SCOPE,
        grant_type: 'client_credentials'
      }),
      signal: AbortSignal.timeout(10000)
    }
  );

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    // Entra's own description, which names the real cause — a wrong secret, a
    // secret that has expired, an unconsented permission. Never the secret.
    const detail = String(body.error_description || body.error || response.status).slice(0, 300);
    throw new Error(`Microsoft Graph refused the client credentials: ${detail}`);
  }

  tokenCache.set(key, {
    value: body.access_token,
    expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000
  });
  return body.access_token;
}

/**
 * Send through Microsoft Graph as the application, not as a signed-in user.
 *
 * The message is posted as raw MIME rather than as a Graph message resource,
 * because a message resource carries one body and ours have two — the plain
 * text part is what a text-only client, a screen reader in plain-text mode and
 * most spam filters read. MailComposer builds the multipart/alternative, and
 * nodemailer is already a dependency, so this adds nothing to install.
 */
async function sendViaGraph(email, { to, subject, text, html }) {
  const token = await graphToken(email);

  const mime = await new MailComposer({
    from: email.fromName ? `"${email.fromName}" <${email.fromAddress}>` : email.fromAddress,
    to,
    subject,
    text,
    html
  })
    .compile()
    .build();

  const response = await fetch(
    `${GRAPH_ROOT}/users/${encodeURIComponent(email.fromAddress)}/sendMail`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      body: mime.toString('base64'),
      signal: AbortSignal.timeout(15000)
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(`Microsoft Graph rejected the message (${response.status}).`);
    // 403 here almost always means the ApplicationAccessPolicy does not cover
    // this mailbox, which is the one failure that looks like a permissions bug
    // and is actually a scoping one.
    error.details = detail.slice(0, 300);
    throw error;
  }

  return { delivered: true, channel: 'email', to: maskRecipient(to) };
}

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
    message.locale ? `Locale: ${message.locale}` : null,
    `Sent: ${new Date().toISOString()}`,
    '',
    message.text || message.body || ''
  ].filter((line) => line !== null);
  await fs.writeFile(file, lines.join('\n'), 'utf8');

  // The HTML part, openable in a browser. Without it the only way to see
  // what a rendered message actually looks like is to send one, which
  // locally is the thing this preset exists to avoid.
  //
  // In its own directory, not in the drop: everything that reads the drop
  // treats it as one file per message — the delivery tests count the entries
  // and the end-to-end harness reads them all — so a second file there
  // doubles every count, and a subdirectory makes readFile throw EISDIR.
  let htmlFile = null;
  if (message.html) {
    const htmlDir = config.paths.mailHtmlDrop;
    await fs.mkdir(htmlDir, { recursive: true });
    htmlFile = path.join(htmlDir, `${stamp}-${channel}.html`);
    await fs.writeFile(htmlFile, message.html, 'utf8');
  }

  return { delivered: true, channel, to: maskRecipient(message.to), file, htmlFile };
}

function maskRecipient(value = '') {
  const raw = String(value);
  if (raw.includes('@')) {
    const [user, domain] = raw.split('@');
    return `${user.slice(0, 2)}***@${domain}`;
  }
  return raw.length > 4 ? `***${raw.slice(-4)}` : '***';
}

async function sendEmail(settings, { to, subject, text, html, locale }) {
  const email = settings.email || {};
  if (!email.enabled) {
    return { delivered: false, reason: 'email-disabled' };
  }
  if (email.preset === 'filesystem') {
    return dropToFilesystem('email', { to, subject, text, html, locale });
  }
  if (email.preset === 'microsoft-graph') {
    if (!email.tenantId || !email.clientId || !email.clientSecret || !email.fromAddress) {
      return { delivered: false, reason: 'email-not-configured' };
    }
    return sendViaGraph(email, { to, subject, text, html });
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
  if (email.preset === 'microsoft-graph') {
    // Acquiring a token is the whole of what can be checked without sending.
    // Reading the mailbox back would need User.Read.All, and granting a wider
    // permission so that a test button can be more confident is the wrong
    // trade — Mail.Send alone is the point of this route.
    await graphToken(email);
    return {
      ok: true,
      detail: `Microsoft Graph accepted the application credentials. Messages will be sent as ${email.fromAddress}.`
    };
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
