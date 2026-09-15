// Attach the site a request is on.
//
// Runs before every route so that anything building a URL can read
// `req.site.baseUrl` rather than a deployment-wide setting, and anything
// rendering chrome can read `site.branding`. An organization host resolves
// to that organization; everything else is the platform.

const { resolveSiteForRequest } = require('../services/site-context-service');

async function attachSiteContext(req, res, next) {
  try {
    req.site = await resolveSiteForRequest(req.hostname || req.get('host'));
    res.locals.site = req.site;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { attachSiteContext };
