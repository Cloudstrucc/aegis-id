const express = require('express');

const config = require('../config');
const { createMicrosoftVerifiedIdAdapter } = require('../adapters/microsoft/verified-id-adapter');
const {
  createOutOfBandInvitation,
  describeInvitationError,
  getAriesStatus
} = require('../adapters/aries/aries-lab-adapter');
const {
  buildDemoEmployeeClaims,
  evaluatePresentation,
  getPresentationPolicy
} = require('../services/credential-policy-service');
const { getOrganizationProfile } = require('../services/org-admin-service');
const { saveTransaction, listTransactions } = require('../services/transaction-store');
const { writeAuditEvent } = require('../services/audit-service');
const {
  acceptExternalWalletChallenge,
  createExternalWalletChallenge,
  getWalletChallenge,
  listWalletChallengeLedger
} = require('../services/wallet-challenge-service');

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
    const iosWalletInvitation = await tryCreateIosWalletInvitation();

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

    res.status(201).json({
      ...result,
      iosWalletInvitation
    });
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

router.post('/aries/:agent/invitation', async (req, res, next) => {
  try {
    const invitation = await createOutOfBandInvitation(req.params.agent);
    res.status(201).json(invitation);
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

router.get('/organizations/:organizationId/profile', async (req, res, next) => {
  try {
    res.json(await getOrganizationProfile(req.params.organizationId));
  } catch (error) {
    next(error);
  }
});

router.post('/wallet-challenges', async (req, res, next) => {
  try {
    const challenge = await createExternalWalletChallenge(req.body);
    await writeAuditEvent('wallet-challenge.created', {
      challengeId: challenge.id,
      appName: challenge.appName,
      appInstanceId: challenge.appInstanceId,
      organizationId: challenge.organizationId,
      action: challenge.action,
      resourceType: challenge.resourceType,
      resourceId: challenge.resourceId,
      subject: challenge.subject,
      delivery: challenge.delivery
    });
    res.status(201).json(challenge);
  } catch (error) {
    next(error);
  }
});

router.get('/wallet-challenges/ledger', async (req, res, next) => {
  try {
    res.json({
      challenges: await listWalletChallengeLedger({
        organizationId: req.query.organizationId,
        appInstanceId: req.query.appInstanceId,
        limit: req.query.limit
      })
    });
  } catch (error) {
    next(error);
  }
});

router.get('/wallet-challenges/:challengeId', async (req, res, next) => {
  try {
    res.json(await getWalletChallenge(req.params.challengeId));
  } catch (error) {
    next(error);
  }
});

router.post('/wallet-challenges/:challengeId/accept', async (req, res, next) => {
  try {
    const challenge = await acceptExternalWalletChallenge(req.params.challengeId, {
      acceptedBy: req.body.acceptedBy,
      source: req.body.source || 'wallet-api'
    });
    await writeAuditEvent('wallet-challenge.accepted', {
      challengeId: challenge.id,
      appName: challenge.appName,
      appInstanceId: challenge.appInstanceId,
      organizationId: challenge.organizationId,
      action: challenge.action,
      resourceType: challenge.resourceType,
      resourceId: challenge.resourceId,
      subject: challenge.subject,
      source: req.body.source || 'wallet-api'
    });
    res.json({
      ok: true,
      status: challenge.status,
      challenge
    });
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

async function tryCreateIosWalletInvitation() {
  try {
    return await createOutOfBandInvitation('issuer');
  } catch (error) {
    return {
      agent: 'issuer',
      mode: 'aries-oob',
      label: 'Vanguard Aries Issuer',
      ...describeInvitationError(error)
    };
  }
}

module.exports = router;
