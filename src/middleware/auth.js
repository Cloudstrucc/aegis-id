const { canViewAdminOperations } = require('../services/admin-access-service');
const { listCredentialMembershipsForEmail } = require('../services/org-admin-service');

function attachAuthLocals(req, res, next) {
  res.locals.currentUser = req.user || null;
  res.locals.isAuthenticated = Boolean(req.user);
  res.locals.canViewHealth = false;
  res.locals.headerProfile = null;

  if (!req.user) {
    return next();
  }

  return Promise.all([canViewAdminOperations(req.user), listCredentialMembershipsForEmail(req.user.email)])
    .then(([canViewHealth, memberships]) => {
      res.locals.canViewHealth = canViewHealth;
      res.locals.headerProfile = buildHeaderProfile(req.user, memberships);
      next();
    })
    .catch(next);
}

function buildHeaderProfile(user, memberships = []) {
  return {
    displayName: user.displayName || user.email,
    initials: initialsFromName(user.displayName || user.email),
    email: user.email,
    phone: user.phone || 'Not provided',
    preferredMfa: user.preferredMfa || 'Not configured',
    passkeyCount: user.passkeyCount || 0,
    lastSecondFactorAtLabel: formatProfileDate(user.lastSecondFactorAt),
    createdAtLabel: formatProfileDate(user.createdAt),
    organizations: memberships.map((membership) => ({
      organizationName: membership.organizationName,
      persona: membership.personTypeLabel,
      status: membership.statusLabel,
      roleSummary: membership.roleLabels?.length ? membership.roleLabels.join(', ') : 'No roles assigned'
    })),
    hasOrganizations: memberships.length > 0
  };
}

function initialsFromName(value = '') {
  const words = String(value || '')
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
  if (!words.length) {
    return 'ID';
  }
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function formatProfileDate(value) {
  if (!value) {
    return 'Not recorded';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Not recorded';
  }
  return date.toISOString().slice(0, 10);
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
