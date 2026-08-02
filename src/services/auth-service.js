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
const { deliverMessage } = require('./otp-delivery-service');

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
    preferredMfa: mfaMethods.has(input.preferredMfa) ? input.preferredMfa : defaultMfaMethod(),
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
  // A passwordless account has no hash to compare against. bcrypt.compare
  // throws on undefined, which would turn a routine sign-in attempt into a 500
  // and tell an attacker which addresses are passwordless. Fail closed instead.
  if (!user.passwordHash) {
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

  // Actually send it. Previously the code was generated, stored and shown on
  // screen outside production — which meant nowhere, since dev and qa also run
  // NODE_ENV=production. Locally the filesystem transport writes it to disk.
  const delivery = await deliverMessage({
    type: 'mfa-otp',
    email: method === 'email' ? user.email : null,
    phone: method === 'sms' ? user.phone : null,
    variables: { code },
    context: { userId: user.id }
  });

  return {
    method,
    destination: method === 'sms' ? maskPhone(user.phone) : maskEmail(user.email),
    delivered: delivery.delivered,
    deliveryFailures: delivery.failures.map((failure) => failure.message),
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
      // Discoverable, so the credential can start a sign-in with no username
      // typed. Required (not preferred) or the authenticator may decline to
      // store it and the passkey silently becomes second-factor-only.
      residentKey: 'required',
      userVerification: 'required'
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
    passwordless: Boolean(user.passwordless) || !user.passwordHash,
    emailVerifiedAt: user.emailVerifiedAt || null,
    lastSecondFactorAt: user.lastSecondFactorAt,
    // Needed by deserializeUser to reject sessions that predate a password
    // reset, so it has to survive publicUser().
    sessionsValidFrom: user.sessionsValidFrom || null,
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

function defaultMfaMethod() {
  return mfaMethods.has(config.auth.defaultMfaMethod) ? config.auth.defaultMfaMethod : 'email';
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


/**
 * Begin a usernameless sign-in. `allowCredentials` is deliberately empty so the
 * browser offers whichever discoverable passkey the person has for this site —
 * we learn who they are from the credential they pick, not from a typed email.
 */
async function startPasskeyLogin(requestInfo) {
  const rp = resolveRelyingParty(requestInfo);
  const options = await generateAuthenticationOptions({
    rpID: rp.rpId,
    allowCredentials: [],
    userVerification: 'required'
  });
  return { options, rpId: rp.rpId, origin: rp.origin };
}

/**
 * Complete a usernameless sign-in. Resolves the account from the credential ID
 * and insists on user verification, which is what makes a passkey two factors
 * on its own rather than mere possession of an unlocked device.
 */
async function finishPasskeyLogin(response, requestInfo, challenge) {
  if (!challenge?.challenge) {
    throw validationError('No passkey sign-in challenge is active.');
  }

  const users = await store.read();
  let owner = null;
  let passkey = null;
  for (const candidate of users) {
    const match = (candidate.passkeys || []).find((entry) => entry.credential.id === response.id);
    if (match) {
      owner = candidate;
      passkey = match;
      break;
    }
  }

  if (!owner || !passkey) {
    throw validationError('This passkey is not registered to any account.');
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
    // Enforced here, not merely requested in the options: a client is free to
    // ignore what we asked for, so the server has to be the one that insists.
    requireUserVerification: true
  });

  if (!verification.verified) {
    throw validationError('Passkey sign-in could not be verified.');
  }

  passkey.credential.counter = verification.authenticationInfo.newCounter;
  passkey.lastUsedAt = new Date().toISOString();
  owner.lastSecondFactorAt = new Date().toISOString();
  owner.pendingSecondFactor = null;
  owner.updatedAt = new Date().toISOString();
  await store.write(users);

  return publicUser(owner);
}


/**
 * Begin a passwordless enrolment. No account exists yet — the caller holds the
 * returned challenge in their session and only after the authenticator answers
 * is a user record written, so an abandoned ceremony leaves nothing behind.
 */
async function startPasswordlessRegistration(input, requestInfo) {
  const displayName = normalizeText(input.displayName, 140);
  const email = normalizeEmail(input.email);

  const errors = {};
  if (!displayName) {
    errors.displayName = 'Enter your name.';
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Enter a valid work email.';
  }
  if (Object.keys(errors).length) {
    const error = new Error('Create account form needs attention.');
    error.status = 422;
    error.details = { isValid: false, errors, values: { displayName, email } };
    throw error;
  }

  const users = await store.read();
  if (users.some((user) => normalizeEmail(user.email) === email)) {
    const error = new Error('An account already exists for this email.');
    error.status = 409;
    error.expose = true;
    throw error;
  }

  const rp = resolveRelyingParty(requestInfo);
  // A random handle rather than the email: the user handle is stored on the
  // authenticator and syncs to the person's other devices, so it should not
  // carry personal data.
  const userHandle = crypto.randomUUID();
  const options = await generateRegistrationOptions({
    rpName: config.auth.passkeyRpName,
    rpID: rp.rpId,
    userID: Buffer.from(userHandle),
    userName: email,
    userDisplayName: displayName,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required'
    }
  });

  return {
    options,
    pending: {
      displayName,
      email,
      userHandle,
      challenge: options.challenge,
      rpId: rp.rpId,
      origin: rp.origin,
      createdAt: new Date().toISOString()
    }
  };
}

/**
 * Finish a passwordless enrolment, creating the account. The record carries no
 * passwordHash at all — verifyUserPassword refuses such accounts outright, so
 * the only way in is the credential just registered or a recovery code.
 */
async function finishPasswordlessRegistration(response, requestInfo, pending) {
  if (!pending?.challenge) {
    throw validationError('No enrolment challenge is active.');
  }

  const rp = resolveRelyingParty(requestInfo, pending);
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: pending.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpId,
    // Insisted on here, not merely requested in the options: without user
    // verification the credential is possession only, and this account has no
    // second factor behind it.
    requireUserVerification: true
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw validationError('Passkey enrolment could not be verified.');
  }

  const users = await store.read();
  if (users.some((user) => normalizeEmail(user.email) === normalizeEmail(pending.email))) {
    const error = new Error('An account already exists for this email.');
    error.status = 409;
    error.expose = true;
    throw error;
  }

  const credential = verification.registrationInfo.credential;
  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    email: normalizeEmail(pending.email),
    displayName: pending.displayName,
    phone: '',
    // Deliberately absent, not empty: bcrypt.compare('', '') returns false but
    // an empty string still looks like a credential. There is no password.
    passwordHash: null,
    passwordless: true,
    userHandle: pending.userHandle,
    emailVerifiedAt: null,
    preferredMfa: 'passkey',
    mfaMethods: { email: true, sms: false, passkey: true },
    passkeys: [
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
        createdAt: now,
        lastUsedAt: null
      }
    ],
    pendingSecondFactor: null,
    lastSecondFactorAt: now,
    createdAt: now,
    updatedAt: now
  };

  users.push(user);
  await store.write(users);
  return publicUser(user);
}

module.exports = {
  createOtpChallenge,
  finishPasskeyLogin,
  finishPasswordlessRegistration,
  startPasswordlessRegistration,
  startPasskeyLogin,
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
