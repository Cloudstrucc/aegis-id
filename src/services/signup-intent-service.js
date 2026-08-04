// What a visitor has chosen on their way to an account, held server-side.
//
// The single rule this module exists to enforce: **the plan is never read from
// a form field.** A signup form that carries `plan=enterprise` is a form anyone
// can edit, so the chosen plan lives in the session and the only way to change
// it is to go back to the pricing page and choose again.
//
// The same applies to a registration code. The code is checked at checkout so
// somebody is not made to fill in a whole form before being told their code is
// wrong, but it is not *spent* until the subscription is actually created — an
// abandoned signup must not burn a redemption.

const { getPlan, DEFAULT_PLAN_ID } = require('./plan-service');

const SESSION_KEY = 'signupIntent';

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  error.expose = true;
  return error;
}

/** Record the plan a visitor picked. Returns the plan for convenience. */
function choosePlan(session, planId) {
  const plan = getPlan(planId);
  if (!plan) {
    throw validationError('Choose one of the available plans.');
  }

  session[SESSION_KEY] = {
    planId: plan.id,
    chosenAt: new Date().toISOString(),
    // A grant is what makes a paid plan usable without a card. Choosing a plan
    // afresh clears any earlier one, so a code for Basic cannot be carried
    // sideways onto Enterprise.
    grant: null
  };
  return plan;
}

function getIntent(session) {
  const intent = session?.[SESSION_KEY];
  if (!intent || !getPlan(intent.planId)) {
    return null;
  }
  return intent;
}

/** The plan a signup is for, falling back to Trial when nothing was chosen. */
function intendedPlan(session) {
  const intent = getIntent(session);
  return getPlan(intent?.planId) || getPlan(DEFAULT_PLAN_ID);
}

/**
 * Attach a checked-but-unspent registration code.
 *
 * The plaintext stays in the server-side session and is never rendered back to
 * the page, because the redemption at the end of the flow needs it.
 */
function attachCodeGrant(session, code) {
  const intent = getIntent(session);
  if (!intent) {
    throw validationError('Choose a plan first.');
  }
  intent.grant = { via: 'code', code: String(code || '').trim() };
  session[SESSION_KEY] = intent;
}

/** Record that payment has been arranged. Phase 5 sets this from Stripe. */
function attachPaymentGrant(session, { reference = null } = {}) {
  const intent = getIntent(session);
  if (!intent) {
    throw validationError('Choose a plan first.');
  }
  intent.grant = { via: 'payment', reference };
  session[SESSION_KEY] = intent;
}

function grantFor(session) {
  return getIntent(session)?.grant || null;
}

function clearIntent(session) {
  if (session) {
    delete session[SESSION_KEY];
  }
}

/**
 * Is this signup ready to become a subscription?
 *
 * A free plan always is. A paid plan needs a grant — a code, or payment — and
 * without one the subscription is still created but starts unpaid, which
 * plan-service already treats as Trial limits rather than as nothing.
 */
function isSettled(session) {
  const plan = intendedPlan(session);
  return !plan.requiresPayment || Boolean(grantFor(session));
}

module.exports = {
  SESSION_KEY,
  attachCodeGrant,
  attachPaymentGrant,
  choosePlan,
  clearIntent,
  getIntent,
  grantFor,
  intendedPlan,
  isSettled
};
