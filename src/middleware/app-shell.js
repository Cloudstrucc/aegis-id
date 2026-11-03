const { buildAppShell } = require('../services/app-shell-service');

/**
 * Give every rendered page its application chrome.
 *
 * Wraps `res.render` rather than setting a local, because the shell is built
 * from what the route found: the dashboard's blade navigation, the workspace
 * it is showing, the page title the breadcrumb ends with. A middleware that
 * ran before the route would have none of those — it would have to rebuild the
 * blade list from the privileges itself, which is the second copy this exists
 * to avoid.
 *
 * `buildAppShell` returns null for a page that does not take a shell, and the
 * layout falls back to the plain single-column body.
 */
function attachAppShell(req, res, next) {
  const render = res.render.bind(res);

  res.render = function renderWithAppShell(view, options, callback) {
    let locals = options;
    let done = callback;
    if (typeof locals === 'function') {
      done = locals;
      locals = undefined;
    }
    const merged = { ...res.locals, ...(locals || {}) };
    return render(view, { ...(locals || {}), appShell: buildAppShell(merged) }, done);
  };

  next();
}

module.exports = { attachAppShell };
