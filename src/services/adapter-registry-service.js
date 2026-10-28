// Authentication adapter registry.
//
// One place that knows every adapter kind, holds the configured instances, and
// enforces the rules that matter: an instance that does not validate is never
// activated (deny-by-default), and every create / update / delete / self-test is
// written to the evidence chain. The protocol logic lives in the adapter modules
// under ./adapters; this service is the catalogue + persistence + policy around
// them.

const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { writeAuditEvent } = require('./audit-service');
const { adapterError, normalizeText } = require('./adapters/adapter-interface');

const samlAdapter = require('./adapters/saml-adapter');
const kerberosAdapter = require('./adapters/kerberos-adapter');
const cbaAdapter = require('./adapters/cba-adapter');

const store = new FileJsonStore(config.paths.authAdapters, []);

// The catalogue. Provider presets (Entra, Okta…) will register here later as
// thin wrappers over these protocol adapters.
const CATALOG = {
  [samlAdapter.describe().kind]: samlAdapter,
  [kerberosAdapter.describe().kind]: kerberosAdapter,
  [cbaAdapter.describe().kind]: cbaAdapter
};

function isEnabled() {
  return Boolean(config.authAdapters?.enabled);
}

function getAdapter(kind) {
  const adapter = CATALOG[normalizeText(kind, 40)];
  if (!adapter) {
    throw adapterError(`Unknown adapter kind: ${kind}`, 400);
  }
  return adapter;
}

/** Static catalogue for the config UI. */
function listCatalog() {
  return Object.values(CATALOG).map((adapter) => ({
    ...adapter.describe(),
    schema: adapter.configSchema()
  }));
}

async function listInstances() {
  const records = await store.read();
  return records.map(decorate);
}

async function getInstance(id) {
  const records = await store.read();
  const record = records.find((entry) => entry.id === normalizeText(id, 120));
  if (!record) {
    throw adapterError('Adapter instance not found.', 404);
  }
  return record;
}

async function getDecoratedInstance(id) {
  return decorate(await getInstance(id));
}

function decorate(record) {
  const adapter = CATALOG[record.kind];
  const describe = adapter ? adapter.describe() : { name: record.kind };
  return {
    ...record,
    config: redactConfig(record.config),
    catalog: describe,
    isActive: record.status === 'active'
  };
}

/** Certs and trust anchors are public; defensively mask anything key-shaped. */
function redactConfig(config = {}) {
  const out = {};
  for (const [key, value] of Object.entries(config || {})) {
    if (typeof value === 'string' && /-----BEGIN (RSA |EC )?PRIVATE KEY-----/.test(value)) {
      out[key] = '[redacted]';
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function createInstance({ kind, name, config: rawConfig, actorEmail }) {
  const adapter = getAdapter(kind);
  const normalizedConfig = adapter.normalizeConfig(rawConfig || {});
  const problems = adapter.validateConfig(normalizedConfig);
  const now = new Date().toISOString();
  const record = {
    id: `adp_${crypto.randomUUID()}`,
    kind: adapter.describe().kind,
    name: normalizeText(name, 160) || adapter.describe().name,
    // Deny-by-default: a configuration that does not validate is parked as a
    // draft and cannot be used to authenticate anyone.
    status: problems.length ? 'draft' : 'active',
    firstFactor: true,
    satisfiesSecond: false,
    // At most one adapter fronts connected-app sign-in; set explicitly.
    defaultForSignIn: false,
    config: normalizedConfig,
    createdAt: now,
    updatedAt: now,
    createdBy: normalizeText(actorEmail, 320),
    lastTest: null
  };
  await store.append(record);
  await writeAuditEvent('admin.auth-adapter.created', {
    actorEmail, adapterId: record.id, kind: record.kind, status: record.status
  });
  return { record: decorate(record), problems };
}

async function updateInstance(id, patch = {}) {
  const records = await store.read();
  const index = records.findIndex((entry) => entry.id === normalizeText(id, 120));
  if (index === -1) {
    throw adapterError('Adapter instance not found.', 404);
  }
  const existing = records[index];
  const adapter = getAdapter(existing.kind);

  const nextConfig = patch.config
    ? adapter.normalizeConfig({ ...existing.config, ...patch.config })
    : existing.config;
  const problems = adapter.validateConfig(nextConfig);

  let status = existing.status;
  if (patch.status === 'disabled') {
    status = 'disabled';
  } else if (patch.status === 'active' || patch.config) {
    // Re-validate on any activation or config change.
    status = problems.length ? 'draft' : 'active';
  }

  records[index] = {
    ...existing,
    name: patch.name !== undefined ? normalizeText(patch.name, 160) || existing.name : existing.name,
    config: nextConfig,
    status,
    firstFactor: patch.firstFactor !== undefined ? Boolean(patch.firstFactor) : existing.firstFactor,
    satisfiesSecond: patch.satisfiesSecond !== undefined ? Boolean(patch.satisfiesSecond) : existing.satisfiesSecond,
    updatedAt: new Date().toISOString()
  };
  await store.write(records);
  await writeAuditEvent('admin.auth-adapter.updated', {
    actorEmail: patch.actorEmail, adapterId: id, kind: existing.kind, status
  });
  return { record: decorate(records[index]), problems };
}

async function deleteInstance(id, { actorEmail } = {}) {
  const records = await store.read();
  const record = records.find((entry) => entry.id === normalizeText(id, 120));
  if (!record) {
    throw adapterError('Adapter instance not found.', 404);
  }
  await store.write(records.filter((entry) => entry.id !== record.id));
  await writeAuditEvent('admin.auth-adapter.deleted', {
    actorEmail, adapterId: id, kind: record.kind
  });
  return { ok: true };
}

/**
 * Run an adapter's self-test against supplied sample input, persist a compact
 * result (no claim PII), and return the full result (claims included) to the
 * caller for display.
 */
async function runSelfTest(id, sample = {}, { actorEmail } = {}) {
  const record = await getInstance(id);
  const adapter = getAdapter(record.kind);
  let result;
  try {
    result = await adapter.test({ instance: record, sample });
  } catch (error) {
    result = { ok: false, title: 'Test failed', detail: error.message };
  }

  const records = await store.read();
  const index = records.findIndex((entry) => entry.id === record.id);
  if (index !== -1) {
    records[index].lastTest = {
      ok: Boolean(result.ok),
      title: result.title || null,
      detail: result.detail || null,
      at: new Date().toISOString()
    };
    // A passing live test on a draft that now validates promotes it to active.
    if (result.ok && records[index].status === 'draft' && !adapter.validateConfig(records[index].config).length) {
      records[index].status = 'active';
    }
    await store.write(records);
  }
  await writeAuditEvent('admin.auth-adapter.tested', {
    actorEmail, adapterId: id, kind: record.kind, ok: Boolean(result.ok)
  });
  return result;
}

/**
 * Designate one active adapter as the connected-app sign-in default, clearing
 * any previous one. Only an active, first-factor adapter may be chosen — a draft
 * or disabled adapter could not authenticate anyone (deny-by-default). Passing an
 * empty id clears the default.
 */
async function setDefaultSignInAdapter(id, { actorEmail } = {}) {
  const records = await store.read();
  const targetId = normalizeText(id, 120);
  if (targetId) {
    const target = records.find((entry) => entry.id === targetId);
    if (!target) {
      throw adapterError('Adapter instance not found.', 404);
    }
    if (target.status !== 'active' || !target.firstFactor) {
      throw adapterError('Only an active, first-factor adapter can front connected-app sign-in.', 422);
    }
  }
  for (const entry of records) {
    entry.defaultForSignIn = entry.id === targetId;
  }
  await store.write(records);
  await writeAuditEvent('admin.auth-adapter.set-default', { actorEmail, adapterId: targetId || null });
  return { ok: true };
}

/** The active adapter that fronts connected-app sign-in, or null. Raw (with config). */
async function getDefaultSignInAdapter() {
  if (!isEnabled()) {
    return null;
  }
  const records = await store.read();
  return records.find((entry) => entry.defaultForSignIn && entry.status === 'active' && entry.firstFactor) || null;
}

module.exports = {
  isEnabled,
  getAdapter,
  listCatalog,
  listInstances,
  getInstance,
  getDecoratedInstance,
  createInstance,
  updateInstance,
  deleteInstance,
  runSelfTest,
  setDefaultSignInAdapter,
  getDefaultSignInAdapter,
  redactConfig
};
