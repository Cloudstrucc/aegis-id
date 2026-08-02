// Which ways people may sign in, and what each one counts for.
//
// Two ideas are kept apart deliberately:
//
//   firstFactor      — this method can start a sign-in
//   satisfiesSecond  — completing it means no separate second factor is needed
//
// A passkey or a wallet approval with user verification is already possession
// plus inherence, so stacking an emailed code on top adds friction without
// adding assurance. A password is neither, so it never satisfies the second.

const config = require('../config');
const FileJsonStore = require('./file-json-store');
const { writeAuditEvent } = require('./audit-service');

const store = new FileJsonStore(config.paths.signInMethods, {});

const CATALOG = Object.freeze({
  password: {
    id: 'password',
    label: 'Email and password',
    description: 'Password followed by an emailed or texted code, or a passkey.',
    implemented: true,
    canBeFirst: true,
    canSatisfySecond: false,
    defaults: { enabled: true, firstFactor: true, satisfiesSecond: false }
  },
  passkey: {
    id: 'passkey',
    label: 'Passkey',
    description: 'Face ID, Touch ID, Windows Hello or a security key. No password needed.',
    implemented: true,
    canBeFirst: true,
    canSatisfySecond: true,
    defaults: { enabled: true, firstFactor: true, satisfiesSecond: true }
  },
  entra: {
    id: 'entra',
    label: 'Microsoft Entra ID',
    description: 'Federate to your enterprise tenant. Links to an existing Aegis account only.',
    implemented: false,
    canBeFirst: true,
    canSatisfySecond: true,
    defaults: { enabled: false, firstFactor: true, satisfiesSecond: true }
  },
  wallet: {
    id: 'wallet',
    label: 'Aegis wallet approval',
    description: 'Approve the sign-in from a registered wallet. Requires a wallet already bound to the account.',
    implemented: false,
    canBeFirst: true,
    canSatisfySecond: true,
    defaults: { enabled: false, firstFactor: true, satisfiesSecond: true }
  }
});

function mergeDefaults(saved = {}) {
  return Object.fromEntries(
    Object.values(CATALOG).map((method) => {
      const stored = saved[method.id] || {};
      const merged = { ...method.defaults, ...stored };
      return [
        method.id,
        {
          enabled: Boolean(merged.enabled) && method.implemented,
          firstFactor: Boolean(merged.firstFactor) && method.canBeFirst,
          satisfiesSecond: Boolean(merged.satisfiesSecond) && method.canSatisfySecond
        }
      ];
    })
  );
}

async function getSignInMethods() {
  return mergeDefaults(await store.read());
}

/** Can this method start a sign-in right now? */
async function isFirstFactorEnabled(id) {
  const methods = await getSignInMethods();
  return Boolean(methods[id]?.enabled && methods[id]?.firstFactor);
}

/** Does completing this method mean no separate second factor is required? */
async function satisfiesSecondFactor(id) {
  const methods = await getSignInMethods();
  return Boolean(methods[id]?.enabled && methods[id]?.satisfiesSecond);
}

async function getSignInMethodsForDisplay() {
  const methods = await getSignInMethods();
  return Object.values(CATALOG).map((method) => ({
    ...method,
    ...methods[method.id]
  }));
}

/**
 * Save the registry. Refuses to leave the platform with no way in — without
 * this an admin can lock out every user including themselves, and the only
 * recovery is editing JSON on the server.
 */
async function updateSignInMethods(input = {}, actorEmail = null) {
  const next = Object.fromEntries(
    Object.values(CATALOG).map((method) => [
      method.id,
      {
        enabled: booleanField(input[`method_${method.id}_enabled`]) && method.implemented,
        firstFactor: booleanField(input[`method_${method.id}_first`]) && method.canBeFirst,
        satisfiesSecond: booleanField(input[`method_${method.id}_second`]) && method.canSatisfySecond
      }
    ])
  );

  const firstFactors = Object.entries(next).filter(([, value]) => value.enabled && value.firstFactor);
  if (firstFactors.length === 0) {
    const error = new Error(
      'At least one sign-in method must stay enabled as a first factor, or nobody can sign in.'
    );
    error.status = 422;
    error.expose = true;
    throw error;
  }

  // Wallet sign-in cannot be the only way in: it needs a wallet already bound
  // to the account, so a new or wallet-less user would have no route at all.
  if (firstFactors.length === 1 && firstFactors[0][0] === 'wallet') {
    const error = new Error(
      'Wallet approval cannot be the only sign-in method, because it requires a wallet that is already registered.'
    );
    error.status = 422;
    error.expose = true;
    throw error;
  }

  await store.write(next);
  await writeAuditEvent('admin.sign-in-methods.updated', {
    actorEmail,
    enabled: firstFactors.map(([id]) => id)
  });
  return next;
}

function booleanField(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

module.exports = {
  CATALOG,
  getSignInMethods,
  getSignInMethodsForDisplay,
  isFirstFactorEnabled,
  satisfiesSecondFactor,
  updateSignInMethods
};
