const { canViewAdminOperations } = require('../services/admin-access-service');
const { listTenantsForUser } = require('../services/tenant-access-service');

/**
 * What the header and the profile modal need to know about the viewer.
 *
 * `canViewHealth` keeps its name and its meaning — it is the platform gate, and
 * what the "Platform" link in the header is shown on. The tenant list is
 * separate and comes from organization membership, so an invited administrator
 * gets a working Settings link and a tenant switcher without the platform link
 * appearing at all.
 */
function attachAuthLocals(req, res, next) {
  res.locals.currentUser = req.user || null;
  res.locals.isAuthenticated = Boolean(req.user);
  res.locals.canViewHealth = false;
  res.locals.headerProfile = null;
  res.locals.tenants = [];
  res.locals.currentTenant = null;
  res.locals.canAdministerTenant = false;

  if (!req.user) {
    return next();
  }

  return Promise.all([canViewAdminOperations(req.user), listTenantsForUser(req.user)])
    .then(([canViewHealth, tenants]) => {
      const administered = tenants.filter((tenant) => tenant.isAdmin && tenant.settingsPath);
      // Whichever organization the current URL is about, else the first one
      // this person administers, else the first they belong to — so the
      // switcher always has something selected.
      const current = tenants.find((tenant) => tenant.handle && req.path.startsWith(`/orgs/${tenant.handle}`))
        || administered[0]
        || tenants[0]
        || null;

      res.locals.canViewHealth = canViewHealth;
      res.locals.isGlobalAdmin = canViewHealth;
      res.locals.tenants = tenants;
      res.locals.administeredTenants = administered;
      res.locals.currentTenant = current;
      res.locals.canAdministerTenant = administered.length > 0;
      res.locals.headerProfile = buildHeaderProfile(req.user, tenants);
      next();
    })
    .catch(next);
}

function buildHeaderProfile(user, tenants = []) {
  return {
    displayName: user.displayName || user.email,
    initials: initialsFromName(user.displayName || user.email),
    email: user.email,
    phone: user.phone || 'Not provided',
    preferredMfa: user.preferredMfa || 'Not configured',
    passkeyCount: user.passkeyCount || 0,
    lastSecondFactorAtLabel: formatProfileDate(user.lastSecondFactorAt),
    createdAtLabel: formatProfileDate(user.createdAt),
    // Built from tenant memberships rather than from credentials alone, so the
    // role shown is the one that actually grants access — an owner or an
    // administrator previously read as "No roles assigned" here, because they
    // hold access through membership rather than through a credential role.
    organizations: tenants.map((tenant) => ({
      organizationName: tenant.organization,
      initials: tenant.initials,
      handle: tenant.handle,
      roleLabel: tenant.roleLabel,
      isAdmin: tenant.isAdmin,
      accessLabel: tenant.isAdmin ? 'Full access' : 'Credential holder',
      settingsPath: tenant.settingsPath
    })),
    hasOrganizations: tenants.length > 0
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
