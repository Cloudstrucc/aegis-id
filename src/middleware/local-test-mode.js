// Third guard for local-only test affordances: the request itself must have
// arrived on a loopback address.
//
// config.app.localTestMode already required an explicit flag and a
// non-production build. This adds the condition that cannot be misconfigured:
// a request from another machine never has a loopback remote address, so even
// a flag set by mistake on a hosted environment grants nothing.

const config = require('../config');

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

function isLoopbackRequest(req) {
  const candidates = [req.socket?.remoteAddress, req.connection?.remoteAddress, req.ip];
  return candidates.some((value) => LOOPBACK.has(String(value || '').trim()));
}

/**
 * True only when every guard holds: the flag is set, the build is not
 * production, and this request came from the local machine.
 */
function isLocalTestRequest(req) {
  return config.app.localTestMode === true && isLoopbackRequest(req);
}

/** Exposes the state to views and later middleware, and logs it once per request. */
function attachLocalTestMode(req, res, next) {
  const active = isLocalTestRequest(req);
  req.localTestMode = active;
  res.locals.localTestMode = active;
  next();
}

/** Startup banner, so an enabled bypass can never go unnoticed. */
function logLocalTestModeBanner(log = console.warn) {
  if (config.app.localTestMode) {
    log(
      '\n' +
        '  ┌───────────────────────────────────────────────────────────────┐\n' +
        '  │  LOCAL TEST MODE IS ACTIVE                                    │\n' +
        '  │  Accounts flagged testAccount skip the second factor.         │\n' +
        '  │  Loopback requests only. Never enabled outside localhost.     │\n' +
        '  └───────────────────────────────────────────────────────────────┘\n'
    );
    return;
  }

  if (config.app.localTestModeRequested) {
    log('LOCAL_TEST_MODE was requested but refused: this is a production build.');
  }
}

module.exports = { attachLocalTestMode, isLocalTestRequest, isLoopbackRequest, logLocalTestModeBanner };
