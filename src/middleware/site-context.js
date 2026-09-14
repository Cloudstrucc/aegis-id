// Attach the site a request is on.
//
// Runs before every route so that anything building a URL can read
// `req.site.baseUrl` rather than a deployment-wide setting. Templates get the
// same object as `site`.

const { resolveSite } = require('../services/site-context-service');

function attachSiteContext(req, res, next) {
  req.site = resolveSite(req.hostname || req.get('host'));
  res.locals.site = req.site;
  next();
}

module.exports = { attachSiteContext };
