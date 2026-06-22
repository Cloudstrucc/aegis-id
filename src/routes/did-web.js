const express = require('express');
const { createDidWebService } = require('../services/did-web-service');

function createDidWebRouter(options = {}) {
  const router = express.Router();
  const didWeb = options.didWebService || createDidWebService();

  router.get('/.well-known/did.json', async (req, res, next) => {
    try {
      if (!didWeb.isEnabled()) {
        return res.status(404).json({ error: { message: 'DID:web is not enabled for this environment.' } });
      }

      const didDocument = await didWeb.getDidDocument();
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.type('application/did+json').send(didDocument);
    } catch (error) {
      return sendDidWebError(res, error);
    }
  });

  router.get(['/.well-known/did-configuration.json', '/.well-known/did.configuration.json'], async (req, res, next) => {
    try {
      if (!didWeb.isEnabled()) {
        return res.status(404).json({ error: { message: 'DID:web is not enabled for this environment.' } });
      }

      const didConfiguration = await didWeb.getDidConfiguration();
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.type('application/json').send(didConfiguration);
    } catch (error) {
      return sendDidWebError(res, error);
    }
  });

  return router;
}

function sendDidWebError(res, error) {
  const status = error.status || error.statusCode || 500;
  return res.status(status).json({
    error: {
      message: error.expose === false ? 'DID:web metadata is temporarily unavailable.' : error.message,
      code: 'did_web_metadata_unavailable'
    }
  });
}

module.exports = createDidWebRouter();
module.exports.createDidWebRouter = createDidWebRouter;
