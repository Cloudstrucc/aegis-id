const config = require('../config');

// Demo and test applications, surfaced on the authenticated Testing page.
function getTestingApps() {
  const hosted = config.app.env === 'production';
  return [
    {
      id: 'business-expenses',
      label: 'Standalone application',
      title: 'Business Expenses',
      purpose: 'Shows Aegis ID protecting a real relying-party application end to end.',
      summary:
        'Sign in with Aegis OIDC, satisfy a Verified ID or YubiKey assurance step, then approve an expense from your wallet. Every approval lands in the immutable ledger.',
      tests: ['OIDC sign-in', 'Assurance step-up', 'Wallet-signed approval', 'Ledger evidence'],
      href: config.app.businessExpensesUrl,
      action: 'Open Business Expenses',
      meta: hosted ? 'Azure App Service' : 'Localhost demo'
    },
    {
      id: 'digital-signature',
      label: 'Signature flow',
      title: 'Digital signature approval',
      purpose: 'Exercises the wallet as a signing device for a high-value action.',
      summary:
        'Raise an approval that must be signed in the wallet, then confirm the signature and its full context were written to the tamper-evident ledger. Runs inside Business Expenses, which is where signed approvals originate.',
      tests: ['Wallet challenge', 'Approve and decline paths', 'Non-repudiable evidence'],
      href: config.app.businessExpensesUrl,
      action: 'Open signature flow',
      meta: 'Part of Business Expenses'
    },
    {
      id: 'oidc-wallet',
      label: 'Built-in demo',
      title: 'OIDC wallet challenge',
      purpose: 'Tests the wallet gate on its own, without needing a separate application.',
      summary:
        'Sign in through the mock identity provider as any credential holder, send a wallet challenge to their wallet, and unlock the protected page once it is approved.',
      tests: ['Mock OIDC login', 'Organization-addressed challenge', 'Wallet approval unlock'],
      href: '/demo/oidc-wallet',
      action: 'Open OIDC demo',
      meta: 'Runs inside Aegis ID'
    }
  ];
}

function getHomeContent(overrides = {}) {
  return {
    title: 'Vanguard Cloud Services - Aegis ID',
    description:
      'Governed identity assurance, wallet challenges, and interoperability labs for enterprise applications.',
    iosDownloadUrl: config.app.iosTestFlightUrl,
    hasIosDownloadUrl: Boolean(config.app.iosTestFlightUrl),
    androidDownloadUrl: config.app.androidTestingUrl,
    hasAndroidDownloadUrl: Boolean(config.app.androidTestingUrl),
    productBriefUrl: '/docs/aegis-id-overview.html',
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
        summary: 'Verified credentials present portable employee, contractor, partner, or badge proof across trusted workflows.'
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

module.exports = {
  getHomeContent,
  getTestingApps
};
