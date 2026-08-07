const config = require('../config');
const { listPublicPlans } = require('./plan-service');

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
        'Raise an approval that must be signed in the wallet, then confirm the signature and its full context were written to the tamper-evident ledger.',
      tests: ['Wallet challenge', 'Approve and decline paths', 'Non-repudiable evidence'],
      // Defaults to the signatures area of the Business Expenses app.
      href:
        config.app.digitalSignatureUrl ||
        `${String(config.app.businessExpensesUrl).replace(/\/$/, '')}/apps/signatures`,
      action: 'Open signature app',
      meta: 'Signatures app'
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
    // The real catalogue, so the landing page cannot drift from what is sold
    // and enforced. plan-service is the single source for both.
    plans: listPublicPlans(),
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
    // The architecture picture, read left to right: how somebody proves who
    // they are, what Aegis decides, and what consumes the decision.
    //
    // The old strip was six unlabelled boxes joined by lines, which implied a
    // pipeline that does not exist — YubiKey does not flow into Entra ID. It
    // also put the Aegis wallet in the lab lane beside ACA-Py and left Aegis
    // itself out of its own architecture, which reads as though the product is
    // a set of somebody else's tools. Aegis is the policy decision point; the
    // rest are adapters.
    architecture: {
      eyebrow: 'How it fits together',
      title: 'Aegis ID decides. Everything else is an adapter.',
      lead:
        'Identity can be proven in several ways and consumed by any number of applications. What stays constant is the middle: one place that holds the policy, makes the call, and records the evidence.',
      columns: [
        {
          id: 'inbound',
          tone: 'blue',
          kicker: 'Step 1',
          title: 'Prove who you are',
          summary: 'Any of these, alone or combined, depending on what the moment is worth.',
          items: [
            { name: 'Passkeys and YubiKey', detail: 'Phishing-resistant, hardware-backed' },
            { name: 'Aegis wallet approval', detail: 'Approve or decline from your own device' },
            { name: 'Microsoft Entra ID', detail: 'Links to an existing account, never creates one' },
            { name: 'Verified ID', detail: 'A portable credential presented from Authenticator' },
            { name: 'Password and a code', detail: 'The baseline, never enough on its own' }
          ]
        },
        {
          id: 'core',
          tone: 'cyan',
          kicker: 'Step 2',
          title: 'Aegis ID decides',
          summary: 'Deny by default, enforced server-side, and written down whichever way it goes.',
          items: [
            { name: 'Authorization and policy', detail: 'One decision point, not per-application rules' },
            { name: 'Credential issuance', detail: 'Bound to a wallet, revocable, consent recorded' },
            { name: 'Root wallets and recovery', detail: 'The organization can recover itself' },
            { name: 'Evidence ledger', detail: 'Hash-chained and append only' }
          ]
        },
        {
          id: 'outbound',
          tone: 'green',
          kicker: 'Step 3',
          title: 'Applications act on it',
          summary: 'They ask Aegis rather than keeping their own copy of who may do what.',
          items: [
            { name: 'Connected apps', detail: 'Aegis-issued OIDC and OAuth' },
            { name: 'Business Expenses', detail: 'Wallet-signed approvals' },
            { name: 'Digital signature', detail: 'Envelope signing with wallet consent' },
            { name: 'Your own applications', detail: 'Any OIDC or SAML relying party' }
          ]
        }
      ],
      lab: {
        label: 'Interoperability lab',
        title: 'Kept off the product path on purpose.',
        summary:
          'ACA-Py agents and a VON dev ledger run in their own boundary for Aries interoperability testing. Nothing on the path above depends on them, which is why the product works on deployments where the lab is not running at all.',
        items: ['ACA-Py issuer, verifier, mediator', 'VON / Indy dev ledger', 'DIDComm and AnonCreds']
      }
    },
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
    ...overrides
  };
}

module.exports = {
  getHomeContent,
  getTestingApps
};
