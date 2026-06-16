const crypto = require('node:crypto');

const config = require('../config');
const { sendWalletChallenge } = require('../adapters/aries/aries-lab-adapter');
const FileJsonStore = require('./file-json-store');
const { getIssuerOrganization } = require('./issuer-organization-service');

const store = new FileJsonStore(config.paths.walletChallenges, []);

function createId() {
  return crypto.randomUUID();
}

function createToken(byteLength = 18) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

function nowIso() {
  return new Date().toISOString();
}

function expiresAtIso(ttlSeconds = 900) {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

async function createExternalWalletChallenge(input = {}) {
  const appName = normalizeText(input.appName, 120) || 'External application';
  const appInstanceId = normalizeText(input.appInstanceId, 120) || normalizeSlug(appName);
  const subject = normalizeText(input.subject, 180);
  const action = normalizeAction(input.action);
  const challengeType = normalizeText(input.challengeType, 80) || 'external-action';
  const resourceType = normalizeText(input.resourceType, 80);
  const resourceId = normalizeText(input.resourceId, 120);
  const payload = normalizePayload(input.payload);

  if (!subject) {
    throw validationError('Wallet challenge subject is required.');
  }

  const issuerOrganization = input.organizationId ? await getIssuerOrganization(input.organizationId) : null;
  if (input.organizationId && !issuerOrganization) {
    const error = validationError('Selected organization is not connected to a wallet issuer connection yet.');
    error.status = 409;
    error.details = {
      hint: 'Create an org issuer invitation from the Aegis ID dashboard, accept it in the iOS wallet, then retry.'
    };
    throw error;
  }

  const connectionId = issuerOrganization?.issuerConnectionId || normalizeText(input.connectionId, 120);
  if (!connectionId) {
    const error = validationError('A wallet issuer connection is required for this organization.');
    error.status = 409;
    error.details = {
      hint: 'Set AEGIS_ORGANIZATION_ID to a connected organization or provide AEGIS_ISSUER_CONNECTION_ID.'
    };
    throw error;
  }

  const nonce = createToken();
  const createdAt = nowIso();
  const baseRecord = {
    id: createId(),
    nonce,
    status: 'sent',
    source: 'external-app',
    challengeType,
    appName,
    appInstanceId,
    organizationId: issuerOrganization?.organizationId || normalizeText(input.organizationId, 120) || null,
    organizationName: issuerOrganization?.organizationName || normalizeText(input.organizationName, 160) || 'Vanguard Aegis ID',
    connectionId,
    subject,
    action,
    resourceType,
    resourceId,
    payload,
    payloadFields: payloadToFields(payload),
    threadId: null,
    delivery: {
      status: 'pending'
    },
    returnUrl: normalizeText(input.returnUrl, 500),
    createdAt,
    sentAt: createdAt,
    expiresAt: expiresAtIso(Number.parseInt(input.ttlSeconds || '900', 10) || 900)
  };

  let delivery = baseRecord.delivery;
  let threadId = null;
  try {
    const sent = await sendWalletChallenge('issuer', {
      connectionId,
      comment: `${appName} ${action} challenge ${nonce}`,
      content: buildChallengeContent(baseRecord)
    });
    delivery = {
      status: 'didcomm-sent',
      agent: sent.agent,
      connectionId: sent.connectionId
    };
    threadId = sent.ping?.thread_id || null;
  } catch (error) {
    delivery = {
      status: 'api-pending',
      error: error.hint || error.message
    };
  }

  const record = {
    ...baseRecord,
    threadId,
    delivery
  };
  await store.append(record);
  return decorateChallenge(record);
}

async function getWalletChallenge(challengeId) {
  const record = (await store.read()).find((candidate) => candidate.id === challengeId);
  if (!record) {
    throw notFound('Wallet challenge not found.');
  }
  return decorateChallenge(record);
}

async function acceptExternalWalletChallenge(challengeId, input = {}) {
  const records = await store.read();
  const index = records.findIndex((candidate) => candidate.id === challengeId);
  if (index === -1) {
    throw notFound('Wallet challenge not found.');
  }
  if (records[index].status === 'accepted') {
    return decorateChallenge(records[index]);
  }

  records[index] = {
    ...records[index],
    status: 'accepted',
    acceptedAt: nowIso(),
    acceptedBy: normalizeText(input.acceptedBy, 180) || records[index].subject,
    acceptanceSource: normalizeText(input.source, 80) || 'wallet-api',
    updatedAt: nowIso()
  };
  await store.write(records);
  return decorateChallenge(records[index]);
}

async function listPendingExternalWalletChallenges(connectionId) {
  const records = await store.read();
  return records
    .filter((record) => {
      if (record.status !== 'sent') {
        return false;
      }
      if (connectionId && record.connectionId !== connectionId) {
        return false;
      }
      return new Date(record.expiresAt).getTime() >= Date.now();
    })
    .sort((left, right) => new Date(right.sentAt).getTime() - new Date(left.sentAt).getTime())
    .map(decorateChallenge);
}

async function listWalletChallengeLedger(filters = {}) {
  const records = await store.read();
  const organizationId = normalizeText(filters.organizationId, 120);
  const appInstanceId = normalizeText(filters.appInstanceId, 120);
  const limit = Math.min(Number.parseInt(filters.limit || '100', 10) || 100, 500);

  return records
    .filter((record) => {
      if (organizationId && record.organizationId !== organizationId) {
        return false;
      }
      if (appInstanceId && record.appInstanceId !== appInstanceId) {
        return false;
      }
      return true;
    })
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit)
    .map(decorateChallenge);
}

function decorateChallenge(record) {
  return {
    ...record,
    sessionId: record.id,
    challengeId: record.id,
    title: `${record.appName}: ${actionLabel(record.action)}`,
    detail: buildChallengeDetail(record),
    acceptPath: `/api/wallet-challenges/${record.id}/accept`,
    payloadFields: record.payloadFields || payloadToFields(record.payload)
  };
}

function buildChallengeContent(record) {
  return [
    `${record.appName} high-assurance wallet challenge`,
    `challengeId=${record.id}`,
    `nonce=${record.nonce}`,
    `subject=${record.subject}`,
    `action=${record.action}`,
    `resourceType=${record.resourceType || 'n/a'}`,
    `resourceId=${record.resourceId || 'n/a'}`,
    `timestamp=${record.createdAt}`,
    'Payload:',
    JSON.stringify(record.payload, null, 2),
    'Accept this in Vanguard Aegis ID Wallet to sign the decision.'
  ].join('\n');
}

function buildChallengeDetail(record) {
  const resource = record.resourceType && record.resourceId ? `${record.resourceType} ${record.resourceId}` : 'session';
  return `${record.subject} must ${record.action} ${resource}. Nonce ${record.nonce}.`;
}

function payloadToFields(payload = {}) {
  return Object.entries(flattenPayload(payload)).map(([key, value]) => ({
    key,
    value: String(value)
  }));
}

function flattenPayload(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? { [prefix]: String(value ?? '') } : {};
  }

  return Object.entries(value).reduce((result, [key, child]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      return { ...result, ...flattenPayload(child, nextKey) };
    }
    return {
      ...result,
      [nextKey]: Array.isArray(child) ? child.join(', ') : String(child ?? '')
    };
  }, {});
}

function normalizePayload(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeAction(value = '') {
  return normalizeSlug(value || 'sign');
}

function normalizeSlug(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function actionLabel(action) {
  return String(action || 'sign')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeText(value = '', max = 400) {
  return String(value || '').trim().slice(0, max);
}

function validationError(message) {
  const error = new Error(message);
  error.status = 422;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

module.exports = {
  acceptExternalWalletChallenge,
  createExternalWalletChallenge,
  getWalletChallenge,
  listPendingExternalWalletChallenges,
  listWalletChallengeLedger
};
