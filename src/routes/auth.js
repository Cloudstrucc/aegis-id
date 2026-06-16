const express = require('express');
const passport = require('passport');

const {
  createOtpChallenge,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  getUserById,
  registerUser,
  startPasskeyAuthentication,
  startPasskeyRegistration,
  validateRegistration,
  verifyOtpChallenge
} = require('../services/auth-service');
const { writeAuditEvent } = require('../services/audit-service');
const {
  completeLogin,
  requireAnonymous,
  requirePendingSecondFactor
} = require('../middleware/auth');

const router = express.Router();

router.get('/auth/register', requireAnonymous, (req, res) => {
  res.render('pages/auth-register', buildRegisterView(req));
});

router.post('/auth/register', requireAnonymous, async (req, res, next) => {
  try {
    const user = await registerUser(req.body);
    req.session.pendingSecondFactorUserId = user.id;
    req.session.pendingSecondFactorMethod = user.preferredMfa;
    req.session.subscriptionDraft = buildSubscriptionDraft(req.body, user);

    if (user.preferredMfa === 'email' || user.preferredMfa === 'sms') {
      req.session.secondFactorDelivery = await createOtpChallenge(user.id, user.preferredMfa);
    }

    await writeAuditEvent('auth.user.registered', {
      userId: user.id,
      email: user.email,
      preferredMfa: user.preferredMfa
    });
    res.redirect(303, '/auth/verify');
  } catch (error) {
    if (error.status === 422 || error.status === 409) {
      const validation = error.details || validateRegistration(req.body);
      return res.status(error.status).render('pages/auth-register', buildRegisterView(req, {
        formErrors: validation.errors,
        formValues: validation.values,
        errorMessage: error.status === 409 ? error.message : null
      }));
    }
    next(error);
  }
});

router.get('/auth/login', requireAnonymous, (req, res) => {
  res.render('pages/auth-login', {
    title: 'Sign in',
    description: 'Sign in to Vanguard Cloud Services - Aegis ID.',
    formValues: { email: '' },
    errorMessage: req.session.authError || null
  });
  req.session.authError = null;
});

router.post('/auth/login', requireAnonymous, (req, res, next) => {
  passport.authenticate('local', async (error, user, info) => {
    try {
      if (error) {
        return next(error);
      }
      if (!user) {
        return res.status(401).render('pages/auth-login', {
          title: 'Sign in',
          description: 'Sign in to Vanguard Cloud Services - Aegis ID.',
          formValues: { email: req.body.email || '' },
          errorMessage: info?.message || 'Invalid email or password.'
        });
      }

      req.session.pendingSecondFactorUserId = user.id;
      req.session.pendingSecondFactorMethod = user.preferredMfa;
      if (user.preferredMfa === 'email' || user.preferredMfa === 'sms') {
        req.session.secondFactorDelivery = await createOtpChallenge(user.id, user.preferredMfa);
      }
      await writeAuditEvent('auth.login.password.accepted', {
        userId: user.id,
        email: user.email,
        preferredMfa: user.preferredMfa
      });
      return res.redirect(303, '/auth/verify');
    } catch (routeError) {
      return next(routeError);
    }
  })(req, res, next);
});

router.get('/auth/verify', requirePendingSecondFactor, async (req, res, next) => {
  try {
    const user = await getUserById(req.session.pendingSecondFactorUserId);
    const method = req.session.pendingSecondFactorMethod || user.preferredMfa || 'email';
    res.render('pages/auth-verify', buildVerifyView(req, user, method));
  } catch (error) {
    next(error);
  }
});

router.post('/auth/verify', requirePendingSecondFactor, async (req, res, next) => {
  try {
    const user = await getUserById(req.session.pendingSecondFactorUserId);
    const ok = await verifyOtpChallenge(user.id, req.body.code);
    if (!ok) {
      return res.status(422).render('pages/auth-verify', buildVerifyView(req, user, req.session.pendingSecondFactorMethod, {
        errorMessage: 'Verification code was invalid or expired.'
      }));
    }
    await finishInteractiveLogin(req, res, user, 'otp');
  } catch (error) {
    next(error);
  }
});

router.post('/auth/verify/resend', requirePendingSecondFactor, async (req, res, next) => {
  try {
    const user = await getUserById(req.session.pendingSecondFactorUserId);
    const method = ['email', 'sms'].includes(req.body.method) ? req.body.method : user.preferredMfa;
    req.session.pendingSecondFactorMethod = method;
    req.session.secondFactorDelivery = await createOtpChallenge(user.id, method);
    res.redirect(303, '/auth/verify');
  } catch (error) {
    next(error);
  }
});

router.post('/auth/passkeys/register/options', requirePendingSecondFactor, async (req, res, next) => {
  try {
    const options = await startPasskeyRegistration(req.session.pendingSecondFactorUserId, getPasskeyRequestInfo(req));
    res.json(options);
  } catch (error) {
    next(error);
  }
});

router.post('/auth/passkeys/register/verify', requirePendingSecondFactor, async (req, res, next) => {
  try {
    const user = await getUserById(req.session.pendingSecondFactorUserId);
    await finishPasskeyRegistration(user.id, req.body, getPasskeyRequestInfo(req));
    await finishInteractiveLogin(req, res, user, 'passkey-registration', true);
  } catch (error) {
    next(error);
  }
});

router.post('/auth/passkeys/authenticate/options', requirePendingSecondFactor, async (req, res, next) => {
  try {
    const options = await startPasskeyAuthentication(req.session.pendingSecondFactorUserId, getPasskeyRequestInfo(req));
    res.json(options);
  } catch (error) {
    next(error);
  }
});

router.post('/auth/passkeys/authenticate/verify', requirePendingSecondFactor, async (req, res, next) => {
  try {
    const user = await getUserById(req.session.pendingSecondFactorUserId);
    await finishPasskeyAuthentication(user.id, req.body, getPasskeyRequestInfo(req));
    await finishInteractiveLogin(req, res, user, 'passkey-authentication', true);
  } catch (error) {
    next(error);
  }
});

router.post('/auth/logout', (req, res, next) => {
  req.logout((error) => {
    if (error) {
      return next(error);
    }
    req.session.destroy(() => {
      res.redirect(303, '/');
    });
  });
});

async function finishInteractiveLogin(req, res, user, method, json = false) {
  const postAuthState = getPostAuthState(req);
  await completeLogin(req, user);
  restorePostAuthState(req, postAuthState);
  await writeAuditEvent('auth.second_factor.accepted', {
    userId: user.id,
    email: user.email,
    method
  });
  if (json) {
    return res.json({ ok: true, redirectUrl: postAuthState.redirectUrl });
  }
  return res.redirect(303, postAuthState.redirectUrl);
}

function getPostAuthState(req) {
  const redirectUrl = req.session.subscriptionDraft ? '/subscribe' : req.session.returnTo || '/account';
  return {
    redirectUrl,
    subscriptionDraft: req.session.subscriptionDraft || null
  };
}

function restorePostAuthState(req, postAuthState) {
  if (postAuthState.subscriptionDraft) {
    req.session.subscriptionDraft = postAuthState.subscriptionDraft;
  }
  delete req.session.pendingSecondFactorUserId;
  delete req.session.pendingSecondFactorMethod;
  delete req.session.secondFactorDelivery;
  delete req.session.returnTo;
}

function buildRegisterView(req, overrides = {}) {
  const formValues = {
    displayName: '',
    email: '',
    phone: '',
    organization: '',
    plan: 'pilot',
    interest: 'both',
    preferredMfa: 'email',
    ...(req.session?.subscriptionDraft || {}),
    ...(overrides.formValues || {})
  };
  delete formValues.password;
  delete formValues.confirmPassword;

  return {
    title: 'Create account',
    description: 'Create a Vanguard Cloud Services - Aegis ID subscriber account.',
    formValues,
    formErrors: overrides.formErrors || {},
    errorMessage: overrides.errorMessage || null
  };
}

function buildVerifyView(req, user, method, overrides = {}) {
  const delivery = req.session.secondFactorDelivery || null;
  const passkeyMode = user.passkeyCount > 0 ? 'authenticate' : 'register';

  return {
    title: 'Verify sign in',
    description: 'Complete second-factor verification for Vanguard Cloud Services - Aegis ID.',
    user,
    method,
    isOtp: method === 'email' || method === 'sms',
    isPasskey: method === 'passkey',
    passkeyMode,
    delivery,
    canUseSms: Boolean(user.phone),
    errorMessage: overrides.errorMessage || null
  };
}

function buildSubscriptionDraft(input, user) {
  return {
    email: user.email,
    organization: input.organization || '',
    plan: input.plan || 'pilot',
    interest: input.interest || 'both',
    role: input.role || '',
    notes: input.notes || ''
  };
}

function getPasskeyRequestInfo(req) {
  const host = req.get('host').split(':')[0];
  return {
    origin: `${req.protocol}://${req.get('host')}`,
    rpId: host
  };
}

module.exports = router;
