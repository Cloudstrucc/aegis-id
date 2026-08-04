// The Stripe webhook.
//
// Mounted before the JSON body parser in app.js, because the signature is
// computed over the exact bytes Stripe sent and a parsed-then-restringified
// body will not match.
//
// This endpoint is public — it has to be, Stripe has no session — so the
// signature check is the entire security boundary. An unverified body is an
// attacker telling us who has paid, so nothing is done with it until
// constructEvent has accepted it.

const express = require('express');

const { authorize } = require('../middleware/authorization');
const { handleWebhook, isConfigured } = require('../services/billing-service');
const { writeAuditEvent } = require('../services/audit-service');

const router = express.Router();

router.post(
  '/billing/webhook',
  // Declared as an external policy: there is no session here, so the request
  // signature is the authorization, checked below before the body is read.
  authorize('api.billing.webhook'),
  express.raw({ type: 'application/json', limit: '1mb' }),
  async (req, res) => {
    if (!isConfigured()) {
      // Nothing is configured, so nothing can be verified. 503 rather than 200:
      // a silent success would hide a misconfigured environment.
      return res.status(503).json({ error: 'Billing is not configured.' });
    }

    try {
      const result = await handleWebhook(req.body, req.get('stripe-signature'));
      return res.json(result);
    } catch (error) {
      // A bad signature is the interesting case, so it is recorded — but the
      // response says nothing beyond "rejected".
      await writeAuditEvent('subscription.billing.webhook.rejected', {
        reason: error.message,
        hasSignature: Boolean(req.get('stripe-signature'))
      });
      return res.status(400).json({ error: 'Signature verification failed.' });
    }
  }
);

module.exports = router;
