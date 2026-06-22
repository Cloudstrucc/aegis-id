const config = require('../config');

function getHomeContent(overrides = {}) {
  return {
    title: 'Vanguard Cloud Services - Aegis ID',
    description:
      'Governed identity assurance, wallet challenges, and interoperability labs for enterprise applications.',
    iosDownloadUrl: config.app.iosTestFlightUrl,
    hasIosDownloadUrl: Boolean(config.app.iosTestFlightUrl),
    androidDownloadUrl: config.app.androidTestingUrl,
    hasAndroidDownloadUrl: Boolean(config.app.androidTestingUrl),
    productBriefUrl: '/docs/aegis-verified-id-value-story.html',
    exampleApps: [
      {
        label: 'Standalone example',
        title: 'Business Expenses',
        summary:
          'Try OIDC sign-in, Verified ID or YubiKey assurance, wallet-signed expense approvals, and ledger reporting.',
        href: config.app.businessExpensesUrl,
        action: 'Open Business Expenses',
        meta: config.app.env === 'production' ? 'Azure App Service' : 'Localhost demo'
      },
      {
        label: 'Built-in example',
        title: 'OIDC wallet challenge',
        summary:
          'Use the built-in relying-party demo to send an Aegis wallet challenge from an organization connection.',
        href: '/demo/oidc-wallet',
        action: 'Open OIDC demo',
        meta: 'Runs inside Aegis ID'
      }
    ],
    productBriefCards: [
      {
        icon: '01',
        title: 'Credential proof',
        summary: 'Microsoft Verified ID presents portable employee, contractor, partner, or badge credentials.'
      },
      {
        icon: '02',
        title: 'Hardware assurance',
        summary: 'YubiKey and FIDO2 add phishing-resistant proof for sign-in, admin step-up, and sensitive actions.'
      },
      {
        icon: '03',
        title: 'Wallet evidence',
        summary: 'The Aegis ID mobile app records approval, consent, revocation, and high-value decision challenges.'
      }
    ],
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
        title: 'Enterprise assurance path',
        summary:
          'Verified credentials, YubiKey/passkeys, OIDC/SAML integrations, wallet challenges, and audit evidence stay in one governed enterprise lane.',
        markers: ['FIDO2 sign-in', 'Verified ID issuance', 'Presentation callbacks', 'Audit-ready events']
      },
      {
        label: 'Interoperability Track',
        title: 'Aries lab without production coupling',
        summary:
          'ACA-Py issuer, verifier, mediator, the Aegis ID mobile app, and a VON/Indy dev ledger live in a separate lab boundary.',
        markers: ['DIDComm', 'AnonCreds', 'Mediator testing', 'Wallet interop']
      }
    ],
    assuranceModes: [
      {
        icon: 'VID',
        title: 'Verified ID credential proof',
        summary: 'Use Microsoft Authenticator to present portable employee, contractor, badge, or eligibility credentials.'
      },
      {
        icon: 'YK',
        title: 'YubiKey FIDO2 step-up',
        summary: 'Use YubiKey 5C NFC for phishing-resistant sign-in, administrator step-up, and sensitive workflow protection.'
      },
      {
        icon: 'LOG',
        title: 'Aegis wallet challenge ledger',
        summary: 'Capture approval, consent, revocation, promotion, and high-value decision evidence across web apps and portals.'
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
