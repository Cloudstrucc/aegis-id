// Typed evidence-ledger helpers for the Entra-federation + passkey lifecycle
// (plan §5.F and §5.H). Each is a thin, named wrapper over writeAuditEvent so
// onboarding, authentication, and TAA acceptance produce well-known, chained,
// tamper-evident events with a stable shape.

const { writeAuditEvent } = require('./audit-service');

// Onboarding: identity proofing (in-person or verification service).
function recordIdentityProofed({ subject, officer, method, idImageHash, faceImageHash } = {}) {
  return writeAuditEvent('identity.proofed', { subject, officer, method, idImageHash, faceImageHash });
}

// Onboarding: a passkey / YubiKey bound to the proofed identity (public credential only).
function recordAuthenticatorBound({ subject, credentialId, aaguid, type, boundBy } = {}) {
  return writeAuditEvent('authenticator.bound', { subject, credentialId, aaguid, type, boundBy });
}

// Wallet first-run setup: a Wallet ID was minted for this device.
function recordWalletRegistered({ walletId, email, hasPhone } = {}) {
  return writeAuditEvent('wallet.registered', { walletId, email, hasPhone });
}

// Onboarding: the mobile wallet enrolled and bound to the identity.
function recordWalletEnrolled({ subject, walletId } = {}) {
  return writeAuditEvent('wallet.enrolled', { subject, walletId });
}

// Holder changed their global wallet contact after an approved challenge.
function recordWalletContactChanged({ walletId, field, approvedByChallengeId } = {}) {
  return writeAuditEvent('wallet.contact.changed', { walletId, field, approvedByChallengeId });
}

// Each federated sign-in: claims-based authentication evidence from Entra.
function recordIdentityAuthenticated({ subject, amr, acr, authTime, tenant } = {}) {
  return writeAuditEvent('identity.authenticated', { subject, amr, acr, authTime, tenant });
}

// Production Indy write access: Transaction Author Agreement acceptance (§5.F).
function recordTaaAcceptance({ network, version, digest, mechanism, approver } = {}) {
  return writeAuditEvent('taa.accepted', { network, version, digest, mechanism, approver });
}

module.exports = {
  recordIdentityProofed,
  recordAuthenticatorBound,
  recordWalletRegistered,
  recordWalletContactChanged,
  recordWalletEnrolled,
  recordIdentityAuthenticated,
  recordTaaAcceptance
};
