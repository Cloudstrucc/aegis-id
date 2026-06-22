const { canViewAdminOperations } = require('../services/admin-access-service');

function attachAuthLocals(req, res, next) {
  res.locals.currentUser = req.user || null;
  res.locals.isAuthenticated = Boolean(req.user);
  res.locals.canViewHealth = false;

  if (!req.user) {
    return next();
  }

  return canViewAdminOperations(req.user)
    .then((canViewHealth) => {
      res.locals.canViewHealth = canViewHealth;
      next();
    })
    .catch(next);
}

function requireAuthenticated(req, res, next) {
  if (req.isAuthenticated?.() && req.user) {
    return next();
  }

  if (acceptsJson(req)) {
    return res.status(401).json({ error: { message: 'Authentication required.' } });
  }

  req.session.returnTo = req.originalUrl;
  return res.redirect(303, '/auth/login');
}

function requireAnonymous(req, res, next) {
  if (req.isAuthenticated?.() && req.user) {
    return res.redirect(303, '/account');
  }
  return next();
}

function requirePendingSecondFactor(req, res, next) {
  if (req.session?.pendingSecondFactorUserId) {
    return next();
  }
  return res.redirect(303, '/auth/login');
}

function completeLogin(req, user) {
  return new Promise((resolve, reject) => {
    req.logIn(user, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function acceptsJson(req) {
  return req.path.startsWith('/api') || req.get('accept')?.includes('application/json');
}

module.exports = {
  attachAuthLocals,
  completeLogin,
  requireAnonymous,
  requireAuthenticated,
  requirePendingSecondFactor
};
