const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDashboardView,
  buildMetadataUrl,
  buildWizardView,
  getPlatformDefinition
} = require('../src/services/platform-service');

test('dashboard view exposes Microsoft, Keycloak, Okta, and generic federation platforms', () => {
  const subscription = { id: 'sub-1', email: 'identity@vanguardcs.ca' };
  const workspace = { id: 'org-1', subscriptionId: 'sub-1', organization: 'Vanguard Cloud Services', platforms: {} };
  const view = buildDashboardView(subscription, workspace);

  assert.deepEqual(
    view.platforms.map((platform) => platform.id),
    ['microsoft-verified-id', 'keycloak', 'okta', 'generic-oidc-saml']
  );
  assert.equal(view.connectedCount, 0);
});

test('wizard view does not prefill one-time Microsoft client secret', () => {
  const subscription = { id: 'sub-1', email: 'identity@vanguardcs.ca' };
  const workspace = {
    subscriptionId: 'sub-1',
    id: 'org-1',
    organization: 'Vanguard Cloud Services',
    platforms: {
      'microsoft-verified-id': {
        status: 'configured',
        completedSteps: ['tenant', 'did-org', 'app-registration', 'claims'],
        data: {
          oneTimeClientSecret: 'should-not-render',
          testMode: 'live'
        }
      }
    }
  };
  const platform = getPlatformDefinition('microsoft-verified-id');
  const testStepIndex = platform.steps.findIndex((step) => step.testStep);
  const view = buildWizardView(subscription, workspace, 'microsoft-verified-id', testStepIndex);
  const secretField = view.currentStep.fields.find((field) => field.name === 'oneTimeClientSecret');

  assert.equal(secretField.value, '');
  assert.equal(secretField.persist, false);
});

test('Keycloak OIDC metadata URL can be derived from base URL and realm', () => {
  const url = buildMetadataUrl(
    'keycloak',
    {
      baseUrl: 'https://idp.vanguardcs.ca/',
      realm: 'vanguard'
    },
    'oidc'
  );

  assert.equal(url, 'https://idp.vanguardcs.ca/realms/vanguard/.well-known/openid-configuration');
});

test('Microsoft platform has a live test step', () => {
  const platform = getPlatformDefinition('microsoft-verified-id');
  const testStep = platform.steps.find((step) => step.testStep);

  assert.equal(testStep.id, 'test');
  assert.equal(testStep.fields.some((field) => field.name === 'oneTimeClientSecret'), true);
});

test('all setup wizard fields include tooltip help text', () => {
  for (const platformId of ['microsoft-verified-id', 'keycloak', 'okta', 'generic-oidc-saml']) {
    const platform = getPlatformDefinition(platformId);
    for (const step of platform.steps) {
      for (const field of step.fields) {
        assert.equal(typeof field.helpText, 'string', `${platformId}.${step.id}.${field.name}`);
        assert.ok(field.helpText.length > 20, `${platformId}.${step.id}.${field.name}`);
      }
    }
  }
});
