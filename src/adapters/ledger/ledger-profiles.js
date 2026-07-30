// Ledger-profile / network registry (plan §3, Features B/C/D).
//
// A profile bundles everything the app + ACA-Py need to target one Indy network.
// This unifies VON (local), CANdy, and Sovrin into a single, config-selected
// abstraction so adding a network is data, not scattered code. Selecting a
// profile does NOT connect to anything — genesis fetch / TAA / writes happen in
// the issuer agent once a network is actually onboarded.
//
// Genesis URLs for CANdy / Sovrin are intentionally left blank: they are pinned
// per environment via LEDGER_GENESIS_URL during Phase 4/5 onboarding, not
// hard-coded here (they rotate and are governance-controlled).

const config = require('../../config');

const PROFILES = Object.freeze({
  none: {
    id: 'none',
    writable: false,
    taaRequired: false,
    jurisdiction: 'none',
    indyNamespace: '',
    genesisSource: '',
    tailsServer: '',
    endorserDid: '',
    note: 'No Indy ledger. did:web / Verified ID path only.'
  },
  'von-local': {
    id: 'von-local',
    writable: true,
    taaRequired: false,
    jurisdiction: 'local',
    indyNamespace: 'von:local',
    genesisSource: 'http://von-network:9000/genesis',
    tailsServer: 'http://tails:6543',
    endorserDid: '',
    note: 'Local developer sandbox ledger (bcgov/von-network). Not for production.'
  },
  'candy-test': {
    id: 'candy-test',
    writable: true,
    taaRequired: true,
    jurisdiction: 'CA',
    indyNamespace: 'candy:test',
    genesisSource: '',
    tailsServer: '',
    endorserDid: '',
    note: 'CANdy test network. Set LEDGER_GENESIS_URL + endorser + TAA before writes.'
  },
  'candy-prod': {
    id: 'candy-prod',
    writable: true,
    taaRequired: true,
    jurisdiction: 'CA',
    indyNamespace: 'candy:prod',
    genesisSource: '',
    tailsServer: '',
    endorserDid: '',
    note: 'CANdy production network (Canadian public sector). Requires endorser + TAA.'
  },
  'sovrin-staging': {
    id: 'sovrin-staging',
    writable: true,
    taaRequired: true,
    jurisdiction: 'global',
    indyNamespace: 'sovrin:staging',
    genesisSource: '',
    tailsServer: '',
    endorserDid: '',
    note: 'Sovrin StagingNet. Validate the full flow here before MainNet.'
  },
  'sovrin-main': {
    id: 'sovrin-main',
    writable: true,
    taaRequired: true,
    jurisdiction: 'global',
    indyNamespace: 'sovrin',
    genesisSource: '',
    tailsServer: '',
    endorserDid: '',
    note: 'Sovrin MainNet (global). Requires endorser + TAA acceptance.'
  }
});

// Overlay environment/config overrides (genesis URL, endorser DID, tails server,
// did:indy namespace) onto a base profile.
function applyOverrides(profile) {
  const ledger = config.ledger || {};
  return Object.freeze({
    ...profile,
    genesisSource: ledger.genesisUrl || profile.genesisSource,
    endorserDid: ledger.endorserDid || profile.endorserDid,
    tailsServer: ledger.tailsServerBaseUrl || profile.tailsServer,
    indyNamespace: ledger.indyDidNamespace || profile.indyNamespace
  });
}

function listProfiles() {
  return Object.values(PROFILES).map(applyOverrides);
}

function getProfile(id) {
  const profile = PROFILES[id];
  if (!profile) {
    const error = new Error(`Unknown ledger profile: ${id}`);
    error.status = 400;
    throw error;
  }
  return applyOverrides(profile);
}

function getActiveProfile() {
  const id = (config.ledger && config.ledger.network) || 'none';
  return getProfile(id);
}

function requiresTaaAcceptance() {
  return getActiveProfile().taaRequired;
}

// True only when a writable network is selected AND its write prerequisites
// (genesis + endorser, and TAA if required) are configured.
function isWriteReady(profile = getActiveProfile()) {
  if (!profile.writable || profile.id === 'none') {
    return false;
  }
  if (!profile.genesisSource) {
    return false;
  }
  if (profile.taaRequired && !(config.ledger && config.ledger.taaAccept)) {
    return false;
  }
  return true;
}

module.exports = {
  PROFILES,
  listProfiles,
  getProfile,
  getActiveProfile,
  requiresTaaAcceptance,
  isWriteReady
};
