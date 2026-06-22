const { getSubscriptionForUser } = require('../services/subscription-service');
const {
  getOrCreateWorkspace,
  getWorkspaceForSubscription
} = require('../services/platform-service');
const { assertOrgPrivilege } = require('../services/org-admin-service');
const { assertAdminOperations } = require('../services/admin-access-service');
const { requirePolicy } = require('../services/authorization-service');

function authorize(policyId, options = {}) {
  const selectedPolicy = requirePolicy(policyId);

  async function authorizationMiddleware(req, res, next) {
    try {
      req.authorizationPolicy = selectedPolicy;
      res.locals.authorizationPolicy = selectedPolicy;

      if (selectedPolicy.type === 'public' || selectedPolicy.type === 'external') {
        return next();
      }

      if (selectedPolicy.type === 'anonymous') {
        return next();
      }

      ensureAuthenticated(req, res);

      if (selectedPolicy.type === 'authenticated') {
        return next();
      }

      if (selectedPolicy.type === 'adminAnyWorkspace') {
        await assertAdminOperations(req.user);
        return next();
      }

      const subscription = await loadAuthorizedSubscription(req);
      req.authorizedSubscription = subscription;

      if (selectedPolicy.type === 'subscription') {
        return next();
      }

      if (selectedPolicy.type === 'orgPrivilege') {
        const workspace = await loadAuthorizedWorkspace(req, subscription, options);
        req.authorizedWorkspace = workspace;
        await assertOrgPrivilege(workspace, subscription, selectedPolicy.privilegeId);
        return next();
      }

      return next();
    } catch (error) {
      return next(error);
    }
  }

  authorizationMiddleware.authorizationPolicy = policyId;
  authorizationMiddleware.authorizationType = selectedPolicy.type;
  return authorizationMiddleware;
}

async function loadAuthorizedSubscription(req) {
  const subscriptionId = req.params.subscriptionId || req.body.subscriptionId || req.query.subscriptionId;
  const subscription = await getSubscriptionForUser(subscriptionId, req.user);
  if (!subscription) {
    const error = new Error('Subscriber session not found.');
    error.status = 404;
    throw error;
  }
  return subscription;
}

async function loadAuthorizedWorkspace(req, subscription, options = {}) {
  const workspaceId = req.params.workspaceId || req.body.workspaceId || req.query.workspaceId;
  const workspace = workspaceId
    ? await getWorkspaceForSubscription(subscription, workspaceId)
    : options.createDefaultWorkspace
      ? await getOrCreateWorkspace(subscription)
      : await getWorkspaceForSubscription(subscription, workspaceId);

  if (!workspace) {
    const error = new Error('Organization workspace not found for this subscriber.');
    error.status = 404;
    throw error;
  }
  return workspace;
}

function ensureAuthenticated(req, res) {
  if (req.isAuthenticated?.() && req.user) {
    return;
  }

  const error = new Error('Authentication required.');
  error.status = 401;
  error.expose = true;

  if (!req.path.startsWith('/api') && !req.get('accept')?.includes('application/json')) {
    error.redirectTo = '/auth/login';
  }
  throw error;
}

module.exports = {
  authorize
};
