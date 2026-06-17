const crypto = require('node:crypto');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const VerifiedIdClient = require('./verified-id-client');
const { buildDemoEmployeeClaims, getPresentationPolicy } = require('./credential-policy-service');

const store = new FileJsonStore(config.paths.subscriberWorkspaces, []);

const DEFAULT_REQUIRED_CLAIMS = 'employeeId, displayName, email, department, role, assuranceLevel, employmentStatus';
const FIELD_HELP_TEXT = {
  adminDomain: 'Enter the primary verified domain in the Entra tenant, for example vanguardcs.ca. This should match or support the Verified ID linked domain.',
  attestationType: 'Choose how claims are supplied to the credential. Use ID token hint for this app because Aegis ID sends claim values in the issuance request.',
  azureAppName: 'Enter the display name of the Entra app registration that will call the Verified ID Request Service API.',
  azureClientId: 'Paste the Application (client) ID from the Entra app registration.',
  azureTenantId: 'Paste the Directory (tenant) ID for the Vanguard Cloud Services Entra tenant.',
  baseUrl: 'Enter the root URL of the Keycloak server, without the realm path.',
  callbackApiKeyReference: 'Enter the App Service setting or Key Vault secret name that stores VID_CALLBACK_API_KEY for callback verification.',
  callbackOrAcsUrl: 'Enter the OIDC callback URL or SAML Assertion Consumer Service URL registered with the identity provider.',
  claimMappings: 'Map provider-specific claim names on the left to Aegis ID normalized claim names on the right, one mapping per line.',
  clientId: 'Enter the OIDC client ID or SAML entity ID assigned to this Aegis ID integration.',
  clientSecretReference: 'Enter the secret store reference for the client secret. Do not paste the secret itself into the wizard.',
  credentialDisplayName: 'Enter the user-facing name shown in the wallet for this credential.',
  credentialType: 'Enter the exact credential type configured in Microsoft Entra Verified ID, for example VanguardEmployeeCredential.',
  didMethod: 'Select the DID method used by the Verified ID organization. did:web is easiest to inspect and align with a linked domain.',
  adminStepUpPolicy: 'Describe where Aegis ID should require a hardware-backed step-up, such as admin promotion, credential revocation, claims export, or payment approval.',
  attestationPolicy: 'Choose whether Aegis ID should require authenticator attestation to prove the registered security key model, such as YubiKey 5C NFC.',
  fido2Aaguid: 'Enter one or more allowed authenticator AAGUID values if you want to restrict registration to approved hardware key models.',
  fido2PolicyName: 'Enter the friendly policy name shown to administrators when configuring hardware-backed authentication.',
  groupsFilter: 'Enter the Okta group naming pattern or expression that should be released as groups or entitlements.',
  issuerUrl: 'Enter the OIDC issuer URL. For Okta this is usually the authorization server URL, such as https://example.okta.com/oauth2/default.',
  keyVaultName: 'Enter the Key Vault name or reference used by Entra Verified ID to protect signing keys.',
  keyVaultPermissionModel: 'Use Vault access policy for current Verified ID setup guidance unless your tenant setup explicitly supports RBAC for this flow.',
  keyInventoryOwner: 'Enter the team or mailbox responsible for issuing, replacing, and recovering hardware keys.',
  linkedDomain: 'Enter the trusted domain linked to the Verified ID organization. This should be verified in DNS and visible to wallet users.',
  manifestUrl: 'Paste the credential manifest URL from the Verified ID portal after creating the credential contract.',
  metadataUrl: 'Optionally enter the exact OIDC discovery URL or SAML metadata URL. If blank, Aegis ID derives OIDC metadata where possible.',
  nfcEnrollment: 'Choose whether mobile enrollment and step-up can use NFC-capable security keys such as YubiKey 5C NFC.',
  oktaOrgUrl: 'Enter the base URL of the Okta organization, such as https://example.okta.com.',
  oneTimeClientSecret: 'Paste the Entra app client secret only for this live test request. Aegis ID does not persist this value.',
  optionalClaims: 'List additional claims that may be issued or mapped later, separated by commas or lines.',
  presentationRules: 'Enter simple authorization rules that describe which returned credential claims should grant access.',
  protocol: 'Choose whether this integration should validate OIDC discovery metadata or SAML metadata.',
  providerName: 'Enter the display name for the identity provider, such as Ping, Auth0, OneLogin, or an internal IdP.',
  publicBaseUrl: 'Enter the public HTTPS URL where this app is reachable. Microsoft Verified ID callbacks and mobile wallet scans cannot use localhost.',
  realm: 'Enter the Keycloak realm name that contains users, clients, roles, and protocol mappers.',
  recoveryPolicy: 'Describe the break-glass or replacement process when a hardware key is lost, damaged, transferred, or reassigned.',
  redirectUri: 'Enter the redirect URI registered on the provider for this Aegis ID relying-party app.',
  relyingPartyId: 'Enter the WebAuthn relying party ID. This is usually the application domain users sign in to, such as aegis.vanguardcs.ca.',
  requestServicePermission: 'Enter the Microsoft Verified ID Request Service API application permission granted to the app registration. Use VerifiableCredential.Create.All for issuance and presentation testing.',
  requiredClaims: 'List claims that must be present for issuance, presentation, or policy evaluation. Separate with commas or lines.',
  sampleSubjectEmail: 'Enter the test subject email that should be placed into the demo credential claims during a live or mock test.',
  sampleUserEmail: 'Enter a pilot user email that should be used in the generated YubiKey enrollment checklist.',
  secretOrCertReference: 'Enter the secret, certificate, or signing key reference used for this relying-party registration. Do not paste private material.',
  secretReference: 'Enter where the client secret is stored, such as an App Service setting or Key Vault secret reference. Do not paste the secret here.',
  setupMode: 'Choose Advanced setup for tenant testing because it exposes Key Vault, DID, and linked-domain settings needed for production-like validation.',
  tenantDisplayName: 'Enter the friendly tenant name shown to operators, for example Vanguard Cloud Services.',
  testMode: 'Choose Mock to validate local UI behavior, or Live to call Microsoft Entra Verified ID with tenant configuration.',
  userVerification: 'Choose whether users must unlock the key with a PIN or biometric gesture before the FIDO2 assertion is accepted.',
  verifiedIdAdminRole: 'Enter the Entra role assigned to the operator completing Verified ID setup. Authentication Policy Administrator is commonly required.',
  verifiedIdAuthorityDid: 'Paste the issuer authority DID from the Verified ID portal. This is the DID the verifier should trust.',
  yubiKeyModel: 'Enter the approved hardware key model for this policy, such as YubiKey 5C NFC.'
};

function getPlatformDefinitions() {
  return [
    {
      id: 'microsoft-verified-id',
      name: 'Microsoft Entra Verified ID',
      family: 'Verified ID / Azure',
      icon: 'MS',
      summary: 'Set up Vanguard Cloud Services tenant details, issuer DID, credential contract, claims, and a wallet test.',
      docsUrl: 'https://learn.microsoft.com/en-us/entra/verified-id/verifiable-credentials-configure-tenant',
      steps: [
        {
          id: 'tenant',
          title: 'Tenant & Prerequisites',
          description: 'Confirm the Entra tenant, public callback host, admin role, and setup path before creating live Verified ID requests.',
          fields: [
            textField('tenantDisplayName', 'Tenant display name', 'Vanguard Cloud Services'),
            textField('azureTenantId', 'Azure tenant ID'),
            textField('adminDomain', 'Primary verified domain', 'vanguardcs.ca'),
            urlField('publicBaseUrl', 'Public HTTPS app URL', config.app.publicBaseUrl),
            textField('verifiedIdAdminRole', 'Verified ID admin role', 'Authentication Policy Administrator'),
            selectField('setupMode', 'Verified ID setup mode', [
              ['advanced', 'Advanced setup with Key Vault'],
              ['quick', 'Quick setup']
            ])
          ]
        },
        {
          id: 'verified-id-service',
          title: 'Verified ID Service',
          description: 'Record the Entra Verified ID organization, trusted domain, DID, and Key Vault values created in the portal.',
          fields: [
            textField('verifiedIdAuthorityDid', 'Issuer authority DID', 'did:web:vanguardcs.ca'),
            selectField('didMethod', 'DID method', [
              ['did:web', 'did:web'],
              ['did:ion', 'did:ion'],
              ['managed', 'Microsoft-managed DID']
            ]),
            textField('linkedDomain', 'Trusted linked domain', 'vanguardcs.ca'),
            textField('keyVaultName', 'Key Vault name or reference'),
            selectField('keyVaultPermissionModel', 'Key Vault permission model', [
              ['access-policy', 'Vault access policy'],
              ['rbac', 'Azure RBAC']
            ])
          ]
        },
        {
          id: 'app-registration',
          title: 'App Registration',
          description: 'Record the app registration and permission values used to call the Microsoft Verified ID Request Service API.',
          fields: [
            textField('azureAppName', 'Application registration name', 'vanguard-aegis-id-verified-id'),
            textField('azureClientId', 'Application client ID'),
            textField('requestServicePermission', 'Request Service permission', 'VerifiableCredential.Create.All'),
            textField('secretReference', 'Client secret reference', 'Key Vault secret or App Service setting name'),
            textField('callbackApiKeyReference', 'Callback API key reference', 'VID_CALLBACK_API_KEY')
          ]
        },
        {
          id: 'credential-contract',
          title: 'Credential Contract',
          description: 'Capture the credential type, manifest URL, and attestation shape Aegis ID will use for issuance.',
          fields: [
            textField('credentialType', 'Credential type', 'VanguardEmployeeCredential'),
            urlField('manifestUrl', 'Credential manifest URL'),
            selectField('attestationType', 'Attestation type', [
              ['idTokenHint', 'ID token hint'],
              ['idToken', 'ID token'],
              ['selfIssued', 'Self-issued']
            ]),
            textField('credentialDisplayName', 'Credential display name', 'Vanguard Employee Credential')
          ]
        },
        {
          id: 'claims',
          title: 'Claims & Policy',
          description: 'Define the claims Aegis ID should issue, request during presentation, and evaluate for access decisions.',
          fields: [
            textareaField('requiredClaims', 'Required claims', DEFAULT_REQUIRED_CLAIMS),
            textareaField('optionalClaims', 'Optional claims', 'manager, costCenter, region'),
            textareaField('presentationRules', 'Presentation authorization rules', 'employmentStatus=active\nassuranceLevel=FIDO2_YUBIKEY'),
            textField('sampleSubjectEmail', 'Sample test subject email', 'identity@vanguardcs.ca')
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
      id: 'yubikey-fido2',
      name: 'YubiKey FIDO2 / WebAuthn',
      family: 'Hardware-backed assurance',
      icon: 'YK',
      summary: 'Configure YubiKey 5C NFC as a phishing-resistant Aegis ID assurance method for sign-in, admin step-up, and high-value approvals.',
      docsUrl: 'https://www.yubico.com/product/yubikey-5c-nfc/',
      steps: [
        {
          id: 'policy',
          title: 'Security Key Policy',
          description: 'Define the hardware-backed authentication policy that Aegis ID should enforce or document for this organization.',
          fields: [
            textField('fido2PolicyName', 'Policy name', 'Aegis hardware-backed assurance'),
            textField('yubiKeyModel', 'Approved key model', 'YubiKey 5C NFC'),
            textField('relyingPartyId', 'WebAuthn relying party ID', 'vanguard-aegis-id-65067d.azurewebsites.net'),
            selectField('userVerification', 'User verification', [
              ['required', 'PIN or biometric required'],
              ['preferred', 'PIN or biometric preferred'],
              ['discouraged', 'No local user verification']
            ])
          ]
        },
        {
          id: 'attestation',
          title: 'Attestation & Inventory',
          description: 'Capture how the organization will restrict, inventory, and recover hardware security keys.',
          fields: [
            selectField('attestationPolicy', 'Authenticator attestation', [
              ['required', 'Require approved hardware attestation'],
              ['preferred', 'Prefer attestation where available'],
              ['none', 'Do not enforce attestation']
            ]),
            textareaField('fido2Aaguid', 'Allowed AAGUID values', 'Enter approved YubiKey AAGUID values, one per line'),
            textField('keyInventoryOwner', 'Key inventory owner', 'Security Operations'),
            textareaField('recoveryPolicy', 'Recovery and replacement policy', 'Require manager approval, identity verification, and immutable Aegis challenge before replacing a lost key.')
          ]
        },
        {
          id: 'use-cases',
          title: 'Aegis Use Cases',
          description: 'Choose where YubiKey-backed assurance complements wallet credentials and Verified ID.',
          fields: [
            selectField('nfcEnrollment', 'NFC mobile support', [
              ['enabled', 'Enable YubiKey 5C NFC mobile flows'],
              ['desktop-only', 'Desktop only'],
              ['disabled', 'Not used']
            ]),
            textareaField('adminStepUpPolicy', 'Aegis step-up triggers', 'administrator sign-in\nco-admin promotion\ncredential revocation\nclaims export\nhigh-value approval'),
            textField('sampleUserEmail', 'Sample pilot user', 'identity@vanguardcs.ca')
          ]
        },
        {
          id: 'test',
          title: 'Review',
          description: 'Generate a YubiKey pilot checklist for this organization. This is a policy readiness check, not a live WebAuthn registration.',
          testStep: true,
          fields: [
            selectField('testMode', 'Review mode', [
              ['checklist', 'Generate checklist']
            ])
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
            textField('realm', 'Realm', 'vanguard'),
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
            textField('groupsFilter', 'Groups claim filter', 'Vanguard-*')
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
    return ensureMembership(workspace, subscription, 'administrator');
  }

  workspace = {
    id: subscription.id,
    subscriptionId: subscription.id,
    organization: subscription.organization || inferOrganization(subscription.email),
    ownerEmail: subscription.email,
    members: [createWorkspaceMembership(subscription, 'administrator')],
    platforms: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  workspaces.push(workspace);
  await store.write(workspaces);
  return workspace;
}

async function registerWorkspaceForSubscription(subscription, input = {}) {
  const workspaces = await store.read();
  const organization = normalizeOrganization(input.organization || subscription.organization || inferOrganization(subscription.email));
  const existing = workspaces.find(
    (workspace) => workspaceBelongsToSubscription(workspace, subscription) && normalizeComparable(workspace.organization) === normalizeComparable(organization)
  );

  if (existing) {
    const memberWorkspace = ensureMembership(existing, subscription, 'administrator');
    memberWorkspace.updatedAt = new Date().toISOString();
    await store.write(workspaces);
    return decorateWorkspaceForSubscription(memberWorkspace, subscription);
  }

  const now = new Date().toISOString();
  const workspace = {
    id: crypto.randomUUID(),
    subscriptionId: subscription.id,
    organization,
    ownerEmail: subscription.email,
    members: [createWorkspaceMembership(subscription, 'administrator')],
    platforms: {},
    createdAt: now,
    updatedAt: now
  };

  workspaces.unshift(workspace);
  await store.write(workspaces);
  return decorateWorkspaceForSubscription(workspace, subscription);
}

async function listWorkspacesForSubscription(subscription) {
  const workspaces = await store.read();
  return workspaces
    .filter((workspace) => workspaceBelongsToSubscription(workspace, subscription))
    .map((workspace) => decorateWorkspaceForSubscription(ensureMembership(workspace, subscription), subscription))
    .sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime());
}

async function getWorkspace(subscriptionId, workspaceId) {
  const workspaces = await store.read();
  if (workspaceId) {
    return workspaces.find((workspace) => workspace.id === workspaceId && workspace.subscriptionId === subscriptionId) || null;
  }
  return workspaces.find((workspace) => workspace.subscriptionId === subscriptionId) || null;
}

async function getWorkspaceForSubscription(subscription, workspaceId) {
  const workspaces = await listWorkspacesForSubscription(subscription);
  if (!workspaceId) {
    return workspaces[0] || null;
  }

  return workspaces.find((workspace) => workspace.id === workspaceId) || null;
}

async function setWorkspaceMemberRole(workspaceId, email, role = 'contributor', metadata = {}) {
  const workspaces = await store.read();
  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    throw notFound('Organization workspace not found.');
  }

  workspace.members = Array.isArray(workspace.members) ? workspace.members : [];
  const normalizedEmail = normalizeEmail(email);
  let member = workspace.members.find((item) => normalizeEmail(item.email) === normalizedEmail);
  if (!member) {
    member = {
      email: normalizedEmail,
      role: normalizeRole(role),
      addedAt: new Date().toISOString()
    };
    workspace.members.push(member);
  }

  member.role = normalizeRole(role);
  member.sourceCredentialId = metadata.sourceCredentialId || member.sourceCredentialId || null;
  member.updatedAt = new Date().toISOString();
  workspace.updatedAt = new Date().toISOString();
  await store.write(workspaces);
  return workspace;
}

async function revokeWorkspaceMemberRole(workspaceId, email, role = 'administrator') {
  const workspaces = await store.read();
  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    throw notFound('Organization workspace not found.');
  }

  const normalizedEmail = normalizeEmail(email);
  workspace.members = (workspace.members || []).map((member) => {
    if (normalizeEmail(member.email) !== normalizedEmail || normalizeRole(member.role) !== normalizeRole(role)) {
      return member;
    }

    return {
      ...member,
      role: 'contributor',
      revokedRole: normalizeRole(role),
      revokedAt: new Date().toISOString()
    };
  });
  workspace.updatedAt = new Date().toISOString();
  await store.write(workspaces);
  return workspace;
}

async function getOrCreateWorkspace(subscription, workspaceId) {
  const workspace = await getWorkspaceForSubscription(subscription, workspaceId);
  if (workspace) {
    return workspace;
  }
  if (workspaceId) {
    throw notFound('Organization workspace not found for this subscriber.');
  }
  return createWorkspaceForSubscription(subscription);
}

async function savePlatformStep(subscription, platformId, stepId, input = {}, workspaceId) {
  const platform = getPlatformDefinition(platformId);
  const step = platform.steps.find((candidate) => candidate.id === stepId);
  if (!step) {
    throw notFound(`Unknown setup step: ${stepId}`);
  }

  const workspaces = await store.read();
  const workspace = await ensureWorkspaceInList(workspaces, subscription, workspaceId);
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

async function runPlatformTest(subscription, platformId, input = {}, workspaceId) {
  const platform = getPlatformDefinition(platformId);
  const workspaces = await store.read();
  const workspace = await ensureWorkspaceInList(workspaces, subscription, workspaceId);
  const platformState = workspace.platforms[platformId] || createPlatformState(platformId);

  const result =
    platformId === 'microsoft-verified-id'
      ? await runMicrosoftVerifiedIdTest(platformState, input)
      : platformId === 'yubikey-fido2'
        ? runYubiKeyReadinessTest(platformState, input)
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
    description: 'Vanguard Cloud Services - Aegis ID subscriber dashboard.',
    subscription,
    workspace,
    workspaceRole: workspace.roleLabel || roleLabel(workspace.role || 'administrator'),
    dashboardBasePath: dashboardPath(subscription.id, workspace.id),
    organizationsPath: `/organizations/${subscription.id}`,
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
    description: `${platform.name} setup wizard for Vanguard Cloud Services - Aegis ID.`,
    subscription,
    workspace,
    workspaceRole: workspace.roleLabel || roleLabel(workspace.role || 'administrator'),
    dashboardBasePath: dashboardPath(subscription.id, workspace.id),
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
    email: data.sampleSubjectEmail || 'identity@vanguardcs.ca'
  });

  const issuance = await client.createIssuanceRequest({
    credentialType: data.credentialType || config.verifiedId.credentialType,
    claims
  });
  const presentation = await client.createPresentationRequest({
    ...getPresentationPolicy(),
    credentialType: data.credentialType || config.verifiedId.credentialType,
    acceptedIssuers: [data.verifiedIdAuthorityDid || config.verifiedId.authorityDid || 'did:web:vanguardcs.ca']
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

function runYubiKeyReadinessTest(platformState, input = {}) {
  const data = {
    ...platformState.data,
    ...input
  };
  const model = data.yubiKeyModel || 'YubiKey 5C NFC';
  const rpId = data.relyingPartyId || 'vanguard-aegis-id-65067d.azurewebsites.net';
  const attestation = data.attestationPolicy || 'required';
  const userVerification = data.userVerification || 'required';
  const nfcEnrollment = data.nfcEnrollment || 'enabled';
  const triggers = splitLines(data.adminStepUpPolicy || 'administrator sign-in\ncredential revocation\nhigh-value approval');

  return {
    ok: true,
    mode: 'checklist',
    title: 'YubiKey assurance checklist generated',
    message: `${model} is configured as a hardware-backed Aegis ID assurance method for ${rpId}.`,
    checkedAt: new Date().toISOString(),
    details: {
      relyingPartyId: rpId,
      approvedKeyModel: model,
      userVerification,
      attestationPolicy: attestation,
      nfcMobileSupport: nfcEnrollment,
      sampleUserEmail: data.sampleUserEmail || 'identity@vanguardcs.ca',
      stepUpTriggers: triggers,
      checklist: [
        'Register the YubiKey as a FIDO2/WebAuthn security key for the pilot user.',
        'Require PIN or biometric user verification for admin and high-value operations.',
        'Record key assignment, spare key ownership, and replacement workflow in the organization policy.',
        'Use Aegis wallet challenges for business action evidence after the hardware-backed sign-in or step-up.',
        'For Entra-backed tenants, align this policy with passkey/FIDO2 authentication methods and Conditional Access authentication strength.'
      ]
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
    qrCodeDataUrl: result.qrCodeDataUrl,
    pin: result.pin,
    hasQrCode: Boolean(result.qrCodeDataUrl),
    expiresAt: result.expiresAt
  };
}

function splitLines(value = '') {
  return String(value)
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function ensureWorkspaceInList(workspaces, subscription, workspaceId) {
  let workspace = workspaceId
    ? workspaces.find((item) => item.id === workspaceId && workspaceBelongsToSubscription(item, subscription))
    : workspaces.find((item) => workspaceBelongsToSubscription(item, subscription));

  if (workspaceId && !workspace) {
    throw notFound('Organization workspace not found for this subscriber.');
  }

  if (!workspace) {
    workspace = {
      id: subscription.id,
      subscriptionId: subscription.id,
      organization: subscription.organization || inferOrganization(subscription.email),
      ownerEmail: subscription.email,
      members: [createWorkspaceMembership(subscription, 'administrator')],
      platforms: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    workspaces.push(workspace);
  }
  return ensureMembership(workspace, subscription, 'administrator');
}

function workspaceBelongsToSubscription(workspace, subscription) {
  if (workspace.subscriptionId === subscription.id || normalizeEmail(workspace.ownerEmail) === normalizeEmail(subscription.email)) {
    return true;
  }

  return (workspace.members || []).some((member) => normalizeEmail(member.email) === normalizeEmail(subscription.email));
}

function createWorkspaceMembership(subscription, role = 'administrator') {
  return {
    email: normalizeEmail(subscription.email),
    role: normalizeRole(role),
    addedAt: new Date().toISOString()
  };
}

function ensureMembership(workspace, subscription, defaultRole = 'administrator') {
  const email = normalizeEmail(subscription.email);
  workspace.members = Array.isArray(workspace.members) ? workspace.members : [];
  let member = workspace.members.find((item) => normalizeEmail(item.email) === email);
  if (!member) {
    member = createWorkspaceMembership(subscription, workspace.ownerEmail === subscription.email ? 'administrator' : defaultRole);
    workspace.members.push(member);
  }
  workspace.role = normalizeRole(member.role);
  workspace.roleLabel = roleLabel(workspace.role);
  workspace.dashboardPath = dashboardPath(subscription.id, workspace.id);
  return workspace;
}

function decorateWorkspaceForSubscription(workspace, subscription) {
  return {
    ...workspace,
    role: normalizeRole(workspace.role),
    roleLabel: roleLabel(workspace.role),
    dashboardPath: dashboardPath(subscription.id, workspace.id)
  };
}

function dashboardPath(subscriptionId, workspaceId) {
  return `/dashboard/${subscriptionId}/orgs/${workspaceId}`;
}

function normalizeRole(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return ['administrator', 'contributor'].includes(normalized) ? normalized : 'administrator';
}

function roleLabel(role = '') {
  return normalizeRole(role) === 'contributor' ? 'Contributor' : 'Administrator';
}

function normalizeOrganization(value = '') {
  return String(value || '').trim().slice(0, 160) || 'New Organization';
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeComparable(value = '') {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
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

function textField(name, label, defaultValue = '', helpText = '') {
  return { type: 'text', name, label, defaultValue, helpText: helpText || fieldHelp(name) };
}

function passwordField(name, label, helpText = '') {
  return { type: 'password', name, label, helpText: helpText || fieldHelp(name), persist: false };
}

function urlField(name, label, defaultValue = '', helpText = '') {
  return { type: 'url', name, label, defaultValue, helpText: helpText || fieldHelp(name) };
}

function textareaField(name, label, defaultValue = '', helpText = '') {
  return { type: 'textarea', name, label, defaultValue, helpText: helpText || fieldHelp(name) };
}

function selectField(name, label, pairs, helpText = '') {
  const options = pairs.map(([value, optionLabel]) => ({ value, label: optionLabel }));
  return { type: 'select', name, label, options, defaultValue: options[0]?.value || '', helpText: helpText || fieldHelp(name) };
}

function fieldHelp(name) {
  return FIELD_HELP_TEXT[name] || 'Enter the value provided by the identity platform administrator for this setup field.';
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
  getWorkspaceForSubscription,
  getOrCreateWorkspace,
  getPlatformDefinition,
  getPlatformDefinitions,
  getWorkspace,
  listWorkspacesForSubscription,
  registerWorkspaceForSubscription,
  revokeWorkspaceMemberRole,
  runPlatformTest,
  savePlatformStep,
  setWorkspaceMemberRole
};
