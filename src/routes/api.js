const express = require('express');

const config = require('../config');
const { createMicrosoftVerifiedIdAdapter } = require('../adapters/microsoft/verified-id-adapter');
const { getAriesStatus } = require('../adapters/aries/aries-lab-adapter');
const {
  buildDemoEmployeeClaims,
  evaluatePresentation,
  getPresentationPolicy
} = require('../services/credential-policy-service');
const { saveTransaction, listTransactions } = require('../services/transaction-store');
const { writeAuditEvent } = require('../services/audit-service');

const router = express.Router();
const verifiedId = createMicrosoftVerifiedIdAdapter();

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: config.app.name,
    verifiedIdMode: config.verifiedId.mode,
    timestamp: new Date().toISOString()
  });
});

router.post('/issuer/create-offer', async (req, res, next) => {
  try {
    const claims = buildDemoEmployeeClaims(req.body);
    const result = await verifiedId.createCredentialOffer({
      credentialType: config.verifiedId.credentialType,
      claims
    });

    await saveTransaction({
      id: result.id,
      kind: 'issuance',
      state: result.state,
      status: 'created',
      mode: result.mode,
      requestUrl: result.requestUrl,
      expiresAt: result.expiresAt
    });
    await writeAuditEvent('verified-id.issuance.created', {
      transactionId: result.id,
      state: result.state,
      credentialType: config.verifiedId.credentialType
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/issuer/callback', async (req, res, next) => {
  try {
    validateCallbackApiKey(req);
    await writeAuditEvent('verified-id.issuance.callback', {
      state: req.body?.state,
      status: req.body?.requestStatus,
      payload: req.body
    });

    res.sendStatus(202);
  } catch (error) {
    next(error);
  }
});

router.post('/verifier/create-request', async (req, res, next) => {
  try {
    const policy = getPresentationPolicy();
    const result = await verifiedId.createPresentationRequest(policy);

    await saveTransaction({
      id: result.id,
      kind: 'presentation',
      state: result.state,
      status: 'created',
      mode: result.mode,
      requestUrl: result.requestUrl,
      expiresAt: result.expiresAt
    });
    await writeAuditEvent('verified-id.presentation.created', {
      transactionId: result.id,
      state: result.state,
      policy
    });

    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/verifier/callback', async (req, res, next) => {
  try {
    validateCallbackApiKey(req);
    const claims = req.body?.verifiedCredentialsData?.[0]?.claims || req.body?.claims || {};
    const decision = evaluatePresentation(claims);

    await writeAuditEvent('verified-id.presentation.callback', {
      state: req.body?.state,
      decision,
      payload: req.body
    });

    res.status(202).json({ accepted: true, decision });
  } catch (error) {
    next(error);
  }
});

router.get('/aries/status', async (req, res, next) => {
  try {
    res.json(await getAriesStatus());
  } catch (error) {
    next(error);
  }
});

router.get('/transactions', async (req, res, next) => {
  try {
    res.json(await listTransactions());
  } catch (error) {
    next(error);
  }
});

function validateCallbackApiKey(req) {
  if (!config.verifiedId.callbackApiKey) {
    return;
  }

  if (req.get('api-key') !== config.verifiedId.callbackApiKey) {
    const error = new Error('Invalid callback API key.');
    error.status = 401;
    throw error;
  }
}

module.exports = router;
