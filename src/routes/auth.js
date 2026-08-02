const express = require('express');
const passport = require('passport');

const config = require('../config');
const {
  createOtpChallenge,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  getUserById,
  registerUser,
  finishPasskeyLogin,
  startPasskeyAuthentication,
  startPasskeyLogin,
  startPasskeyRegistration,
  validateRegistration,
  verifyOtpChallenge
} = require('../services/auth-service');
const { writeAuditEvent } = require('../services/audit-service');
const {
  TOKEN_TTL_MINUTES,
  completePasswordReset,
  requestPasswordReset,
  resolveResetToken
} = require('../services/password-reset-service');
const rateLimit = require('../services/rate-limit-service');
const { isFirstFactorEnabled } = require('../services/sign-in-methods-service');
const { isLocalTestRequest } = require('../middleware/local-test-mode');
const {
  ensureAccountAccessSubscription
} = require('../services/subscription-service');
const { hasCredentialMembershipForEmail } = require('../services/org-admin-service');
const {
  completeLogin,
  requireAnonymous,
  requirePendingSecondFactor
} = require('../middleware/auth');
const { authorize } = require('../middleware/authorization');

const router = express.Router();

router.get('/auth/register', requireAnonymous, (req, res) => {
  captureReturnTo(req);
  res.render('pages/auth-register', buildRegisterView(req));
});

router.post('/auth/register', requireAnonymous, authorize('auth.register'), async (req, res, next) => {
  try {
    const user = await registerUser(req.body);
    req.session.pendingSecondFactorUserId = user.id;
    req.session.pendingSecondFactorMethod = user.preferredMfa;
    if (shouldCreateSubscriptionDraft(req.body)) {
      req.session.subscriptionDraft = buildSubscriptionDraft(req.body, user);
    } else {
      delete req.session.subscriptionDraft;
    }

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

router.get('/auth/login', requireAnonymous, async (req, res, next) => {
  try {
    captureReturnTo(req);
    res.render('pages/auth-login', {
      title: 'Sign in',
      description: 'Sign in to Vanguard Cloud Services - Aegis ID.',
      formValues: { email: normalizeEmail(req.query.email || '') },
      passkeyLoginEnabled: await isFirstFactorEnabled('passkey'),
      errorMessage: req.session.authError || null
    });
    req.session.authError = null;
  } catch (error) {
    next(error);
  }
});

router.post('/auth/login', requireAnonymous, authorize('auth.login'), (req, res, next) => {
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

      // Local test accounts skip the second factor so an automated journey can
      // sign in without reading a mailbox. Gated by isLocalTestRequest, which
      // requires the flag, a non-production build, and a loopback request.
      if (user.testAccount === true && isLocalTestRequest(req)) {
        return req.logIn(user, async (loginError) => {
          if (loginError) {
            return next(loginError);
          }
          await writeAuditEvent('auth.login.local-test-mode', {
            userId: user.id,
            email: user.email,
            secondFactor: 'bypassed'
          });
          return res.redirect(303, req.session.returnTo || '/');
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

router.post('/auth/verify', requirePendingSecondFactor, authorize('auth.secondFactor'), async (req, res, next) => {
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

router.post('/auth/verify/resend', requirePendingSecondFactor, authorize('auth.secondFactor'), async (req, res, next) => {
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

// --- passkey as a first factor -------------------------------------------
//
// These two are anonymous: nobody has identified themselves yet. The challenge
// lives in the session rather than on a user record, because which account is
// signing in is only known once the authenticator answers.

router.post('/auth/passkeys/login/options', requireAnonymous, authorize('auth.passkey'), async (req, res, next) => {
  try {
    if (!(await isFirstFactorEnabled('passkey'))) {
      return res.status(403).json({ error: 'Passkey sign-in is not enabled.' });
    }

    const attempt = rateLimit.consume(`passkey-login:ip:${req.ip}`, { limit: 20, windowMs: 15 * 60 * 1000 });
    if (!attempt.allowed) {
      return res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
    }

    const { options, rpId, origin } = await startPasskeyLogin(getPasskeyRequestInfo(req));
    req.session.passkeyLogin = {
      challenge: options.challenge,
      rpId,
      origin,
      createdAt: new Date().toISOString()
    };
    return res.json(options);
  } catch (error) {
    return next(error);
  }
});

router.post('/auth/passkeys/login/verify', requireAnonymous, authorize('auth.passkey'), async (req, res, next) => {
  try {
    if (!(await isFirstFactorEnabled('passkey'))) {
      return res.status(403).json({ error: 'Passkey sign-in is not enabled.' });
    }

    const challenge = req.session.passkeyLogin;
    req.session.passkeyLogin = null; // single use, whatever the outcome
    const user = await finishPasskeyLogin(req.body, getPasskeyRequestInfo(req), challenge);

    // A verified passkey is possession plus inherence, so it completes the
    // sign-in on its own rather than handing off to a second factor.
    rateLimit.reset(`passkey-login:ip:${req.ip}`);
    await writeAuditEvent('auth.login.passkey', { userId: user.id, email: user.email });
    return await finishInteractiveLogin(req, res, user, 'passkey-login', true);
  } catch (error) {
    if (error.status === 422 || error.expose) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    return next(error);
  }
});

router.post('/auth/passkeys/register/options', requirePendingSecondFactor, authorize('auth.passkey'), async (req, res, next) => {
  try {
    const options = await startPasskeyRegistration(req.session.pendingSecondFactorUserId, getPasskeyRequestInfo(req));
    res.json(options);
  } catch (error) {
    next(error);
  }
});

router.post('/auth/passkeys/register/verify', requirePendingSecondFactor, authorize('auth.passkey'), async (req, res, next) => {
  try {
    const user = await getUserById(req.session.pendingSecondFactorUserId);
    await finishPasskeyRegistration(user.id, req.body, getPasskeyRequestInfo(req));
    await finishInteractiveLogin(req, res, user, 'passkey-registration', true);
  } catch (error) {
    next(error);
  }
});

router.post('/auth/passkeys/authenticate/options', requirePendingSecondFactor, authorize('auth.passkey'), async (req, res, next) => {
  try {
    const options = await startPasskeyAuthentication(req.session.pendingSecondFactorUserId, getPasskeyRequestInfo(req));
    res.json(options);
  } catch (error) {
    next(error);
  }
});

router.post('/auth/passkeys/authenticate/verify', requirePendingSecondFactor, authorize('auth.passkey'), async (req, res, next) => {
  try {
    const user = await getUserById(req.session.pendingSecondFactorUserId);
    await finishPasskeyAuthentication(user.id, req.body, getPasskeyRequestInfo(req));
    await finishInteractiveLogin(req, res, user, 'passkey-authentication', true);
  } catch (error) {
    next(error);
  }
});

router.get('/auth/forgot', requireAnonymous, (req, res) => {
  res.render('pages/auth-forgot', {
    title: 'Reset your password',
    description: 'Request a password reset link for Vanguard Aegis ID.',
    formValues: { email: '' },
    sent: false
  });
});

router.post('/auth/forgot', requireAnonymous, authorize('auth.passwordReset'), async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();

    // Throttle by address and by caller. When the budget is spent we still
    // render the same confirmation, so a rate limit cannot be used to probe
    // which addresses exist.
    const byEmail = rateLimit.consume(`forgot:email:${email}`, { limit: 3, windowMs: 15 * 60 * 1000 });
    const byIp = rateLimit.consume(`forgot:ip:${req.ip}`, { limit: 10, windowMs: 15 * 60 * 1000 });

    if (byEmail.allowed && byIp.allowed) {
      await requestPasswordReset(email, {
        baseUrl: config.app.publicBaseUrl,
        context: { ip: req.ip }
      });
    } else {
      await writeAuditEvent('auth.password-reset.throttled', { email, ip: req.ip });
    }

    return res.render('pages/auth-forgot', {
      title: 'Reset your password',
      description: 'Request a password reset link for Vanguard Aegis ID.',
      formValues: { email: '' },
      sent: true,
      expiresInMinutes: TOKEN_TTL_MINUTES
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/auth/reset/:token', requireAnonymous, async (req, res, next) => {
  try {
    const resolved = await resolveResetToken(req.params.token);
    return res.render('pages/auth-reset', {
      title: 'Choose a new password',
      description: 'Set a new password for your Vanguard Aegis ID account.',
      token: req.params.token,
      valid: Boolean(resolved),
      errorMessage: null
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/auth/reset/:token', requireAnonymous, authorize('auth.passwordReset'), async (req, res, next) => {
  try {
    const attempt = rateLimit.consume(`reset:ip:${req.ip}`, { limit: 10, windowMs: 15 * 60 * 1000 });
    if (!attempt.allowed) {
      return res.status(429).render('pages/auth-reset', {
        title: 'Choose a new password',
        description: 'Set a new password for your Vanguard Aegis ID account.',
        token: req.params.token,
        valid: true,
        errorMessage: 'Too many attempts. Try again in a few minutes.'
      });
    }

    if (String(req.body.password || '') !== String(req.body.confirmPassword || '')) {
      return res.status(422).render('pages/auth-reset', {
        title: 'Choose a new password',
        description: 'Set a new password for your Vanguard Aegis ID account.',
        token: req.params.token,
        valid: true,
        errorMessage: 'Passwords must match.'
      });
    }

    await completePasswordReset(req.params.token, req.body.password, { context: { ip: req.ip } });
    rateLimit.reset(`reset:ip:${req.ip}`);
    req.session.authError = 'Your password has been changed. Sign in with your new password.';
    return res.redirect(303, '/auth/login');
  } catch (error) {
    if (error.expose) {
      return res.status(error.status || 400).render('pages/auth-reset', {
        title: 'Choose a new password',
        description: 'Set a new password for your Vanguard Aegis ID account.',
        token: req.params.token,
        valid: error.status !== 400,
        errorMessage: error.message
      });
    }
    return next(error);
  }
});

router.post('/auth/logout', authorize('auth.logout'), (req, res, next) => {
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
  const postAuthState = await getPostAuthState(req, user);
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

async function getPostAuthState(req, user) {
  const hasCredentialMembership = await hasCredentialMembershipForEmail(user.email);
  if (hasCredentialMembership) {
    const accountAccessSubscription = await ensureAccountAccessSubscription(user);
    return {
      redirectUrl: `/organizations/${accountAccessSubscription.id}`,
      subscriptionDraft: null
    };
  }

  const redirectUrl = req.session.returnTo || (req.session.subscriptionDraft ? '/subscribe' : '/');
  return {
    redirectUrl,
    subscriptionDraft: req.session.subscriptionDraft || null
  };
}

function restorePostAuthState(req, postAuthState) {
  if (postAuthState.subscriptionDraft) {
    req.session.subscriptionDraft = postAuthState.subscriptionDraft;
  } else {
    delete req.session.subscriptionDraft;
  }
  delete req.session.pendingSecondFactorUserId;
  delete req.session.pendingSecondFactorMethod;
  delete req.session.secondFactorDelivery;
  delete req.session.returnTo;
}

function buildRegisterView(req, overrides = {}) {
  const formValues = {
    displayName: '',
    email: normalizeEmail(req.query.email || ''),
    phone: '',
    organization: '',
    plan: 'pilot',
    interest: 'both',
    preferredMfa: config.auth.defaultMfaMethod,
    ...(req.session?.subscriptionDraft || {}),
    ...(overrides.formValues || {})
  };
  delete formValues.password;
  delete formValues.confirmPassword;

  return {
    title: 'Create account',
    description: 'Create a Vanguard Cloud Services - Aegis ID account.',
    formValues,
    formErrors: overrides.formErrors || {},
    errorMessage: overrides.errorMessage || null
  };
}

function shouldCreateSubscriptionDraft(input = {}) {
  return Boolean(String(input.organization || '').trim());
}

function captureReturnTo(req) {
  const returnTo = normalizeReturnTo(req.query.returnTo);
  if (returnTo) {
    req.session.returnTo = returnTo;
  }
}

function normalizeReturnTo(value = '') {
  const candidate = String(value || '').trim();
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) {
    return '';
  }
  return candidate;
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
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
