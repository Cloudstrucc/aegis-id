const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');

const store = new FileJsonStore(config.paths.subscriptions, []);

const allowedPlans = new Set(['pilot', 'sandbox', 'enterprise']);
const allowedInterests = new Set(['microsoft-native', 'aries-lab', 'both']);

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function normalizeText(value = '') {
  return String(value).trim().slice(0, 400);
}

function validateSubscription(input) {
  const errors = {};
  const email = normalizeEmail(input.email);
  const plan = allowedPlans.has(input.plan) ? input.plan : 'pilot';
  const interest = allowedInterests.has(input.interest) ? input.interest : 'both';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid work email.';
  }

  if (!input.consent) {
    errors.consent = 'Consent is required to follow up.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    values: {
      email,
      plan,
      interest,
      organization: normalizeText(input.organization),
      role: normalizeText(input.role),
      notes: normalizeText(input.notes)
    }
  };
}

async function createSubscription(input) {
  const validation = validateSubscription(input);
  if (!validation.isValid) {
    const error = new Error('Subscription form needs attention.');
    error.status = 422;
    error.details = validation;
    throw error;
  }

  const record = {
    id: crypto.randomUUID(),
    ...validation.values,
    status: 'new',
    source: 'landing-page',
    createdAt: new Date().toISOString()
  };

  return store.append(record);
}

async function listSubscriptions() {
  return store.read();
}

module.exports = {
  createSubscription,
  listSubscriptions,
  validateSubscription
};
