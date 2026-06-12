const express = require('express');

const { getSubscription } = require('../services/subscription-service');
const {
  buildDashboardView,
  buildWizardView,
  getOrCreateWorkspace,
  getPlatformDefinition,
  runPlatformTest,
  savePlatformStep
} = require('../services/platform-service');
const { writeAuditEvent } = require('../services/audit-service');

const router = express.Router();

router.get('/dashboard/:subscriptionId', async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req.params.subscriptionId);
    const workspace = await getOrCreateWorkspace(subscription);
    res.render('pages/dashboard', {
      ...buildDashboardView(subscription, workspace),
      welcome: req.query.welcome === '1'
    });
  } catch (error) {
    next(error);
  }
});

router.get('/dashboard/:subscriptionId/platforms/:platformId/setup', async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req.params.subscriptionId);
    const workspace = await getOrCreateWorkspace(subscription);
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
    const subscription = await loadSubscription(req.params.subscriptionId);
    const platform = getPlatformDefinition(req.params.platformId);
    const stepIndex = Number.parseInt(req.body.stepIndex || '0', 10);
    const step = platform.steps[stepIndex];
    if (!step) {
      const error = new Error('Unknown setup step.');
      error.status = 404;
      throw error;
    }

    await savePlatformStep(subscription, platform.id, step.id, req.body);
    await writeAuditEvent('platform.setup.saved', {
      subscriptionId: subscription.id,
      platformId: platform.id,
      stepId: step.id
    });

    const nextStep = stepIndex < platform.steps.length - 1 ? stepIndex + 1 : stepIndex;
    res.redirect(303, `/dashboard/${subscription.id}/platforms/${platform.id}/setup?step=${nextStep}`);
  } catch (error) {
    next(error);
  }
});

router.post('/dashboard/:subscriptionId/platforms/:platformId/test', async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req.params.subscriptionId);
    const platform = getPlatformDefinition(req.params.platformId);
    const testStep = platform.steps.find((step) => step.testStep);

    if (testStep) {
      await savePlatformStep(subscription, platform.id, testStep.id, req.body);
    }

    const result = await runPlatformTest(subscription, platform.id, req.body);
    await writeAuditEvent('platform.test.completed', {
      subscriptionId: subscription.id,
      platformId: platform.id,
      ok: result.ok,
      mode: result.mode || req.body.testMode || 'metadata'
    });

    const testStepIndex = Math.max(0, platform.steps.findIndex((step) => step.testStep));
    res.redirect(303, `/dashboard/${subscription.id}/platforms/${platform.id}/setup?step=${testStepIndex}`);
  } catch (error) {
    const subscription = await getSubscription(req.params.subscriptionId);
    if (!subscription) {
      return next(error);
    }

    const platform = getPlatformDefinition(req.params.platformId);
    const workspace = await getOrCreateWorkspace(subscription);
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

async function loadSubscription(subscriptionId) {
  const subscription = await getSubscription(subscriptionId);
  if (!subscription) {
    const error = new Error('Subscriber dashboard not found.');
    error.status = 404;
    throw error;
  }
  return subscription;
}

module.exports = router;
