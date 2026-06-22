const config = require('../config');
const { getAriesStatus } = require('../adapters/aries/aries-lab-adapter');
const { listAuditEvents } = require('./audit-service');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function getHealthDashboard() {
  const checkedAt = new Date();
  const [ariesStatus, auditEvents] = await Promise.all([
    safeAriesStatus(),
    listAuditEvents().catch(() => [])
  ]);
  const since = checkedAt.getTime() - ONE_DAY_MS;
  const ariesChecks = ariesStatus.checks.map(decorateAriesCheck);
  const serviceChecks = [
    decorateVerifiedIdCheck(),
    ...ariesChecks
  ];
  const recentEvents = auditEvents
    .filter((event) => Date.parse(event.createdAt || 0) >= since)
    .slice(0, 80)
    .map(decorateAuditEvent);

  return {
    ok: serviceChecks.every((check) => check.ok),
    checkedAt: checkedAt.toISOString(),
    checkedAtLabel: checkedAt.toLocaleString('en-CA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'America/Toronto'
    }),
    verifiedIdMode: config.verifiedId.mode,
    serviceChecks,
    recentEvents,
    hasRecentEvents: recentEvents.length > 0,
    summary: {
      healthy: serviceChecks.filter((check) => check.ok).length,
      total: serviceChecks.length,
      logs: recentEvents.length
    }
  };
}

async function safeAriesStatus() {
  try {
    return await getAriesStatus();
  } catch (error) {
    return {
      track: 'aries-interoperability-lab',
      checks: [
        {
          name: 'aries',
          ok: false,
          error: error.name || 'Error',
          message: error.message || 'Unable to collect Aries status.'
        }
      ]
    };
  }
}

function decorateVerifiedIdCheck() {
  const liveConfigured = Boolean(
    config.verifiedId.mode === 'live' &&
      config.verifiedId.tenantId &&
      config.verifiedId.clientId &&
      config.verifiedId.authorityDid &&
      config.verifiedId.manifestUrl
  );
  const mockMode = config.verifiedId.mode !== 'live';
  return {
    name: 'verified-id',
    label: 'Verified ID integration',
    category: 'Core assurance',
    endpoint: config.verifiedId.mode,
    ok: mockMode || liveConfigured,
    statusLabel: mockMode ? 'Mock mode' : liveConfigured ? 'Configured' : 'Needs configuration',
    message: mockMode
      ? 'Running with local mock credential request handling.'
      : liveConfigured
        ? 'Tenant, client, authority DID, and credential manifest are configured.'
        : 'Live mode is enabled, but one or more Verified ID integration settings are missing.',
    badgeClass: mockMode || liveConfigured ? 'ok' : 'warn'
  };
}

function decorateAriesCheck(check) {
  const name = check.name || 'agent';
  return {
    name,
    label: titleCase(name),
    category: 'Aries lab',
    endpoint: check.baseUrl || 'Not configured',
    ok: Boolean(check.ok),
    statusLabel: check.ok ? `HTTP ${check.status || 200}` : check.error || 'Unavailable',
    message: check.ok
      ? 'ACA-Py admin endpoint responded to the live status probe.'
      : check.hint || check.message || 'ACA-Py admin endpoint is not responding.',
    badgeClass: check.ok ? 'ok' : 'down'
  };
}

function decorateAuditEvent(event) {
  const createdAt = event.createdAt ? new Date(event.createdAt) : null;
  return {
    id: event.id,
    type: event.type || 'event',
    createdAt: event.createdAt || '',
    createdAtLabel: createdAt && !Number.isNaN(createdAt.getTime())
      ? createdAt.toLocaleString('en-CA', {
        dateStyle: 'medium',
        timeStyle: 'medium',
        timeZone: 'America/Toronto'
      })
      : 'Unknown',
    summary: summarizeEvent(event),
    details: JSON.stringify(event.data || {}, null, 2)
  };
}

function summarizeEvent(event) {
  const data = event.data || {};
  return [
    data.organizationName,
    data.workspaceId,
    data.holderEmail,
    data.transactionId,
    data.credentialId,
    data.state
  ].filter(Boolean).slice(0, 2).join(' · ') || 'System event';
}

function titleCase(value) {
  return String(value)
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

module.exports = { getHealthDashboard };
