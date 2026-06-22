const crypto = require('node:crypto');
const express = require('express');

const config = require('../config');
const { createMicrosoftVerifiedIdAdapter } = require('../adapters/microsoft/verified-id-adapter');
const {
  acceptInvitationWithHolder,
  createOutOfBandInvitation,
  describeInvitationError,
  getAriesStatus,
  issueMockCredential,
  sendHolderMessage,
  sendIssuerWalletChallenge
} = require('../adapters/aries/aries-lab-adapter');
const {
  buildDemoEmployeeClaims,
  evaluatePresentation,
  getPresentationPolicy
} = require('../services/credential-policy-service');
const {
  acceptCredentialInvitation,
  getOrganizationProfile
} = require('../services/org-admin-service');
const {
  getTransaction,
  saveTransaction,
  listTransactions,
  updateTransactionByState
} = require('../services/transaction-store');
const { writeAuditEvent } = require('../services/audit-service');
const {
  acceptExternalWalletChallenge,
  createExternalWalletChallenge,
  declineExternalWalletChallenge,
  getWalletChallenge,
  listWalletChallengeLedger
} = require('../services/wallet-challenge-service');
const {
  finishWalletPasskeyAuthentication,
  finishWalletPasskeyRegistration,
  getWalletPasskeyStatus,
  startWalletPasskeyAuthentication,
  startWalletPasskeyRegistration
} = require('../services/wallet-passkey-service');
const { authorize } = require('../middleware/authorization');

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

router.post('/issuer/create-offer', authorize('api.verifiedId.issue'), async (req, res, next) => {
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

router.post('/issuer/callback', authorize('api.verifiedId.callback'), async (req, res, next) => {
  try {
    validateCallbackApiKey(req);
    await updateTransactionByState(req.body?.state, {
      status: req.body?.requestStatus || 'callback',
      callbackStatus: req.body?.requestStatus || null,
      callbackPayload: req.body
    });
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

router.post('/verifier/create-request', authorize('api.verifiedId.present'), async (req, res, next) => {
  try {
    const policy = {
      ...getPresentationPolicy(),
      purpose: req.body?.purpose,
      clientName: req.body?.appName
    };
    const result = await verifiedId.createPresentationRequest(policy);

    await saveTransaction({
      id: result.id,
      kind: 'presentation',
      state: result.state,
      status: 'created',
      mode: result.mode,
      requestUrl: result.requestUrl,
      expiresAt: result.expiresAt,
      appName: req.body?.appName || null,
      subject: req.body?.subject || null,
      purpose: req.body?.purpose || null
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

router.post('/verifier/callback', authorize('api.verifiedId.callback'), async (req, res, next) => {
  try {
    validateCallbackApiKey(req);
    const state = req.body?.state || req.body?.requestId || crypto.randomUUID();
    const claims = req.body?.verifiedCredentialsData?.[0]?.claims || req.body?.claims || {};
    const decision = evaluatePresentation(claims);
    const callbackStatus = req.body?.requestStatus || null;
    const status = callbackStatus === 'presentation_verified' ? 'verified' : callbackStatus || 'callback';

    let transaction = await updateTransactionByState(state, {
      status,
      callbackStatus,
      subject: req.body?.subject || null,
      claims,
      decision,
      callbackPayload: req.body
    });
    const external = !transaction;

    if (external) {
      transaction = await saveTransaction({
        id: req.body?.requestId || crypto.randomUUID(),
        kind: 'presentation',
        source: 'external-verified-id-callback',
        state,
        status,
        mode: config.verifiedId.mode,
        requestUrl: null,
        appName:
          req.body?.registration?.clientName ||
          req.body?.clientName ||
          req.body?.requester ||
          'External Verified ID request',
        subject: req.body?.subject || null,
        purpose: req.body?.purpose || null,
        callbackStatus,
        claims,
        decision,
        callbackPayload: req.body
      });
    }

    await writeAuditEvent('verified-id.presentation.callback', {
      transactionId: transaction.id,
      state,
      external,
      decision,
      payload: req.body
    });

    res.status(202).json({
      accepted: true,
      decision,
      transactionId: transaction.id,
      external
    });
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

router.post('/aries/:agent/invitation', authorize('api.aries.lab'), async (req, res, next) => {
  try {
    const invitation = await createOutOfBandInvitation(req.params.agent);
    res.status(201).json(invitation);
  } catch (error) {
    next(error);
  }
});

router.post('/wallet-lab/accept-invitation', authorize('api.aries.lab'), async (req, res, next) => {
  try {
    if (!req.body?.rawInvitationUrl) {
      const error = new Error('rawInvitationUrl is required.');
      error.status = 400;
      throw error;
    }

    res.status(202).json(await acceptInvitationWithHolder(req.body.rawInvitationUrl));
  } catch (error) {
    next(error);
  }
});

router.post('/wallet-lab/issuer-mock-credential', authorize('api.aries.lab'), async (req, res, next) => {
  try {
    if (!req.body?.issuerConnectionId) {
      const error = new Error('issuerConnectionId is required.');
      error.status = 400;
      throw error;
    }

    res.status(202).json(
      await issueMockCredential(req.body.issuerConnectionId, {
        subjectEmail: req.body.subjectEmail
      })
    );
  } catch (error) {
    next(error);
  }
});

router.post('/wallet-lab/issuer-challenge', authorize('api.aries.lab'), async (req, res, next) => {
  try {
    if (!req.body?.issuerConnectionId) {
      const error = new Error('issuerConnectionId is required.');
      error.status = 400;
      throw error;
    }

    res.status(202).json(await sendIssuerWalletChallenge(req.body.issuerConnectionId));
  } catch (error) {
    next(error);
  }
});

router.post('/wallet-lab/holder-message', authorize('api.aries.lab'), async (req, res, next) => {
  try {
    if (!req.body?.holderConnectionId || !req.body?.content) {
      const error = new Error('holderConnectionId and content are required.');
      error.status = 400;
      throw error;
    }

    res.status(202).json(await sendHolderMessage(req.body.holderConnectionId, req.body.content));
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

router.get('/transactions/:transactionId', async (req, res, next) => {
  try {
    const transaction = await getTransaction(req.params.transactionId);
    if (!transaction) {
      const error = new Error('Transaction not found.');
      error.status = 404;
      throw error;
    }

    res.json(transaction);
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

router.post('/wallet/credential-invitations/:credentialId/accept', authorize('api.wallet.mobile'), async (req, res, next) => {
  try {
    const organizationId = req.body.organizationId || req.query.organizationId;
    if (!organizationId) {
      const error = new Error('organizationId is required.');
      error.status = 400;
      throw error;
    }

    const credential = await acceptCredentialInvitation(organizationId, req.params.credentialId, {
      holderEmail: req.body.holderEmail,
      source: req.body.source || 'wallet-api'
    });
    await writeAuditEvent('wallet.credential.accepted', {
      organizationId,
      credentialId: credential.id,
      holderEmail: credential.holderEmail,
      source: req.body.source || 'wallet-api'
    });
    res.json({
      ok: true,
      status: credential.status,
      credential
    });
  } catch (error) {
    next(error);
  }
});

router.get('/wallet/passkeys/status', async (req, res, next) => {
  try {
    res.json(await getWalletPasskeyStatus(req.query.subject));
  } catch (error) {
    next(error);
  }
});

router.post('/wallet/passkeys/register/options', authorize('api.wallet.mobile'), async (req, res, next) => {
  try {
    res.json(await startWalletPasskeyRegistration(req.body, getPasskeyRequestInfo(req)));
  } catch (error) {
    next(error);
  }
});

router.post('/wallet/passkeys/register/verify', authorize('api.wallet.mobile'), async (req, res, next) => {
  try {
    const status = await finishWalletPasskeyRegistration(req.body, getPasskeyRequestInfo(req));
    await writeAuditEvent('wallet-passkey.registered', {
      subject: status.subject,
      passkeyCount: status.passkeyCount,
      source: req.body.source || 'wallet-api'
    });
    res.json({ ok: true, status });
  } catch (error) {
    next(error);
  }
});

router.post('/wallet/passkeys/authenticate/options', authorize('api.wallet.mobile'), async (req, res, next) => {
  try {
    res.json(await startWalletPasskeyAuthentication(req.body, getPasskeyRequestInfo(req)));
  } catch (error) {
    next(error);
  }
});

router.post('/wallet/passkeys/authenticate/verify', authorize('api.wallet.mobile'), async (req, res, next) => {
  try {
    const evidence = await finishWalletPasskeyAuthentication(req.body, getPasskeyRequestInfo(req));
    await writeAuditEvent('wallet-passkey.verified', {
      subject: evidence.subject,
      credentialId: evidence.credentialId,
      challengeId: evidence.challengeId,
      source: req.body.source || 'wallet-api'
    });
    res.json({ ok: true, evidence });
  } catch (error) {
    next(error);
  }
});

router.post('/wallet-challenges', authorize('api.walletChallenge.external'), async (req, res, next) => {
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

router.post('/wallet-challenges/:challengeId/accept', authorize('api.walletChallenge.external'), async (req, res, next) => {
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

router.post('/wallet-challenges/:challengeId/decline', authorize('api.walletChallenge.external'), async (req, res, next) => {
  try {
    const challenge = await declineExternalWalletChallenge(req.params.challengeId, {
      declinedBy: req.body.declinedBy,
      reason: req.body.reason,
      source: req.body.source || 'wallet-api'
    });
    await writeAuditEvent('wallet-challenge.declined', {
      challengeId: challenge.id,
      appName: challenge.appName,
      appInstanceId: challenge.appInstanceId,
      organizationId: challenge.organizationId,
      action: challenge.action,
      resourceType: challenge.resourceType,
      resourceId: challenge.resourceId,
      subject: challenge.subject,
      reason: challenge.declineReason,
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

router.post('/wallet-challenges/:challengeId/accept-with-passkey', authorize('api.walletChallenge.external'), async (req, res, next) => {
  try {
    const current = await getWalletChallenge(req.params.challengeId);
    const evidence = await finishWalletPasskeyAuthentication(
      {
        subject: req.body.subject || current.subject,
        challengeId: req.body.challengeId || req.params.challengeId,
        response: req.body.response || req.body.passkeyResponse
      },
      getPasskeyRequestInfo(req)
    );
    const challenge = await acceptExternalWalletChallenge(req.params.challengeId, {
      acceptedBy: evidence.subject,
      source: req.body.source || 'wallet-passkey',
      passkeyEvidence: evidence
    });
    await writeAuditEvent('wallet-challenge.accepted.passkey', {
      challengeId: challenge.id,
      appName: challenge.appName,
      appInstanceId: challenge.appInstanceId,
      organizationId: challenge.organizationId,
      action: challenge.action,
      resourceType: challenge.resourceType,
      resourceId: challenge.resourceId,
      subject: challenge.subject,
      credentialId: evidence.credentialId,
      assurance: evidence.assurance
    });
    res.json({
      ok: true,
      status: challenge.status,
      evidence,
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

function getPasskeyRequestInfo(req) {
  return {
    origin: `${req.protocol}://${req.get('host')}`,
    rpId: req.hostname
  };
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
