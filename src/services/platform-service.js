const config = require('../config');
const FileJsonStore = require('./file-json-store');
const VerifiedIdClient = require('./verified-id-client');
const { buildDemoEmployeeClaims, getPresentationPolicy } = require('./credential-policy-service');

const store = new FileJsonStore(config.paths.subscriberWorkspaces, []);

const DEFAULT_REQUIRED_CLAIMS = 'employeeId, displayName, email, department, role, assuranceLevel, employmentStatus';

function getPlatformDefinitions() {
  return [
    {
      id: 'microsoft-verified-id',
      name: 'Microsoft Entra Verified ID',
      family: 'Verified ID / Azure',
      icon: 'MS',
      summary: 'Set up Cloudstrucc Inc. tenant details, issuer DID, credential contract, claims, and a wallet test.',
      docsUrl: 'https://learn.microsoft.com/en-us/entra/verified-id/verifiable-credentials-configure-tenant',
      steps: [
        {
          id: 'tenant',
          title: 'Tenant',
          description: 'Identify the Entra tenant and setup path for this subscriber.',
          fields: [
            textField('tenantDisplayName', 'Tenant display name', 'Cloudstrucc Inc.'),
            textField('azureTenantId', 'Azure tenant ID'),
            textField('adminDomain', 'Primary verified domain', 'cloudstrucc.com'),
            selectField('setupMode', 'Verified ID setup mode', [
              ['quick', 'Quick setup'],
              ['advanced', 'Advanced setup with Key Vault']
            ])
          ]
        },
        {
          id: 'did-org',
          title: 'DID Organization',
          description: 'Capture the organization identity Aegis ID should trust for issuance and verification.',
          fields: [
            textField('verifiedIdAuthorityDid', 'Issuer authority DID', 'did:web:cloudstrucc.com'),
            selectField('didMethod', 'DID method', [
              ['did:web', 'did:web'],
              ['did:ion', 'did:ion'],
              ['managed', 'Microsoft-managed DID']
            ]),
            textField('linkedDomain', 'Linked domain', 'cloudstrucc.com'),
            textField('keyVaultName', 'Key Vault name or reference')
          ]
        },
        {
          id: 'app-registration',
          title: 'App Registration',
          description: 'Record the non-secret app registration details used to call the Verified ID Request Service.',
          fields: [
            textField('azureClientId', 'Application client ID'),
            textField('secretReference', 'Client secret reference', 'Key Vault secret or App Service setting name'),
            urlField('manifestUrl', 'Credential manifest URL'),
            textField('callbackApiKeyReference', 'Callback API key reference', 'VID_CALLBACK_API_KEY')
          ]
        },
        {
          id: 'claims',
          title: 'Claims',
          description: 'Define the credential type and the claims Aegis ID should request, issue, and verify.',
          fields: [
            textField('credentialType', 'Credential type', 'CloudstruccEmployeeCredential'),
            textareaField('requiredClaims', 'Required claims', DEFAULT_REQUIRED_CLAIMS),
            textareaField('optionalClaims', 'Optional claims', 'manager, costCenter, region'),
            textField('sampleSubjectEmail', 'Sample test subject email', 'identity@cloudstrucc.com')
          ]
        },
        {
          id: 'test',
          title: 'Test',
          description: 'Create a mock or live Verified ID request. A live test uses a one-time client secret and does not store it.',
          testStep: true,
          fields: [
            selectField('testMode', 'Test mode', [
              ['mock', 'Mock request'],
              ['live', 'Live Microsoft Verified ID request']
            ]),
            passwordField('oneTimeClientSecret', 'One-time Azure client secret')
          ]
        }
      ]
    },
    {
      id: 'keycloak',
      name: 'Keycloak',
      family: 'OIDC / SAML',
      icon: 'KC',
      summary: 'Connect a Keycloak realm, client, scopes, protocol mappers, and claims to Aegis ID.',
      docsUrl: 'https://www.keycloak.org/docs/latest/server_admin/index.html',
      steps: [
        {
          id: 'realm',
          title: 'Realm',
          description: 'Point Aegis ID at the Keycloak realm that will federate users.',
          fields: [
            urlField('baseUrl', 'Keycloak base URL', 'https://idp.example.com'),
            textField('realm', 'Realm', 'cloudstrucc'),
            selectField('protocol', 'Protocol', [
              ['oidc', 'OpenID Connect'],
              ['saml', 'SAML 2.0']
            ])
          ]
        },
        {
          id: 'client',
          title: 'Client',
          description: 'Capture the relying-party client or SAML service provider registration.',
          fields: [
            textField('clientId', 'Client ID'),
            textField('clientSecretReference', 'Client secret reference'),
            urlField('redirectUri', 'Redirect URI', `${config.app.publicBaseUrl}/auth/keycloak/callback`),
            urlField('metadataUrl', 'Metadata or discovery URL')
          ]
        },
        {
          id: 'claims',
          title: 'Claims',
          description: 'Map realm roles, groups, and profile values into Aegis ID claims.',
          fields: [
            textareaField('claimMappings', 'Claim mappings', 'email -> email\npreferred_username -> username\ngroups -> groups\nrealm_access.roles -> roles'),
            textareaField('requiredClaims', 'Required claims', 'email, username, groups')
          ]
        },
        {
          id: 'test',
          title: 'Test',
          description: 'Validate OIDC discovery or SAML metadata reachability.',
          testStep: true,
          fields: [selectField('testMode', 'Test mode', [['metadata', 'Metadata discovery']])]
        }
      ]
    },
    {
      id: 'okta',
      name: 'Okta',
      family: 'OIDC / SAML',
      icon: 'OK',
      summary: 'Connect an Okta org, app integration, authorization server, groups claim, and test metadata.',
      docsUrl: 'https://developer.okta.com/docs/guides/build-sso-integration/openidconnect/main/',
      steps: [
        {
          id: 'org',
          title: 'Org',
          description: 'Capture the Okta org and preferred SSO protocol.',
          fields: [
            urlField('oktaOrgUrl', 'Okta org URL', 'https://example.okta.com'),
            urlField('issuerUrl', 'Authorization server issuer URL', 'https://example.okta.com/oauth2/default'),
            selectField('protocol', 'Protocol', [
              ['oidc', 'OpenID Connect'],
              ['saml', 'SAML 2.0']
            ])
          ]
        },
        {
          id: 'app',
          title: 'App Integration',
          description: 'Record the app integration values Aegis ID will use.',
          fields: [
            textField('clientId', 'Client ID'),
            textField('clientSecretReference', 'Client secret reference'),
            urlField('redirectUri', 'Redirect URI', `${config.app.publicBaseUrl}/auth/okta/callback`),
            urlField('metadataUrl', 'SAML metadata URL')
          ]
        },
        {
          id: 'claims',
          title: 'Claims',
          description: 'Map Okta profile, group, and entitlement claims.',
          fields: [
            textareaField('claimMappings', 'Claim mappings', 'email -> email\ngroups -> groups\ndepartment -> department'),
            textField('groupsFilter', 'Groups claim filter', 'Cloudstrucc-*')
          ]
        },
        {
          id: 'test',
          title: 'Test',
          description: 'Validate OIDC discovery or SAML metadata reachability.',
          testStep: true,
          fields: [selectField('testMode', 'Test mode', [['metadata', 'Metadata discovery']])]
        }
      ]
    },
    {
      id: 'generic-oidc-saml',
      name: 'Generic OIDC / SAML',
      family: 'Federation',
      icon: 'ID',
      summary: 'Connect any standards-based identity provider with OIDC discovery or SAML metadata.',
      docsUrl: 'https://openid.net/specs/openid-connect-discovery-1_0.html',
      steps: [
        {
          id: 'provider',
          title: 'Provider',
          description: 'Capture provider metadata and protocol preference.',
          fields: [
            textField('providerName', 'Provider name'),
            selectField('protocol', 'Protocol', [
              ['oidc', 'OpenID Connect'],
              ['saml', 'SAML 2.0']
            ]),
            urlField('issuerUrl', 'OIDC issuer URL'),
            urlField('metadataUrl', 'OIDC discovery or SAML metadata URL')
          ]
        },
        {
          id: 'relying-party',
          title: 'Relying Party',
          description: 'Record the application registration values.',
          fields: [
            textField('clientId', 'Client ID / Entity ID'),
            textField('secretOrCertReference', 'Secret or certificate reference'),
            urlField('callbackOrAcsUrl', 'Callback / ACS URL', `${config.app.publicBaseUrl}/auth/federation/callback`)
          ]
        },
        {
          id: 'claims',
          title: 'Claims',
          description: 'Normalize claims into the Aegis ID policy vocabulary.',
          fields: [
            textareaField('claimMappings', 'Claim mappings', 'email -> email\nname -> displayName\ngroups -> groups'),
            textareaField('requiredClaims', 'Required claims', 'email, displayName')
          ]
        },
        {
          id: 'test',
          title: 'Test',
          description: 'Validate OIDC discovery or SAML metadata reachability.',
          testStep: true,
          fields: [selectField('testMode', 'Test mode', [['metadata', 'Metadata discovery']])]
        }
      ]
    }
  ];
}

async function createWorkspaceForSubscription(subscription) {
  const workspaces = await store.read();
  let workspace = workspaces.find((item) => item.subscriptionId === subscription.id);

  if (workspace) {
    return workspace;
  }

  workspace = {
    id: subscription.id,
    subscriptionId: subscription.id,
    organization: subscription.organization || inferOrganization(subscription.email),
    ownerEmail: subscription.email,
    platforms: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  workspaces.push(workspace);
  await store.write(workspaces);
  return workspace;
}

async function getWorkspace(subscriptionId) {
  const workspaces = await store.read();
  return workspaces.find((workspace) => workspace.subscriptionId === subscriptionId) || null;
}

async function getOrCreateWorkspace(subscription) {
  return (await getWorkspace(subscription.id)) || createWorkspaceForSubscription(subscription);
}

async function savePlatformStep(subscription, platformId, stepId, input = {}) {
  const platform = getPlatformDefinition(platformId);
  const step = platform.steps.find((candidate) => candidate.id === stepId);
  if (!step) {
    throw notFound(`Unknown setup step: ${stepId}`);
  }

  const workspaces = await store.read();
  const workspace = await ensureWorkspaceInList(workspaces, subscription);
  const platformState = workspace.platforms[platformId] || createPlatformState(platformId);

  for (const field of step.fields) {
    if (field.persist === false || field.type === 'password') {
      continue;
    }
    const rawValue = input[field.name];
    platformState.data[field.name] = normalizeFieldValue(rawValue, field);
  }

  if (!platformState.completedSteps.includes(stepId)) {
    platformState.completedSteps.push(stepId);
  }
  platformState.status = computePlatformStatus(platform, platformState);
  platformState.updatedAt = new Date().toISOString();
  workspace.platforms[platformId] = platformState;
  workspace.updatedAt = new Date().toISOString();
  await store.write(workspaces);

  return platformState;
}

async function runPlatformTest(subscription, platformId, input = {}) {
  const platform = getPlatformDefinition(platformId);
  const workspaces = await store.read();
  const workspace = await ensureWorkspaceInList(workspaces, subscription);
  const platformState = workspace.platforms[platformId] || createPlatformState(platformId);

  const result =
    platformId === 'microsoft-verified-id'
      ? await runMicrosoftVerifiedIdTest(platformState, input)
      : await runFederationMetadataTest(platform, platformState, input);

  platformState.lastTestResult = result;
  platformState.status = result.ok ? 'connected' : 'attention';
  if (!platformState.completedSteps.includes('test')) {
    platformState.completedSteps.push('test');
  }
  platformState.updatedAt = new Date().toISOString();
  workspace.platforms[platformId] = platformState;
  workspace.updatedAt = new Date().toISOString();
  await store.write(workspaces);

  return result;
}

function getPlatformDefinition(platformId) {
  const platform = getPlatformDefinitions().find((candidate) => candidate.id === platformId);
  if (!platform) {
    throw notFound(`Unknown platform: ${platformId}`);
  }
  return platform;
}

function buildDashboardView(subscription, workspace) {
  const definitions = getPlatformDefinitions();
  const cards = definitions.map((platform) => {
    const state = workspace.platforms[platform.id] || createPlatformState(platform.id);
    const completed = state.completedSteps.length;
    const total = platform.steps.length;
    return {
      ...platform,
      status: state.status,
      statusLabel: statusLabel(state.status),
      completed,
      total,
      progressPercent: Math.round((completed / total) * 100),
      lastTestResult: state.lastTestResult || null
    };
  });

  return {
    title: 'Subscriber Dashboard',
    description: 'Cloudstrucc Aegis ID subscriber dashboard.',
    subscription,
    workspace,
    platforms: cards,
    connectedCount: cards.filter((card) => card.status === 'connected').length,
    inProgressCount: cards.filter((card) => ['in-progress', 'configured', 'attention'].includes(card.status)).length
  };
}

function buildWizardView(subscription, workspace, platformId, stepIndex = 0) {
  const platform = getPlatformDefinition(platformId);
  const state = workspace.platforms[platformId] || createPlatformState(platformId);
  const normalizedStepIndex = Math.max(0, Math.min(stepIndex, platform.steps.length - 1));
  const currentStep = platform.steps[normalizedStepIndex];
  const completed = new Set(state.completedSteps);

  return {
    title: `${platform.name} Setup`,
    description: `${platform.name} setup wizard for Cloudstrucc Aegis ID.`,
    subscription,
    workspace,
    platform,
    state,
    currentStep: decorateStep(currentStep, state, true, normalizedStepIndex),
    steps: platform.steps.map((step, index) => ({
      ...decorateStep(step, state, index === normalizedStepIndex, index),
      index,
      displayIndex: index + 1,
      completed: completed.has(step.id),
      active: index === normalizedStepIndex
    })),
    stepIndex: normalizedStepIndex,
    stepDisplayIndex: normalizedStepIndex + 1,
    previousStepIndex: normalizedStepIndex > 0 ? normalizedStepIndex - 1 : null,
    nextStepIndex: normalizedStepIndex < platform.steps.length - 1 ? normalizedStepIndex + 1 : null,
    hasPrevious: normalizedStepIndex > 0,
    hasNext: normalizedStepIndex < platform.steps.length - 1,
    progressPercent: Math.round((completed.size / platform.steps.length) * 100),
    testResult: state.lastTestResult || null
  };
}

function decorateStep(step, state, active = false, index = 0) {
  return {
    ...step,
    active,
    displayIndex: index + 1,
    fields: step.fields.map((field) => decorateField(field, state.data))
  };
}

function decorateField(field, data) {
  const value = field.persist === false || field.type === 'password' ? '' : data[field.name] ?? field.defaultValue ?? '';
  return {
    ...field,
    value,
    checked: Boolean(value),
    options: (field.options || []).map((option) => ({
      value: option.value,
      label: option.label,
      selected: option.value === value || (!value && option.value === field.defaultValue)
    }))
  };
}

async function runMicrosoftVerifiedIdTest(platformState, input) {
  const testMode = input.testMode || platformState.data.testMode || 'mock';
  const data = platformState.data;
  const oneTimeClientSecret = String(input.oneTimeClientSecret || '').trim();
  const effectiveMode = testMode === 'live' ? 'live' : 'mock';
  const client = new VerifiedIdClient({
    publicBaseUrl: config.app.publicBaseUrl,
    config: {
      ...config.verifiedId,
      mode: effectiveMode,
      tenantId: data.azureTenantId || config.verifiedId.tenantId,
      clientId: data.azureClientId || config.verifiedId.clientId,
      clientSecret: oneTimeClientSecret || config.verifiedId.clientSecret,
      authorityDid: data.verifiedIdAuthorityDid || config.verifiedId.authorityDid,
      manifestUrl: data.manifestUrl || config.verifiedId.manifestUrl,
      credentialType: data.credentialType || config.verifiedId.credentialType,
      callbackApiKey: config.verifiedId.callbackApiKey
    }
  });

  const claims = buildDemoEmployeeClaims({
    email: data.sampleSubjectEmail || 'identity@cloudstrucc.com'
  });

  const issuance = await client.createIssuanceRequest({
    credentialType: data.credentialType || config.verifiedId.credentialType,
    claims
  });
  const presentation = await client.createPresentationRequest({
    ...getPresentationPolicy(),
    credentialType: data.credentialType || config.verifiedId.credentialType,
    acceptedIssuers: [data.verifiedIdAuthorityDid || config.verifiedId.authorityDid || 'did:web:cloudstrucc.example']
  });

  return {
    ok: true,
    mode: effectiveMode,
    title: effectiveMode === 'live' ? 'Live Verified ID request created' : 'Mock Verified ID request created',
    message:
      effectiveMode === 'live'
        ? 'Aegis ID reached Microsoft Entra Verified ID with the supplied tenant/app configuration.'
        : 'Aegis ID generated local mock issuance and presentation requests.',
    checkedAt: new Date().toISOString(),
    details: {
      issuance: summarizeVerifiedIdResult(issuance),
      presentation: summarizeVerifiedIdResult(presentation)
    }
  };
}

async function runFederationMetadataTest(platform, platformState, input = {}) {
  const protocol = input.protocol || platformState.data.protocol || 'oidc';
  const metadataUrl = buildMetadataUrl(platform.id, platformState.data, protocol);

  if (!metadataUrl) {
    return {
      ok: false,
      title: 'Metadata URL required',
      message: 'Add an issuer URL or metadata URL before running this platform test.',
      checkedAt: new Date().toISOString()
    };
  }

  const response = await fetch(metadataUrl, { signal: AbortSignal.timeout(5000) });
  const text = await response.text();

  if (!response.ok) {
    return {
      ok: false,
      title: 'Metadata endpoint did not respond successfully',
      message: `${response.status} ${response.statusText}`,
      checkedAt: new Date().toISOString(),
      details: { metadataUrl }
    };
  }

  if (protocol === 'saml') {
    const looksLikeSaml = text.includes('EntityDescriptor') || text.includes('entityID=');
    return {
      ok: looksLikeSaml,
      title: looksLikeSaml ? 'SAML metadata found' : 'SAML metadata was not recognized',
      message: looksLikeSaml ? 'Aegis ID can reach the SAML metadata endpoint.' : 'The endpoint responded, but did not look like SAML metadata.',
      checkedAt: new Date().toISOString(),
      details: { metadataUrl }
    };
  }

  let discovery;
  try {
    discovery = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      title: 'OIDC discovery was not JSON',
      message: 'The endpoint responded, but the body was not a valid OpenID Connect discovery document.',
      checkedAt: new Date().toISOString(),
      details: { metadataUrl }
    };
  }

  const missing = ['issuer', 'authorization_endpoint', 'jwks_uri'].filter((key) => !discovery[key]);
  return {
    ok: missing.length === 0,
    title: missing.length === 0 ? 'OIDC discovery valid' : 'OIDC discovery missing required fields',
    message: missing.length === 0 ? 'Aegis ID can read issuer, authorization endpoint, and JWKS metadata.' : `Missing: ${missing.join(', ')}`,
    checkedAt: new Date().toISOString(),
    details: {
      metadataUrl,
      issuer: discovery.issuer,
      authorizationEndpoint: discovery.authorization_endpoint,
      jwksUri: discovery.jwks_uri
    }
  };
}

function buildMetadataUrl(platformId, data, protocol) {
  if (data.metadataUrl) {
    return normalizeUrl(data.metadataUrl);
  }

  if (platformId === 'keycloak' && data.baseUrl && data.realm && protocol === 'oidc') {
    const baseUrl = normalizeUrl(data.baseUrl);
    return baseUrl ? `${baseUrl}/realms/${encodeURIComponent(data.realm)}/.well-known/openid-configuration` : '';
  }

  if (data.issuerUrl && protocol === 'oidc') {
    const issuerUrl = normalizeUrl(data.issuerUrl);
    return issuerUrl ? `${issuerUrl}/.well-known/openid-configuration` : '';
  }

  return '';
}

function normalizeUrl(value) {
  const url = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) {
    return '';
  }
  return url;
}

function summarizeVerifiedIdResult(result) {
  return {
    id: result.id,
    mode: result.mode,
    requestUrl: result.requestUrl,
    hasQrCode: Boolean(result.qrCodeDataUrl),
    expiresAt: result.expiresAt
  };
}

async function ensureWorkspaceInList(workspaces, subscription) {
  let workspace = workspaces.find((item) => item.subscriptionId === subscription.id);
  if (!workspace) {
    workspace = {
      id: subscription.id,
      subscriptionId: subscription.id,
      organization: subscription.organization || inferOrganization(subscription.email),
      ownerEmail: subscription.email,
      platforms: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    workspaces.push(workspace);
  }
  return workspace;
}

function createPlatformState(platformId) {
  return {
    platformId,
    status: 'not-started',
    completedSteps: [],
    data: {},
    lastTestResult: null,
    updatedAt: null
  };
}

function computePlatformStatus(platform, state) {
  if (state.lastTestResult?.ok) {
    return 'connected';
  }
  if (state.completedSteps.length >= platform.steps.length - 1) {
    return 'configured';
  }
  return state.completedSteps.length > 0 ? 'in-progress' : 'not-started';
}

function statusLabel(status) {
  return (
    {
      'not-started': 'Not started',
      'in-progress': 'In progress',
      configured: 'Ready to test',
      connected: 'Connected',
      attention: 'Needs attention'
    }[status] || status
  );
}

function textField(name, label, defaultValue = '') {
  return { type: 'text', name, label, defaultValue };
}

function passwordField(name, label) {
  return { type: 'password', name, label, persist: false };
}

function urlField(name, label, defaultValue = '') {
  return { type: 'url', name, label, defaultValue };
}

function textareaField(name, label, defaultValue = '') {
  return { type: 'textarea', name, label, defaultValue };
}

function selectField(name, label, pairs) {
  const options = pairs.map(([value, optionLabel]) => ({ value, label: optionLabel }));
  return { type: 'select', name, label, options, defaultValue: options[0]?.value || '' };
}

function normalizeFieldValue(value, field) {
  if (field.type === 'select') {
    const allowed = new Set(field.options.map((option) => option.value));
    return allowed.has(value) ? value : field.defaultValue;
  }
  return String(value || '').trim().slice(0, field.type === 'textarea' ? 2000 : 500);
}

function inferOrganization(email = '') {
  const domain = String(email).split('@')[1] || 'Subscriber';
  return domain.split('.')[0] || domain;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

module.exports = {
  buildDashboardView,
  buildMetadataUrl,
  buildWizardView,
  createWorkspaceForSubscription,
  getOrCreateWorkspace,
  getPlatformDefinition,
  getPlatformDefinitions,
  getWorkspace,
  runPlatformTest,
  savePlatformStep
};
