const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} = require('@simplewebauthn/server');

const config = require('../config');
const FileJsonStore = require('./file-json-store');

const store = new FileJsonStore(config.paths.users, []);
const mfaMethods = new Set(['email', 'sms', 'passkey']);
const otpTtlMs = 10 * 60 * 1000;

async function registerUser(input = {}) {
  const validation = validateRegistration(input);
  if (!validation.isValid) {
    const error = new Error('Create account form needs attention.');
    error.status = 422;
    error.details = validation;
    throw error;
  }

  const users = await store.read();
  if (users.some((user) => normalizeEmail(user.email) === validation.values.email)) {
    const error = new Error('An account already exists for this email.');
    error.status = 409;
    error.details = {
      values: validation.values,
      errors: { email: 'Use sign in for this email address.' }
    };
    throw error;
  }

  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    email: validation.values.email,
    displayName: validation.values.displayName,
    phone: validation.values.phone,
    passwordHash: await bcrypt.hash(validation.values.password, 12),
    preferredMfa: validation.values.preferredMfa,
    mfaMethods: {
      email: true,
      sms: Boolean(validation.values.phone),
      passkey: false
    },
    passkeys: [],
    pendingSecondFactor: null,
    createdAt: now,
    updatedAt: now
  };

  users.push(user);
  await store.write(users);
  return publicUser(user);
}

function validateRegistration(input = {}) {
  const errors = {};
  const values = {
    displayName: normalizeText(input.displayName, 140),
    email: normalizeEmail(input.email),
    phone: normalizePhone(input.phone),
    password: String(input.password || ''),
    confirmPassword: String(input.confirmPassword || ''),
    preferredMfa: mfaMethods.has(input.preferredMfa) ? input.preferredMfa : 'email',
    organization: normalizeText(input.organization, 160),
    plan: input.plan || 'pilot',
    interest: input.interest || 'both'
  };

  if (!values.displayName) {
    errors.displayName = 'Enter your name.';
  }
  if (!values.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    errors.email = 'Enter a valid work email.';
  }
  if (values.password.length < 10) {
    errors.password = 'Use at least 10 characters.';
  }
  if (values.password !== values.confirmPassword) {
    errors.confirmPassword = 'Passwords must match.';
  }
  if (values.preferredMfa === 'sms' && !values.phone) {
    errors.phone = 'Enter a phone number for SMS verification.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    values
  };
}

async function verifyUserPassword(email, password) {
  const user = await findUserByEmail(email);
  if (!user) {
    return null;
  }
  const ok = await bcrypt.compare(String(password || ''), user.passwordHash);
  return ok ? publicUser(user) : null;
}

async function getUserById(id) {
  const users = await store.read();
  const user = users.find((candidate) => candidate.id === id);
  return user ? publicUser(user) : null;
}

async function findUserByEmail(email) {
  const users = await store.read();
  return users.find((candidate) => normalizeEmail(candidate.email) === normalizeEmail(email)) || null;
}

async function createOtpChallenge(userId, requestedMethod) {
  const users = await store.read();
  const user = findUser(users, userId);
  const method = requestedMethod === 'sms' && user.phone ? 'sms' : 'email';
  const code = crypto.randomInt(100000, 999999).toString();
  const challenge = {
    type: 'otp',
    method,
    codeHash: hashOtp(user.id, code),
    expiresAt: new Date(Date.now() + otpTtlMs).toISOString(),
    createdAt: new Date().toISOString()
  };
  user.pendingSecondFactor = challenge;
  user.updatedAt = new Date().toISOString();
  await store.write(users);

  return {
    method,
    destination: method === 'sms' ? maskPhone(user.phone) : maskEmail(user.email),
    developmentCode: config.app.env === 'production' ? null : code,
    expiresAt: challenge.expiresAt
  };
}

async function verifyOtpChallenge(userId, code) {
  const users = await store.read();
  const user = findUser(users, userId);
  const challenge = user.pendingSecondFactor;
  if (!challenge || challenge.type !== 'otp') {
    return false;
  }
  if (new Date(challenge.expiresAt).getTime() < Date.now()) {
    return false;
  }
  if (challenge.codeHash !== hashOtp(user.id, String(code || '').trim())) {
    return false;
  }
  user.pendingSecondFactor = null;
  user.lastSecondFactorAt = new Date().toISOString();
  user.updatedAt = new Date().toISOString();
  await store.write(users);
  return true;
}

async function startPasskeyRegistration(userId, requestInfo) {
  const users = await store.read();
  const user = findUser(users, userId);
  const rp = resolveRelyingParty(requestInfo);
  const options = await generateRegistrationOptions({
    rpName: config.auth.passkeyRpName,
    rpID: rp.rpId,
    userID: Buffer.from(user.id),
    userName: user.email,
    userDisplayName: user.displayName,
    attestationType: 'none',
    excludeCredentials: (user.passkeys || []).map((passkey) => ({
      id: passkey.credential.id,
      transports: passkey.credential.transports
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred'
    }
  });

  user.pendingSecondFactor = {
    type: 'passkey-registration',
    challenge: options.challenge,
    rpId: rp.rpId,
    origin: rp.origin,
    createdAt: new Date().toISOString()
  };
  user.updatedAt = new Date().toISOString();
  await store.write(users);
  return options;
}

async function finishPasskeyRegistration(userId, response, requestInfo) {
  const users = await store.read();
  const user = findUser(users, userId);
  const challenge = user.pendingSecondFactor;
  if (!challenge || challenge.type !== 'passkey-registration') {
    throw validationError('No passkey registration challenge is active.');
  }
  const rp = resolveRelyingParty(requestInfo, challenge);
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpId,
    requireUserVerification: false
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw validationError('Passkey registration could not be verified.');
  }

  const credential = verification.registrationInfo.credential;
  user.passkeys = [
    ...(user.passkeys || []),
    {
      id: crypto.randomUUID(),
      name: response.authenticatorAttachment === 'platform' ? 'Platform passkey' : 'Security key passkey',
      credential: {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: credential.transports || response.response?.transports || []
      },
      credentialDeviceType: verification.registrationInfo.credentialDeviceType,
      credentialBackedUp: verification.registrationInfo.credentialBackedUp,
      createdAt: new Date().toISOString(),
      lastUsedAt: null
    }
  ];
  user.mfaMethods = {
    ...(user.mfaMethods || {}),
    passkey: true
  };
  user.pendingSecondFactor = null;
  user.lastSecondFactorAt = new Date().toISOString();
  user.updatedAt = new Date().toISOString();
  await store.write(users);
  return true;
}

async function startPasskeyAuthentication(userId, requestInfo) {
  const users = await store.read();
  const user = findUser(users, userId);
  if (!user.passkeys?.length) {
    throw validationError('No passkey is registered for this account yet.');
  }
  const rp = resolveRelyingParty(requestInfo);
  const options = await generateAuthenticationOptions({
    rpID: rp.rpId,
    allowCredentials: user.passkeys.map((passkey) => ({
      id: passkey.credential.id,
      transports: passkey.credential.transports
    })),
    userVerification: 'preferred'
  });

  user.pendingSecondFactor = {
    type: 'passkey-authentication',
    challenge: options.challenge,
    rpId: rp.rpId,
    origin: rp.origin,
    createdAt: new Date().toISOString()
  };
  user.updatedAt = new Date().toISOString();
  await store.write(users);
  return options;
}

async function finishPasskeyAuthentication(userId, response, requestInfo) {
  const users = await store.read();
  const user = findUser(users, userId);
  const challenge = user.pendingSecondFactor;
  if (!challenge || challenge.type !== 'passkey-authentication') {
    throw validationError('No passkey authentication challenge is active.');
  }
  const passkey = (user.passkeys || []).find((candidate) => candidate.credential.id === response.id);
  if (!passkey) {
    throw validationError('This passkey is not registered to the account.');
  }
  const rp = resolveRelyingParty(requestInfo, challenge);
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpId,
    credential: {
      id: passkey.credential.id,
      publicKey: Buffer.from(passkey.credential.publicKey, 'base64url'),
      counter: passkey.credential.counter,
      transports: passkey.credential.transports
    },
    requireUserVerification: false
  });

  if (!verification.verified) {
    throw validationError('Passkey authentication could not be verified.');
  }

  passkey.credential.counter = verification.authenticationInfo.newCounter;
  passkey.lastUsedAt = new Date().toISOString();
  user.pendingSecondFactor = null;
  user.lastSecondFactorAt = new Date().toISOString();
  user.updatedAt = new Date().toISOString();
  await store.write(users);
  return true;
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    phone: user.phone,
    preferredMfa: user.preferredMfa || 'email',
    mfaMethods: user.mfaMethods || { email: true },
    passkeyCount: user.passkeys?.length || 0,
    lastSecondFactorAt: user.lastSecondFactorAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function findUser(users, userId) {
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) {
    const error = new Error('Account not found.');
    error.status = 404;
    throw error;
  }
  return user;
}

function resolveRelyingParty(requestInfo = {}, challenge = {}) {
  const origin = config.auth.passkeyOrigin || challenge.origin || requestInfo.origin;
  const rpId = config.auth.passkeyRpId || challenge.rpId || requestInfo.rpId;
  if (!origin || !rpId) {
    throw validationError('Passkey origin and relying-party ID are required.');
  }
  return { origin, rpId };
}

function hashOtp(userId, code) {
  return crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

function validationError(message) {
  const error = new Error(message);
  error.status = 422;
  return error;
}

function normalizeEmail(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeText(value = '', max = 400) {
  return String(value || '').trim().slice(0, max);
}

function normalizePhone(value = '') {
  return String(value || '').replace(/[^\d+]/g, '').slice(0, 30);
}

function maskEmail(email = '') {
  const [name, domain] = email.split('@');
  if (!name || !domain) {
    return email;
  }
  return `${name.slice(0, 2)}***@${domain}`;
}

function maskPhone(phone = '') {
  return phone.length > 4 ? `***${phone.slice(-4)}` : phone;
}

module.exports = {
  createOtpChallenge,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  getUserById,
  registerUser,
  startPasskeyAuthentication,
  startPasskeyRegistration,
  validateRegistration,
  verifyOtpChallenge,
  verifyUserPassword
};
