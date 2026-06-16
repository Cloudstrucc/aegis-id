const express = require('express');

const { requireAuthenticated } = require('../middleware/auth');
const { getSubscriptionForUser } = require('../services/subscription-service');
const {
  buildDashboardView,
  buildWizardView,
  getWorkspaceForSubscription,
  getOrCreateWorkspace,
  getPlatformDefinition,
  listWorkspacesForSubscription,
  runPlatformTest,
  savePlatformStep
} = require('../services/platform-service');
const { listIssuerOrganizations } = require('../services/issuer-organization-service');
const { getOrgAdminView } = require('../services/org-admin-service');
const { writeAuditEvent } = require('../services/audit-service');

const router = express.Router();
router.use('/dashboard', requireAuthenticated);

router.get('/dashboard/:subscriptionId', async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const workspaces = await listWorkspacesForSubscription(subscription);
    if (workspaces.length === 0) {
      return res.redirect(303, `/organizations/${subscription.id}`);
    }
    if (workspaces.length > 1) {
      return res.redirect(303, `/organizations/${subscription.id}`);
    }
    return res.redirect(303, `${workspaces[0].dashboardPath}${req.query.welcome === '1' ? '?welcome=1' : ''}`);
  } catch (error) {
    next(error);
  }
});

router.get('/dashboard/:subscriptionId/orgs/:workspaceId', async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const workspace = await loadWorkspace(subscription, req.params.workspaceId);
    const issuerOrganizations = await listIssuerOrganizations(subscription.id, workspace.id);
    const orgAdmin = await getOrgAdminView(workspace, subscription);
    res.render('pages/dashboard', {
      ...buildDashboardView(subscription, workspace),
      issuerOrganizations,
      hasIssuerOrganizations: issuerOrganizations.length > 0,
      orgAdmin,
      welcome: req.query.welcome === '1'
    });
  } catch (error) {
    next(error);
  }
});

router.get('/dashboard/:subscriptionId/platforms/:platformId/setup', async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const workspace = await getOrCreateWorkspace(subscription);
    res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}/platforms/${req.params.platformId}/setup?step=${req.query.step || '0'}`);
  } catch (error) {
    next(error);
  }
});

router.get('/dashboard/:subscriptionId/orgs/:workspaceId/platforms/:platformId/setup', async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const workspace = await loadWorkspace(subscription, req.params.workspaceId);
    getPlatformDefinition(req.params.platformId);

    res.render(
      'pages/platform-wizard',
      buildWizardView(subscription, workspace, req.params.platformId, Number.parseInt(req.query.step || '0', 10))
    );
  } catch (error) {
    next(error);
  }
});

router.post('/dashboard/:subscriptionId/platforms/:platformId/setup', async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const workspace = await getOrCreateWorkspace(subscription);
    const platform = getPlatformDefinition(req.params.platformId);
    const stepIndex = Number.parseInt(req.body.stepIndex || '0', 10);
    const step = platform.steps[stepIndex];
    if (step) {
      await savePlatformStep(subscription, platform.id, step.id, req.body, workspace.id);
    }
    const nextStep = stepIndex < platform.steps.length - 1 ? stepIndex + 1 : stepIndex;
    res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}/platforms/${req.params.platformId}/setup?step=${nextStep}`);
  } catch (error) {
    next(error);
  }
});

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/platforms/:platformId/setup', async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const platform = getPlatformDefinition(req.params.platformId);
    const stepIndex = Number.parseInt(req.body.stepIndex || '0', 10);
    const step = platform.steps[stepIndex];
    if (!step) {
      const error = new Error('Unknown setup step.');
      error.status = 404;
      throw error;
    }

    await savePlatformStep(subscription, platform.id, step.id, req.body, req.params.workspaceId);
    await writeAuditEvent('platform.setup.saved', {
      subscriptionId: subscription.id,
      workspaceId: req.params.workspaceId,
      platformId: platform.id,
      stepId: step.id
    });

    const nextStep = stepIndex < platform.steps.length - 1 ? stepIndex + 1 : stepIndex;
    res.redirect(303, `/dashboard/${subscription.id}/orgs/${req.params.workspaceId}/platforms/${platform.id}/setup?step=${nextStep}`);
  } catch (error) {
    next(error);
  }
});

router.post('/dashboard/:subscriptionId/platforms/:platformId/test', async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const workspace = await getOrCreateWorkspace(subscription);
    const platform = getPlatformDefinition(req.params.platformId);
    const testStep = platform.steps.find((step) => step.testStep);
    if (testStep) {
      await savePlatformStep(subscription, platform.id, testStep.id, req.body, workspace.id);
    }
    await runPlatformTest(subscription, platform.id, req.body, workspace.id);
    const testStepIndex = Math.max(0, platform.steps.findIndex((step) => step.testStep));
    res.redirect(303, `/dashboard/${subscription.id}/orgs/${workspace.id}/platforms/${req.params.platformId}/setup?step=${testStepIndex}`);
  } catch (error) {
    next(error);
  }
});

router.post('/dashboard/:subscriptionId/orgs/:workspaceId/platforms/:platformId/test', async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const platform = getPlatformDefinition(req.params.platformId);
    const testStep = platform.steps.find((step) => step.testStep);

    if (testStep) {
      await savePlatformStep(subscription, platform.id, testStep.id, req.body, req.params.workspaceId);
    }

    const result = await runPlatformTest(subscription, platform.id, req.body, req.params.workspaceId);
    await writeAuditEvent('platform.test.completed', {
      subscriptionId: subscription.id,
      workspaceId: req.params.workspaceId,
      platformId: platform.id,
      ok: result.ok,
      mode: result.mode || req.body.testMode || 'metadata'
    });

    const testStepIndex = Math.max(0, platform.steps.findIndex((step) => step.testStep));
    res.redirect(303, `/dashboard/${subscription.id}/orgs/${req.params.workspaceId}/platforms/${platform.id}/setup?step=${testStepIndex}`);
  } catch (error) {
    const subscription = await getSubscriptionForUser(req.params.subscriptionId, req.user);
    if (!subscription) {
      return next(error);
    }

    const platform = getPlatformDefinition(req.params.platformId);
    const workspace = await getOrCreateWorkspace(subscription, req.params.workspaceId);
    const testStepIndex = Math.max(0, platform.steps.findIndex((step) => step.testStep));
    const viewModel = buildWizardView(subscription, workspace, platform.id, testStepIndex);
    return res.status(error.status || 500).render('pages/platform-wizard', {
      ...viewModel,
      testResult: {
        ok: false,
        title: 'Test failed',
        message: error.message,
        checkedAt: new Date().toISOString(),
        details: error.details || {}
      }
    });
  }
});

async function loadSubscription(req) {
  const subscription = await getSubscriptionForUser(req.params.subscriptionId, req.user);
  if (!subscription) {
    const error = new Error('Subscriber dashboard not found.');
    error.status = 404;
    throw error;
  }
  return subscription;
}

async function loadWorkspace(subscription, workspaceId) {
  const workspace = await getWorkspaceForSubscription(subscription, workspaceId);
  if (!workspace) {
    const error = new Error('Organization workspace not found for this subscriber.');
    error.status = 404;
    throw error;
  }
  return workspace;
}

module.exports = router;
