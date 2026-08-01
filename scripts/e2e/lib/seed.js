'use strict';

// Journey setup that has to go through the platform's own services rather than
// its HTTP surface — creating an organization needs an authenticated admin
// session, which an automated run has no way to establish.
//
// Everything a wallet does still goes over HTTP in journey.js, so the parts
// under test are exercised the way a real client exercises them.

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

/** Load a platform service bound to this run's data directory. */
function load(modulePath) {
  const resolved = require.resolve(path.join(ROOT, modulePath));
  delete require.cache[resolved];
  delete require.cache[require.resolve(path.join(ROOT, 'src/config'))];
  return require(resolved);
}

function pointStoresAt(dataDir) {
  const files = {
    SUBSCRIPTION_STORE_PATH: 'subscriptions.json',
    SUBSCRIBER_WORKSPACE_STORE_PATH: 'workspaces.json',
    ISSUER_ORG_STORE_PATH: 'issuer-organizations.json',
    ORG_ADMIN_STORE_PATH: 'org-admin.json',
    ORG_ADMIN_EVENT_STORE_PATH: 'org-admin-events.json',
    OIDC_WALLET_SESSION_STORE_PATH: 'oidc-wallet-sessions.json',
    WALLET_CHALLENGE_STORE_PATH: 'wallet-challenges.json',
    WALLET_STORE_PATH: 'wallets.json',
    AUDIT_STORE_PATH: 'audit-events.json'
  };
  for (const [key, file] of Object.entries(files)) {
    process.env[key] = path.join(dataDir, file);
  }
}

/**
 * Create the organization, its wallet invitation, and a credential addressed to
 * the holder's Wallet ID.
 */
async function createOrganization({ dataDir, orgName, holderEmail, walletId }) {
  pointStoresAt(dataDir);

  const orgAdmin = load('src/services/org-admin-service');
  const issuerOrgs = load('src/services/issuer-organization-service');

  const adminEmail = `admin-${Date.now().toString(36)}@aegis.test`;
  const subscription = { id: `sub-${Date.now().toString(36)}`, email: adminEmail, organization: orgName };
  const workspace = {
    id: `ws-${Date.now().toString(36)}`,
    subscriptionId: subscription.id,
    organization: orgName,
    ownerEmail: adminEmail,
    members: [{ email: adminEmail, role: 'administrator', addedAt: new Date().toISOString() }],
    platforms: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const invitation = await issuerOrgs.createIssuerOrganizationInvitation(subscription, workspace);

  // Bound by Wallet ID, so the credential email deliberately differs from the
  // wallet's own address — the multi-organization case.
  const credential = await orgAdmin.issueCredential(workspace, subscription, {
    holderEmail: `work-${holderEmail}`,
    walletId,
    displayName: 'End-to-end Holder',
    personType: 'employee'
  });

  return {
    adminEmail,
    subscriptionId: subscription.id,
    organizationId: workspace.id,
    invitationId: invitation.id,
    credentialId: credential.id,
    credentialEmail: credential.holderEmail
  };
}

/** Sign in through the mock provider and raise the OIDC wallet challenge. */
async function raiseOidcChallenge({ dataDir, baseUrl, email, organizationId }) {
  pointStoresAt(dataDir);
  const demo = load('src/services/oidc-wallet-demo-service');

  const { session } = await demo.createLoginRequest(baseUrl);
  await demo.setMockLogin(session.state, { email, name: 'End-to-end Holder' });
  const authenticated = await demo.completeOidcCallback({ state: session.state, code: `e2e-${Date.now()}` });
  return demo.createWalletChallenge(authenticated.id, { organizationId });
}

/** Raise the challenge an expense approval produces. */
async function approveExpenseViaApi({ baseUrl, organizationId, subject }) {
  return postChallenge(baseUrl, {
    appName: 'Vanguard Business Expenses',
    challengeType: 'expense-decision',
    action: 'approve',
    resourceType: 'expense',
    resourceId: `e2e-expense-${Date.now()}`,
    organizationId,
    subject,
    payload: { amount: '482.19', currency: 'CAD', merchant: 'End-to-end run' }
  });
}

/** Raise the challenge a document signature produces. */
async function signDocumentViaApi({ baseUrl, organizationId, subject }) {
  return postChallenge(baseUrl, {
    appName: 'Vanguard E-Signatures',
    challengeType: 'document-signature',
    action: 'sign-document',
    resourceType: 'signature-envelope',
    resourceId: `e2e-envelope-${Date.now()}`,
    organizationId,
    subject,
    payload: { document: 'End-to-end agreement', pages: '3' }
  });
}

async function postChallenge(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/wallet-challenges`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, ttlSeconds: 900 })
  });
  const text = await response.text();
  if (response.status >= 400) {
    throw new Error(`challenge request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

module.exports = { approveExpenseViaApi, createOrganization, raiseOidcChallenge, signDocumentViaApi };
