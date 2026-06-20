const crypto = require('node:crypto');
const {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} = require('@simplewebauthn/server');

const config = require('../config');
const FileJsonStore = require('./file-json-store');

const store = new FileJsonStore(config.paths.walletPasskeys, []);

async function startWalletPasskeyRegistration(input = {}, requestInfo = {}) {
  const subject = normalizeEmail(input.subject);
  if (!subject) {
    throw validationError('Wallet passkey subject is required.');
  }

  const records = await store.read();
  const record = ensureWalletPasskeyRecord(records, subject, input.displayName);
  const rp = resolveRelyingParty(requestInfo);
  const options = await generateRegistrationOptions({
    rpName: config.auth.passkeyRpName,
    rpID: rp.rpId,
    userID: Buffer.from(record.walletUserId),
    userName: subject,
    userDisplayName: record.displayName || subject,
    attestationType: 'none',
    excludeCredentials: (record.passkeys || []).map((passkey) => ({
      id: passkey.credential.id,
      transports: passkey.credential.transports
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required'
    }
  });

  record.pending = {
    type: 'wallet-passkey-registration',
    challenge: options.challenge,
    rpId: rp.rpId,
    origin: rp.origin,
    createdAt: new Date().toISOString()
  };
  record.updatedAt = new Date().toISOString();
  await store.write(records);

  return {
    subject,
    rpId: rp.rpId,
    origin: rp.origin,
    options
  };
}

async function finishWalletPasskeyRegistration(input = {}, requestInfo = {}) {
  const subject = normalizeEmail(input.subject);
  if (!subject) {
    throw validationError('Wallet passkey subject is required.');
  }

  const records = await store.read();
  const record = findWalletPasskeyRecord(records, subject);
  const pending = record.pending;
  if (!pending || pending.type !== 'wallet-passkey-registration') {
    throw validationError('No wallet passkey registration challenge is active.');
  }

  const rp = resolveRelyingParty(requestInfo, pending);
  const verification = await verifyRegistrationResponse({
    response: input.response,
    expectedChallenge: pending.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpId,
    requireUserVerification: true
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw validationError('Wallet passkey registration could not be verified.');
  }

  const credential = verification.registrationInfo.credential;
  const now = new Date().toISOString();
  record.passkeys = [
    ...(record.passkeys || []),
    {
      id: crypto.randomUUID(),
      name: normalizeText(input.name, 120) || passkeyDisplayName(input.response),
      credential: {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: credential.transports || input.response?.response?.transports || []
      },
      credentialDeviceType: verification.registrationInfo.credentialDeviceType,
      credentialBackedUp: verification.registrationInfo.credentialBackedUp,
      createdAt: now,
      lastUsedAt: null
    }
  ];
  record.pending = null;
  record.lastRegisteredAt = now;
  record.updatedAt = now;
  await store.write(records);

  return walletPasskeyStatus(record);
}

async function startWalletPasskeyAuthentication(input = {}, requestInfo = {}) {
  const subject = normalizeEmail(input.subject);
  if (!subject) {
    throw validationError('Wallet passkey subject is required.');
  }

  const records = await store.read();
  const record = findWalletPasskeyRecord(records, subject);
  if (!record.passkeys?.length) {
    throw validationError('No wallet passkey is registered for this subject.');
  }

  const rp = resolveRelyingParty(requestInfo);
  const options = await generateAuthenticationOptions({
    rpID: rp.rpId,
    allowCredentials: record.passkeys.map((passkey) => ({
      id: passkey.credential.id,
      transports: passkey.credential.transports
    })),
    userVerification: 'required'
  });

  record.pending = {
    type: 'wallet-passkey-authentication',
    challenge: options.challenge,
    challengeId: normalizeText(input.challengeId, 120),
    rpId: rp.rpId,
    origin: rp.origin,
    createdAt: new Date().toISOString()
  };
  record.updatedAt = new Date().toISOString();
  await store.write(records);

  return {
    subject,
    challengeId: record.pending.challengeId,
    rpId: rp.rpId,
    origin: rp.origin,
    options
  };
}

async function finishWalletPasskeyAuthentication(input = {}, requestInfo = {}) {
  const subject = normalizeEmail(input.subject);
  if (!subject) {
    throw validationError('Wallet passkey subject is required.');
  }

  const records = await store.read();
  const record = findWalletPasskeyRecord(records, subject);
  const pending = record.pending;
  if (!pending || pending.type !== 'wallet-passkey-authentication') {
    throw validationError('No wallet passkey authentication challenge is active.');
  }
  if (input.challengeId && pending.challengeId && input.challengeId !== pending.challengeId) {
    throw validationError('Wallet passkey challenge does not match the active approval request.');
  }

  const passkey = (record.passkeys || []).find((candidate) => candidate.credential.id === input.response?.id);
  if (!passkey) {
    throw validationError('This passkey is not registered to the wallet subject.');
  }

  const rp = resolveRelyingParty(requestInfo, pending);
  const verification = await verifyAuthenticationResponse({
    response: input.response,
    expectedChallenge: pending.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpId,
    credential: {
      id: passkey.credential.id,
      publicKey: Buffer.from(passkey.credential.publicKey, 'base64url'),
      counter: passkey.credential.counter,
      transports: passkey.credential.transports
    },
    requireUserVerification: true
  });

  if (!verification.verified) {
    throw validationError('Wallet passkey authentication could not be verified.');
  }

  const now = new Date().toISOString();
  passkey.credential.counter = verification.authenticationInfo.newCounter;
  passkey.lastUsedAt = now;
  record.pending = null;
  record.lastAuthenticatedAt = now;
  record.updatedAt = now;
  await store.write(records);

  return {
    subject,
    assurance: 'passkey',
    userVerified: true,
    credentialId: passkey.credential.id,
    credentialDeviceType: passkey.credentialDeviceType,
    credentialBackedUp: passkey.credentialBackedUp,
    rpId: rp.rpId,
    origin: rp.origin,
    challengeId: pending.challengeId || null,
    verifiedAt: now
  };
}

async function getWalletPasskeyStatus(subject) {
  const normalizedSubject = normalizeEmail(subject);
  if (!normalizedSubject) {
    throw validationError('Wallet passkey subject is required.');
  }
  const records = await store.read();
  const record = records.find((candidate) => candidate.subject === normalizedSubject);
  return walletPasskeyStatus(record || { subject: normalizedSubject, passkeys: [] });
}

function walletPasskeyStatus(record) {
  const passkeyCount = record.passkeys?.length || 0;
  return {
    subject: record.subject,
    displayName: record.displayName || record.subject,
    registered: passkeyCount > 0,
    credentialCount: passkeyCount,
    passkeyCount,
    lastRegisteredAt: record.lastRegisteredAt || null,
    lastAuthenticatedAt: record.lastAuthenticatedAt || null,
    passkeys: (record.passkeys || []).map((passkey) => ({
      id: passkey.id,
      name: passkey.name,
      credentialDeviceType: passkey.credentialDeviceType,
      credentialBackedUp: passkey.credentialBackedUp,
      createdAt: passkey.createdAt,
      lastUsedAt: passkey.lastUsedAt
    }))
  };
}

function ensureWalletPasskeyRecord(records, subject, displayName) {
  let record = records.find((candidate) => candidate.subject === subject);
  if (!record) {
    record = {
      id: crypto.randomUUID(),
      walletUserId: crypto.randomBytes(16).toString('base64url'),
      subject,
      displayName: normalizeText(displayName, 180) || subject,
      passkeys: [],
      pending: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    records.push(record);
  }
  if (displayName) {
    record.displayName = normalizeText(displayName, 180);
  }
  return record;
}

function findWalletPasskeyRecord(records, subject) {
  const record = records.find((candidate) => candidate.subject === subject);
  if (!record) {
    throw validationError('No wallet passkey profile exists for this subject.');
  }
  return record;
}

function resolveRelyingParty(requestInfo = {}, challenge = {}) {
  const origin = config.auth.passkeyOrigin || challenge.origin || requestInfo.origin;
  const rpId = config.auth.passkeyRpId || challenge.rpId || requestInfo.rpId;
  if (!origin || !rpId) {
    throw validationError('Passkey origin and relying-party ID are required.');
  }
  return { origin, rpId };
}

function passkeyDisplayName(response = {}) {
  return response.authenticatorAttachment === 'platform' ? 'Wallet platform passkey' : 'Wallet security key passkey';
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeText(value = '', max = 400) {
  return String(value || '').trim().slice(0, max);
}

function validationError(message) {
  const error = new Error(message);
  error.status = 422;
  return error;
}

module.exports = {
  finishWalletPasskeyAuthentication,
  finishWalletPasskeyRegistration,
  getWalletPasskeyStatus,
  startWalletPasskeyAuthentication,
  startWalletPasskeyRegistration
};
