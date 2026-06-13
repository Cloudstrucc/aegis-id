const config = require('../../config');

const endpoints = {
  issuer: config.aries.issuerAdminUrl,
  verifier: config.aries.verifierAdminUrl,
  mediator: config.aries.mediatorAdminUrl
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

module.exports = { getAriesStatus, describeConnectionError };
