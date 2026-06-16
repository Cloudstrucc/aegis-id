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

function validateSubscription(input = {}, user = null) {
  const errors = {};
  const email = normalizeEmail(user?.email || input.email);
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

async function createSubscription(input, user = null) {
  const validation = validateSubscription(input, user);
  if (!validation.isValid) {
    const error = new Error('Subscription form needs attention.');
    error.status = 422;
    error.details = validation;
    throw error;
  }

  const record = {
    id: crypto.randomUUID(),
    ...validation.values,
    userId: user?.id || null,
    status: 'new',
    source: user ? 'authenticated-subscription' : 'landing-page',
    createdAt: new Date().toISOString()
  };

  return store.append(record);
}

async function listSubscriptions() {
  return store.read();
}

async function getSubscription(id) {
  const subscriptions = await listSubscriptions();
  return subscriptions.find((subscription) => subscription.id === id) || null;
}

async function listSubscriptionsForUser(user) {
  if (!user) {
    return [];
  }

  const subscriptions = await listSubscriptions();
  return subscriptions.filter((subscription) => ownsSubscription(subscription, user));
}

async function getSubscriptionForUser(id, user) {
  const subscription = await getSubscription(id);
  return subscription && ownsSubscription(subscription, user) ? subscription : null;
}

function ownsSubscription(subscription, user) {
  if (!subscription || !user) {
    return false;
  }
  return subscription.userId === user.id || normalizeEmail(subscription.email) === normalizeEmail(user.email);
}

module.exports = {
  createSubscription,
  getSubscription,
  getSubscriptionForUser,
  listSubscriptionsForUser,
  listSubscriptions,
  validateSubscription
};
