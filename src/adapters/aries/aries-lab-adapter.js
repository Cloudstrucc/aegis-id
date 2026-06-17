const config = require('../../config');
const QRCode = require('qrcode');

const endpoints = {
  holder: config.aries.holderAdminUrl,
  issuer: config.aries.issuerAdminUrl,
  verifier: config.aries.verifierAdminUrl,
  mediator: config.aries.mediatorAdminUrl
};

const adminApiKeys = {
  holder: config.aries.holderAdminApiKey,
  issuer: config.aries.issuerAdminApiKey,
  verifier: config.aries.verifierAdminApiKey,
  mediator: config.aries.mediatorAdminApiKey
};

const invitationAgents = {
  issuer: {
    baseUrl: endpoints.issuer,
    label: 'Vanguard Aries Issuer'
  },
  verifier: {
    baseUrl: endpoints.verifier,
    label: 'Vanguard Aries Verifier'
  }
};

async function getAriesStatus() {
  const checks = await Promise.all(
    Object.entries(endpoints).map(async ([name, baseUrl]) => {
      try {
        const response = await fetch(`${baseUrl}/status/live`, {
          headers: adminHeaders(name),
          signal: AbortSignal.timeout(1500)
        });
        return {
          name,
          baseUrl,
          ok: response.ok,
          status: response.status
        };
      } catch (error) {
        return {
          name,
          baseUrl,
          ok: false,
          ...describeConnectionError(error, baseUrl)
        };
      }
    })
  );

  return {
    track: 'aries-interoperability-lab',
    checks
  };
}

async function createOutOfBandInvitation(agentName = 'issuer', options = {}) {
  const agent = invitationAgents[agentName];
  if (!agent) {
    const error = new Error(`Unknown Aries invitation agent: ${agentName}`);
    error.status = 400;
    throw error;
  }

  const payload = {
    handshake_protocols: ['https://didcomm.org/didexchange/1.0'],
    metadata: options.metadata || {},
    my_label: options.label || agent.label,
    use_did_method: options.useDidMethod || 'did:peer:2'
  };
  const baseUrl = options.baseUrl || agent.baseUrl;

  const response = await fetch(`${baseUrl}/out-of-band/create-invitation?auto_accept=true`, {
    method: 'POST',
    headers: adminHeaders(agentName, {
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(options.timeoutMs || 5000)
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    const error = new Error(`ACA-Py ${agentName} invitation request failed.`);
    error.status = response.status;
    error.details = body;
    throw error;
  }

  const invitationUrl = body.invitation_url || body.invitationUrl;
  const iosDeepLinkUrl = invitationUrl ? createIosWalletDeepLink(invitationUrl) : null;
  const qrCodeDataUrl = invitationUrl ? await QRCode.toDataURL(invitationUrl, { margin: 1, width: 420 }) : null;
  const iosQrCodeDataUrl = iosDeepLinkUrl ? await QRCode.toDataURL(iosDeepLinkUrl, { margin: 1, width: 420 }) : null;

  return {
    track: 'aries-interoperability-lab',
    mode: 'aries-oob',
    agent: agentName,
    label: payload.my_label,
    requestUrl: invitationUrl,
    invitationUrl,
    iosDeepLinkUrl,
    qrCodeDataUrl,
    iosQrCodeDataUrl,
    phoneReachable: invitationUrl ? isPhoneReachableUrl(invitationUrl) : false,
    payload: body
  };
}

async function listAgentConnections(agentName = 'issuer', options = {}) {
  const baseUrl = getAgentAdminUrl(agentName);
  const response = await fetch(`${baseUrl}/connections`, {
    headers: adminHeaders(agentName),
    signal: AbortSignal.timeout(options.timeoutMs || 5000)
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    const error = new Error(`ACA-Py ${agentName} connections request failed.`);
    error.status = response.status;
    error.details = body;
    throw error;
  }

  return body.results || [];
}

async function listCompletedConnections(agentName = 'issuer', options = {}) {
  const connections = await listAgentConnections(agentName, options);
  return connections.filter((connection) => connection.rfc23_state === 'completed' || connection.state === 'active');
}

async function sendWalletChallenge(agentName = 'issuer', options = {}) {
  const baseUrl = getAgentAdminUrl(agentName);
  const connectionId = options.connectionId || (await getLatestCompletedConnectionId(agentName, options));

  if (!connectionId) {
    const error = new Error(`No completed ${agentName} wallet connection was found.`);
    error.status = 409;
    error.details = {
      hint: `Create a fresh ${agentName} invitation and accept it with the Vanguard Aegis ID wallet before sending the challenge.`
    };
    throw error;
  }

  const comment = options.comment || `Vanguard ${agentName} wallet challenge`;
  const content =
    options.content || `Vanguard ${agentName} wallet challenge: confirm DIDComm channel is live.`;

  const ping = await postAgentJson(`${baseUrl}/connections/${connectionId}/send-ping`, { comment }, agentName);
  const message = await postAgentJson(`${baseUrl}/connections/${connectionId}/send-message`, { content }, agentName);

  return {
    agent: agentName,
    connectionId,
    comment,
    content,
    ping,
    message
  };
}

async function acceptInvitationWithHolder(rawInvitationUrl, options = {}) {
  const invitationData = invitationPayloadFromUrl(rawInvitationUrl);
  let invitation;
  try {
    invitation = JSON.parse(invitationData);
  } catch (error) {
    const invitationError = new Error('The invitation oob payload is not valid JSON.');
    invitationError.status = 400;
    throw invitationError;
  }

  const response = await postAgentJson(
    `${getAgentAdminUrl('holder')}/out-of-band/receive-invitation?auto_accept=true&use_existing_connection=true`,
    invitation,
    'holder'
  );
  const holderConnectionId = response.connection_id;
  const invitationMessageId = response.invi_msg_id || invitation['@id'] || null;
  const holder = holderConnectionId
    ? await waitForAgentConnection('holder', holderConnectionId, options)
    : null;
  const issuer = invitationMessageId
    ? await waitForIssuerConnection(invitationMessageId, options)
    : null;

  return {
    holderConnectionId,
    issuerConnectionId: issuer?.connection_id || null,
    invitationMessageId,
    holderState: displayConnectionState(holder),
    issuerState: issuer ? displayConnectionState(issuer) : null
  };
}

async function issueMockCredential(issuerConnectionId, options = {}) {
  const subjectEmail = options.subjectEmail || 'identity@vanguardcs.ca';
  const content = [
    'Vanguard mock credential offer:',
    'type=VanguardEmployeeCredential',
    `email=${subjectEmail}`,
    'employmentStatus=active',
    'assuranceLevel=LAB_SIMULATOR'
  ].join('\n');

  await sendBasicMessage('issuer', issuerConnectionId, content);
  return { ok: true };
}

async function sendIssuerWalletChallenge(issuerConnectionId, options = {}) {
  const comment = options.comment || 'Vanguard Aegis ID wallet challenge';
  const content =
    options.content || 'Vanguard Aegis ID wallet challenge: accept this challenge in the wallet.';
  const ping = await sendTrustPing('issuer', issuerConnectionId, comment);
  await sendBasicMessage('issuer', issuerConnectionId, content);
  return {
    ok: true,
    threadId: ping.thread_id || null,
    ping
  };
}

async function sendHolderMessage(holderConnectionId, content) {
  await sendBasicMessage('holder', holderConnectionId, content);
  return { ok: true };
}

function describeInvitationError(error) {
  return {
    ok: false,
    ...describeConnectionError(error),
    status: error.status || null,
    details: error.details || null
  };
}

function describeConnectionError(error, baseUrl = '') {
  const cause = error.cause || {};
  const nestedCause = Array.isArray(cause.errors) ? cause.errors.find((item) => item.code || item.message) : null;
  const code = error.code || cause.code || nestedCause?.code || error.name || 'unreachable';
  const message = normalizeFetchMessage(cause.message || nestedCause?.message || error.message, code);

  if (code === 'ECONNREFUSED') {
    return {
      error: code,
      message,
      hint: getRefusedConnectionHint(baseUrl)
    };
  }

  if (code === 'TimeoutError' || code === 'ETIMEDOUT') {
    return {
      error: code,
      message,
      hint: 'The ACA-Py admin endpoint did not respond before the health-check timeout. Check Docker container health and port mappings.'
    };
  }

  if (code === 'ENOTFOUND') {
    return {
      error: code,
      message,
      hint: 'The ACA-Py admin host could not be resolved. Check ARIES_*_ADMIN_URL values in your environment.'
    };
  }

  return {
    error: code,
    message,
    hint: 'Check that Docker Desktop is running and the Aries lab containers are up.'
  };
}

function normalizeFetchMessage(message, code) {
  if (code === 'ECONNREFUSED') {
    return 'ACA-Py admin endpoint is not listening on this port.';
  }

  if (code === 'TimeoutError' || code === 'ETIMEDOUT') {
    return 'ACA-Py admin endpoint did not respond before the timeout.';
  }

  if (!message || message === 'fetch failed') {
    return 'ACA-Py admin endpoint is unreachable.';
  }

  return message;
}

function getAgentAdminUrl(agentName) {
  const baseUrl = endpoints[agentName];
  if (!baseUrl) {
    const error = new Error(`Unknown Aries agent: ${agentName}`);
    error.status = 400;
    throw error;
  }
  return baseUrl;
}

async function getLatestCompletedConnectionId(agentName, options = {}) {
  const connections = await listCompletedConnections(agentName, options);
  return connections.at(-1)?.connection_id || null;
}

async function waitForAgentConnection(agentName, connectionId, options = {}) {
  const attempts = options.attempts || 16;
  const delayMs = options.delayMs || 350;

  for (let index = 0; index < attempts; index += 1) {
    const record = await getAgentConnection(agentName, connectionId);
    if (isCompletedConnection(record)) {
      return record;
    }
    await delay(delayMs);
  }

  return getAgentConnection(agentName, connectionId);
}

async function waitForIssuerConnection(invitationMessageId, options = {}) {
  const attempts = options.attempts || 16;
  const delayMs = options.delayMs || 350;

  for (let index = 0; index < attempts; index += 1) {
    const records = await listAgentConnections('issuer', options);
    const match = records.find(
      (record) => record.invitation_msg_id === invitationMessageId && isCompletedConnection(record)
    );
    if (match) {
      return match;
    }
    await delay(delayMs);
  }

  return null;
}

async function getAgentConnection(agentName, connectionId) {
  const response = await fetch(`${getAgentAdminUrl(agentName)}/connections/${connectionId}`, {
    headers: adminHeaders(agentName),
    signal: AbortSignal.timeout(5000)
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    const error = new Error(`ACA-Py ${agentName} connection request failed.`);
    error.status = response.status;
    error.details = body;
    throw error;
  }

  return body;
}

async function sendTrustPing(agentName, connectionId, comment) {
  return postAgentJson(`${getAgentAdminUrl(agentName)}/connections/${connectionId}/send-ping`, { comment }, agentName);
}

async function sendBasicMessage(agentName, connectionId, content) {
  return postAgentJson(`${getAgentAdminUrl(agentName)}/connections/${connectionId}/send-message`, { content }, agentName);
}

async function postAgentJson(url, payload, agentName) {
  const response = await fetch(url, {
    method: 'POST',
    headers: adminHeaders(agentName, {
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000)
  });
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    const error = new Error(`ACA-Py ${agentName} request failed.`);
    error.status = response.status;
    error.details = body;
    throw error;
  }

  return body;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return { raw: text };
  }
}

function isPhoneReachableUrl(value) {
  try {
    const url = new URL(value);
    return !isLocalhost(url.hostname);
  } catch (error) {
    return false;
  }
}

function isLocalhostUrl(value) {
  try {
    return isLocalhost(new URL(value).hostname);
  } catch (error) {
    return false;
  }
}

function isLocalhost(hostname) {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

function createIosWalletDeepLink(invitationUrl) {
  const url = new URL(invitationUrl);
  const oob = url.searchParams.get('oob');
  if (!oob) {
    return null;
  }

  const endpoint = url.port ? `${url.protocol}//${url.hostname}:${url.port}` : `${url.protocol}//${url.hostname}`;
  const params = new URLSearchParams({
    oob,
    endpoint
  });
  for (const [key, value] of url.searchParams.entries()) {
    if (key.startsWith('vanguard_')) {
      params.set(key, value);
    }
  }

  return `aegisid://invite?${params.toString()}`;
}

function invitationPayloadFromUrl(rawInvitationUrl) {
  let url;
  try {
    url = new URL(rawInvitationUrl);
  } catch (error) {
    const invitationError = new Error('The invitation URL is invalid.');
    invitationError.status = 400;
    throw invitationError;
  }

  const encoded = url.searchParams.get('oob');
  if (!encoded) {
    const invitationError = new Error('The invitation URL must include an oob parameter.');
    invitationError.status = 400;
    throw invitationError;
  }

  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  try {
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch (error) {
    const invitationError = new Error('The invitation oob payload could not be decoded.');
    invitationError.status = 400;
    throw invitationError;
  }
}

function isCompletedConnection(record) {
  return record?.rfc23_state === 'completed' || record?.state === 'active';
}

function displayConnectionState(record) {
  return record?.rfc23_state || record?.state || 'unknown';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function adminHeaders(agentName, headers = {}) {
  const apiKey = adminApiKeys[agentName];
  if (!apiKey) {
    return headers;
  }

  return {
    ...headers,
    'X-API-Key': apiKey
  };
}

function getRefusedConnectionHint(baseUrl) {
  if (config.app.env === 'production' && isLocalhostUrl(baseUrl)) {
    return 'Azure hosted Aegis ID is configured to use localhost for ACA-Py. Set ARIES_*_ADMIN_URL to Azure-reachable ACA-Py admin endpoints.';
  }

  return 'No ACA-Py admin service is listening on this port. Start Docker Desktop, then run docker compose up for the Aries lab.';
}

module.exports = {
  acceptInvitationWithHolder,
  createIosWalletDeepLink,
  createOutOfBandInvitation,
  describeConnectionError,
  describeInvitationError,
  getAriesStatus,
  issueMockCredential,
  listAgentConnections,
  listCompletedConnections,
  sendHolderMessage,
  sendIssuerWalletChallenge,
  sendWalletChallenge
};
