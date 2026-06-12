const config = require('../config');
const FileJsonStore = require('./file-json-store');

const store = new FileJsonStore(config.paths.audit, []);

const sensitiveKeys = new Set([
  'accessToken',
  'authorization',
  'clientSecret',
  'credential',
  'idToken',
  'privateKey',
  'rawCredential',
  'token'
]);

function redact(value) {
  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sensitiveKeys.has(key) ? '[redacted]' : redact(child)])
    );
  }

  return value;
}

async function writeAuditEvent(type, data = {}) {
  const event = {
    id: cryptoRandomId(),
    type,
    data: redact(data),
    createdAt: new Date().toISOString()
  };

  await store.append(event);
  return event;
}

function cryptoRandomId() {
  return require('node:crypto').randomUUID();
}

module.exports = { writeAuditEvent, redact };
