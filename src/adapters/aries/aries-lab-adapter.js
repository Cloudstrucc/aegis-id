const config = require('../../config');
const QRCode = require('qrcode');

const endpoints = {
  issuer: config.aries.issuerAdminUrl,
  verifier: config.aries.verifierAdminUrl,
  mediator: config.aries.mediatorAdminUrl
};

const invitationAgents = {
  issuer: {
    baseUrl: endpoints.issuer,
    label: 'Cloudstrucc Aries Issuer'
  },
  verifier: {
    baseUrl: endpoints.verifier,
    label: 'Cloudstrucc Aries Verifier'
  }
};

async function getAriesStatus() {
  const checks = await Promise.all(
    Object.entries(endpoints).map(async ([name, baseUrl]) => {
      try {
        const response = await fetch(`${baseUrl}/status/live`, { signal: AbortSignal.timeout(1500) });
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
          ...describeConnectionError(error)
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
    headers: {
      'Content-Type': 'application/json'
    },
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
      hint: `Create a fresh ${agentName} invitation and accept it with the Cloudstrucc iOS wallet before sending the challenge.`
    };
    throw error;
  }

  const comment = options.comment || `Cloudstrucc ${agentName} wallet challenge`;
  const content =
    options.content || `Cloudstrucc ${agentName} wallet challenge: confirm DIDComm channel is live.`;

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

function describeInvitationError(error) {
  return {
    ok: false,
    ...describeConnectionError(error),
    status: error.status || null,
    details: error.details || null
  };
}

function describeConnectionError(error) {
  const cause = error.cause || {};
  const nestedCause = Array.isArray(cause.errors) ? cause.errors.find((item) => item.code || item.message) : null;
  const code = error.code || cause.code || nestedCause?.code || error.name || 'unreachable';
  const message = normalizeFetchMessage(cause.message || nestedCause?.message || error.message, code);

  if (code === 'ECONNREFUSED') {
    return {
      error: code,
      message,
      hint: 'No ACA-Py admin service is listening on this port. Start Docker Desktop, then run docker compose up for the Aries lab.'
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

async function postAgentJson(url, payload, agentName) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
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
    return !['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  } catch (error) {
    return false;
  }
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

  return `cloudstrucc-wallet://invite?${params.toString()}`;
}

module.exports = {
  createIosWalletDeepLink,
  createOutOfBandInvitation,
  describeConnectionError,
  describeInvitationError,
  getAriesStatus,
  listAgentConnections,
  listCompletedConnections,
  sendWalletChallenge
};
