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
          error: error.code || error.name || 'unreachable'
        };
      }
    })
  );

  return {
    track: 'aries-interoperability-lab',
    checks
  };
}

module.exports = { getAriesStatus };
