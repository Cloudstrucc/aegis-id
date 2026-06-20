const crypto = require('node:crypto');
const QRCode = require('qrcode');

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { createIosWalletDeepLink, createOutOfBandInvitation } = require('../adapters/aries/aries-lab-adapter');

const store = new FileJsonStore(config.paths.issuerOrganizations, []);

async function createIssuerOrganizationInvitation(subscription, workspace) {
  const organizationId = workspace.id;
  const organizationName = workspace.organization || subscription.organization || 'Vanguard subscriber';
  const label = `${organizationName} Issuer`;
  const invitation = await createOutOfBandInvitation('issuer', {
    label,
    metadata: {
      vanguard: {
        type: 'issuer-organization',
        subscriptionId: subscription.id,
        organizationId,
        organizationName
      }
    }
  });
  const invitationId = invitation.payload?.invitation?.['@id'] || invitation.payload?.['@id'] || null;
  const decoratedInvitationUrl = decorateInvitationUrl(invitation.invitationUrl, {
    vanguard_org_id: organizationId,
    vanguard_subscription_id: subscription.id,
    vanguard_org_name: organizationName,
    vanguard_web_app_url: config.app.publicBaseUrl.replace(/\/$/, '')
  });
  const iosDeepLinkUrl = createIosWalletDeepLink(decoratedInvitationUrl);
  const now = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    subscriptionId: subscription.id,
    organizationId,
    organizationName,
    label,
    invitationId,
    invitationUrl: decoratedInvitationUrl,
    requestUrl: decoratedInvitationUrl,
    iosDeepLinkUrl,
    qrCodeDataUrl: await QRCode.toDataURL(decoratedInvitationUrl, { margin: 1, width: 420 }),
    iosQrCodeDataUrl: iosDeepLinkUrl ? await QRCode.toDataURL(iosDeepLinkUrl, { margin: 1, width: 420 }) : null,
    issuerConnectionId: null,
    holderConnectionId: null,
    status: 'invitation-created',
    createdAt: now,
    updatedAt: now
  };

  const records = await store.read();
  records.unshift(record);
  await store.write(records);
  return record;
}

async function registerIssuerOrganizationConnection(organizationId, input = {}) {
  const records = await store.read();
  const index = findRegistrationIndex(records, organizationId, input);

  if (index === -1) {
    const error = new Error('Issuer organization invitation was not found.');
    error.status = 404;
    throw error;
  }

  records[index] = {
    ...records[index],
    issuerConnectionId: input.issuerConnectionId || records[index].issuerConnectionId,
    holderConnectionId: input.holderConnectionId || records[index].holderConnectionId,
    invitationId: input.invitationId || records[index].invitationId,
    status: 'connected',
    updatedAt: new Date().toISOString()
  };
  await store.write(records);
  return records[index];
}

async function listIssuerOrganizations(subscriptionId, organizationId) {
  const records = await store.read();
  return records.filter(
    (record) =>
      (!subscriptionId || record.subscriptionId === subscriptionId) &&
      (!organizationId || record.organizationId === organizationId)
  );
}

async function listConnectedIssuerOrganizations() {
  const records = await store.read();
  return records.filter((record) => record.status === 'connected' && record.issuerConnectionId);
}

async function getIssuerOrganization(organizationId) {
  const records = await store.read();
  return records.find((record) => record.organizationId === organizationId && record.status === 'connected') || null;
}

function findRegistrationIndex(records, organizationId, input) {
  const invitationId = input.invitationId || null;
  if (invitationId) {
    const exact = records.findIndex(
      (record) => record.organizationId === organizationId && record.invitationId === invitationId
    );
    if (exact !== -1) {
      return exact;
    }
  }

  return records.findIndex((record) => record.organizationId === organizationId);
}

function decorateInvitationUrl(invitationUrl, params) {
  const url = new URL(invitationUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

module.exports = {
  createIssuerOrganizationInvitation,
  getIssuerOrganization,
  listConnectedIssuerOrganizations,
  listIssuerOrganizations,
  registerIssuerOrganizationConnection
};
