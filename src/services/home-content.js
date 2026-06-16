const config = require('../config');

function getHomeContent(overrides = {}) {
  return {
    title: 'Vanguard Cloud Services - Aegis ID',
    description:
      'Dual-track verified identity architecture for Microsoft Entra Verified ID production and Aries interoperability labs.',
    plans: [
      {
        id: 'pilot',
        name: 'Pilot',
        price: 'Free-tier fit',
        summary: 'Landing page, subscription capture, mock Verified ID flows, organization workspaces, and local Aries lab.'
      },
      {
        id: 'sandbox',
        name: 'Sandbox',
        price: 'Tenant-connected',
        summary: 'Azure App Service plus Entra app registration, Verified ID tenant setup, and callback testing.'
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        price: 'Production governed',
        summary: 'Key Vault, monitoring, custom domains, hardened storage, and policy-controlled issuance.'
      }
    ],
    tracks: [
      {
        label: 'Production Track',
        title: 'Microsoft-native trust path',
        summary:
          'Entra ID, YubiKey/passkeys, Conditional Access, and Microsoft Entra Verified ID stay in one governed enterprise lane.',
        markers: ['FIDO2 sign-in', 'Verified ID issuance', 'Presentation callbacks', 'Audit-ready events']
      },
      {
        label: 'Interoperability Track',
        title: 'Aries lab without production coupling',
        summary:
          'ACA-Py issuer, verifier, mediator, Bifold/Credo wallets, and a VON/Indy dev ledger live in a separate lab boundary.',
        markers: ['DIDComm', 'AnonCreds', 'Mediator testing', 'Wallet interop']
      }
    ],
    formValues: {
      displayName: '',
      email: '',
      phone: '',
      organization: '',
      role: '',
      plan: 'pilot',
      interest: 'both',
      preferredMfa: config.auth.defaultMfaMethod
    },
    formErrors: {},
    ...overrides
  };
}

module.exports = { getHomeContent };
