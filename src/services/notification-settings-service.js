// Notification delivery settings, editable by platform admins in the dashboard.
//
// Secrets are stored here but never returned to the UI in cleartext — the
// settings reader masks them, and a blank value on save means "keep existing".

const config = require('../config');
const FileJsonStore = require('./file-json-store');

const store = new FileJsonStore(config.paths.notificationSettings, {});

// Well-known SMTP hosts so admins do not have to look them up. "custom" leaves
// every field editable for on-prem or other providers.
const EMAIL_PRESETS = Object.freeze({
  'microsoft-exchange': {
    id: 'microsoft-exchange',
    label: 'Microsoft 365 / Exchange Online',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    requireTls: true,
    hint: 'Use an account with SMTP AUTH enabled, or an app password when MFA is on.'
  },
  gmail: {
    id: 'gmail',
    label: 'Gmail / Google Workspace',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    requireTls: true,
    hint: 'Google requires an App Password; a normal account password will be rejected.'
  },
  custom: {
    id: 'custom',
    label: 'Custom SMTP server',
    host: '',
    port: 587,
    secure: false,
    requireTls: true,
    hint: 'Any RFC-compliant SMTP relay, including on-premises Exchange.'
  }
});

const SMS_PRESETS = Object.freeze({
  twilio: {
    id: 'twilio',
    label: 'Twilio',
    endpoint: 'https://api.twilio.com/2010-04-01/Accounts/{accountSid}/Messages.json',
    hint: 'Account SID as the username, Auth Token as the password.'
  },
  'generic-http': {
    id: 'generic-http',
    label: 'Generic HTTP provider',
    endpoint: '',
    hint: 'Any provider that accepts a JSON POST. Use {to} and {body} placeholders.'
  }
});

function defaults() {
  return {
    email: {
      enabled: false,
      preset: 'microsoft-exchange',
      host: EMAIL_PRESETS['microsoft-exchange'].host,
      port: 587,
      secure: false,
      requireTls: true,
      username: '',
      password: '',
      fromAddress: '',
      fromName: 'Vanguard Aegis ID'
    },
    sms: {
      enabled: false,
      preset: 'twilio',
      endpoint: '',
      accountSid: '',
      authToken: '',
      fromNumber: ''
    },
    updatedAt: null,
    updatedBy: null
  };
}

function mergeDefaults(saved = {}) {
  const base = defaults();
  return {
    email: { ...base.email, ...(saved.email || {}) },
    sms: { ...base.sms, ...(saved.sms || {}) },
    updatedAt: saved.updatedAt || null,
    updatedBy: saved.updatedBy || null
  };
}

async function getNotificationSettings() {
  return mergeDefaults(await store.read());
}

// Masked view for rendering. Never leaks stored secrets to the browser.
async function getNotificationSettingsForDisplay() {
  const settings = await getNotificationSettings();
  return {
    ...settings,
    email: { ...settings.email, password: '', hasPassword: Boolean(settings.email.password) },
    sms: { ...settings.sms, authToken: '', hasAuthToken: Boolean(settings.sms.authToken) },
    emailPresets: Object.values(EMAIL_PRESETS),
    smsPresets: Object.values(SMS_PRESETS)
  };
}

function booleanField(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function text(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

async function updateNotificationSettings(input = {}, actorEmail = null) {
  const current = await getNotificationSettings();
  const emailPreset = EMAIL_PRESETS[input.emailPreset] || EMAIL_PRESETS.custom;
  const smsPreset = SMS_PRESETS[input.smsPreset] || SMS_PRESETS['generic-http'];

  const next = {
    email: {
      enabled: booleanField(input.emailEnabled),
      preset: emailPreset.id,
      // A preset supplies the host/port unless the admin chose "custom".
      host: emailPreset.id === 'custom' ? text(input.emailHost) : emailPreset.host,
      port: Number.parseInt(input.emailPort, 10) || emailPreset.port || 587,
      secure: booleanField(input.emailSecure),
      requireTls: true,
      username: text(input.emailUsername),
      // Blank means "keep the stored secret".
      password: text(input.emailPassword, 500) || current.email.password,
      fromAddress: text(input.emailFromAddress),
      fromName: text(input.emailFromName) || 'Vanguard Aegis ID'
    },
    sms: {
      enabled: booleanField(input.smsEnabled),
      preset: smsPreset.id,
      endpoint: text(input.smsEndpoint, 500) || smsPreset.endpoint,
      accountSid: text(input.smsAccountSid),
      authToken: text(input.smsAuthToken, 500) || current.sms.authToken,
      fromNumber: text(input.smsFromNumber, 40)
    },
    updatedAt: new Date().toISOString(),
    updatedBy: actorEmail
  };

  await store.write(next);
  return next;
}

module.exports = {
  EMAIL_PRESETS,
  SMS_PRESETS,
  getNotificationSettings,
  getNotificationSettingsForDisplay,
  updateNotificationSettings
};
