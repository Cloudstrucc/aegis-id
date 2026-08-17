const express = require('express');
const QRCode = require('qrcode');

const config = require('../config');
const { requireAuthenticated } = require('../middleware/auth');
const { getPresentationPolicy } = require('../services/credential-policy-service');
const { getHealthDashboard } = require('../services/health-service');
const { getHomeContent } = require('../services/home-content');
const { getCredentialInvitationView } = require('../services/org-admin-service');
const { authorize } = require('../middleware/authorization');
const { getTestingApps } = require('../services/home-content');
const { buildAccountLanding } = require('../services/account-landing-service');
const {
  getNotificationSettingsForDisplay,
  updateNotificationSettings
} = require('../services/notification-settings-service');
const { verifyEmail } = require('../adapters/notify/notification-adapter');
const { listDeliveryLog } = require('../services/otp-delivery-service');
const {
  getSignInMethodsForDisplay,
  updateSignInMethods
} = require('../services/sign-in-methods-service');
const {
  grantReenrolment,
  listPasswordlessAccounts
} = require('../services/account-reenrolment-service');
const {
  deleteWallet,
  listWallets,
  restoreWallet,
  revokeWallet
} = require('../services/wallet-registry-service');
const { countCredentialsByWalletId } = require('../services/org-admin-service');
const {
  createRegistrationCode,
  currentEnvironment,
  listRegistrationCodes,
  revokeRegistrationCode
} = require('../services/registration-code-service');
const { PLANS, describePrice } = require('../services/plan-service');
const { listIdentities, revokeVerification } = require('../services/organization-identity-service');
const { listBreakGlassCodes, redeemBreakGlassCode } = require('../services/break-glass-service');
const { writeAuditEvent } = require('../services/audit-service');

// The environments a code may be scoped to. Deliberately an explicit list
// rather than free text, so a typo produces a code that works nowhere instead
// of one that quietly works everywhere.
const CODE_ENVIRONMENTS = ['local', 'dev', 'qa', 'prod'];

function registrationCodeFormOptions() {
  return {
    planChoices: Object.values(PLANS)
      .filter((plan) => plan.requiresPayment)
      .map((plan) => ({ id: plan.id, label: plan.label, price: describePrice(plan) })),
    environmentChoices: CODE_ENVIRONMENTS.map((name) => ({
      name,
      isCurrent: name === currentEnvironment(),
      // Naming prod is a free paid subscription, so the form says so.
      isProduction: name === 'prod'
    })),
    environment: currentEnvironment()
  };
}

const router = express.Router();

// Signed-in users land on their organizations rather than the marketing page.
router.get('/', authorize('public.home'), async (req, res, next) => {
  try {
    if (req.isAuthenticated?.() && req.user) {
      const landing = await buildAccountLanding(req.user);
      if (landing.redirectTo) {
        return res.redirect(303, landing.redirectTo);
      }
      return res.render('pages/account', landing.view);
    }

    res.render('pages/home', getHomeContent());
  } catch (error) {
    next(error);
  }
});

router.get('/architecture', requireAuthenticated, authorize('account.view'), (req, res) => {
  res.render('pages/architecture', {
    title: 'Architecture',
    description: 'Vanguard Cloud Services - Aegis ID reference architecture.',
    policy: getPresentationPolicy(),
    microsoftMode: config.verifiedId.mode
  });
});

// The platform administration index.
//
// Everything here was previously reachable only by typing the URL, which is how
// two broken pages went unnoticed for a release. Each card carries a live count
// so the page is worth opening rather than being a list of links.
router.get('/admin', authorize('admin.dashboard.view'), async (req, res, next) => {
  try {
    const [wallets, codes, passwordlessAccounts, methods, notificationSettings, identities, glassCodes] =
      await Promise.all([
        listWallets(),
        listRegistrationCodes(),
        listPasswordlessAccounts(),
        getSignInMethodsForDisplay(),
        getNotificationSettingsForDisplay(),
        listIdentities(),
        listBreakGlassCodes()
      ]);

    const revokedWallets = wallets.filter((wallet) => wallet.status === 'revoked').length;
    const usableCodes = codes.filter((code) => code.isUsable).length;
    const exhausted = passwordlessAccounts.filter((account) => account.remainingCodes === 0).length;
    const enabledMethods = methods.filter((method) => method.firstFactor || method.satisfiesSecond).length;
    const verifiedDomains = identities.filter((entry) => entry.isVerified).length;
    const unverifiedDomains = identities.length - verifiedDomains;
    const breakGlassRedeemed = glassCodes.filter((entry) => entry.isRedeemed).length;

    res.render('pages/admin-dashboard', {
      title: 'Administration',
      description: 'Platform settings for Aegis ID.',
      environment: currentEnvironment(),
      isNonProd: config.app.deployEnv !== 'prod',
      billing: {
        checkoutEnabled: config.billing.checkoutEnabled,
        isTestMode: config.billing.isTestMode
      },
      cards: [
        {
          href: '/admin/wallets',
          title: 'Registered wallets',
          summary: 'Withdraw a wallet from service, restore one, or remove one that was never used.',
          stat: wallets.length,
          statLabel: wallets.length === 1 ? 'wallet' : 'wallets',
          note: revokedWallets ? `${revokedWallets} withdrawn from service` : null,
          isWarning: revokedWallets > 0
        },
        {
          href: '/admin/registration-codes',
          title: 'Registration codes',
          summary: 'Grant a paid plan without payment, for testers and comped pilots.',
          stat: usableCodes,
          statLabel: usableCodes === 1 ? 'usable code' : 'usable codes',
          note: codes.length ? `${codes.length} issued in total` : 'None issued yet'
        },
        {
          href: '/admin/sign-in-methods',
          title: 'Sign-in methods',
          summary: 'Choose how people may sign in, and what each method counts for.',
          stat: enabledMethods,
          statLabel: enabledMethods === 1 ? 'method enabled' : 'methods enabled'
        },
        {
          href: '/admin/notifications',
          title: 'Notification delivery',
          summary: 'How codes, links and notices are sent by email and SMS.',
          stat: deliveryChannelCount(notificationSettings),
          statLabel: 'channels configured',
          note: deliveryChannelCount(notificationSettings) ? null : 'Recovery will fail closed',
          isWarning: deliveryChannelCount(notificationSettings) === 0
        },
        {
          href: '/admin/domains',
          title: 'Organization domains',
          summary: 'Which organizations have proven the domain they claim, and which are still self-declared.',
          stat: verifiedDomains,
          statLabel: verifiedDomains === 1 ? 'verified domain' : 'verified domains',
          note: unverifiedDomains ? `${unverifiedDomains} unverified` : null,
          isWarning: unverifiedDomains > 0
        },
        {
          href: '/admin/break-glass',
          title: 'Break-glass recovery',
          summary: 'Recover an organization that has lost every root wallet. Needs their code and their root wallet\'s prior authorisation.',
          stat: breakGlassRedeemed,
          statLabel: breakGlassRedeemed === 1 ? 'code redeemed' : 'codes redeemed',
          note: breakGlassRedeemed ? 'Every use is on the evidence chain' : null
        },
        {
          href: '/admin/account-recovery',
          title: 'Account recovery',
          summary: 'Passwordless accounts and their remaining recovery codes.',
          stat: passwordlessAccounts.length,
          statLabel: passwordlessAccounts.length === 1 ? 'passwordless account' : 'passwordless accounts',
          note: exhausted ? `${exhausted} out of codes` : null,
          isWarning: exhausted > 0
        }
      ]
    });
  } catch (error) {
    next(error);
  }
});

/** How many delivery channels are actually switched on. */
function deliveryChannelCount(settings) {
  return [settings?.email?.enabled, settings?.sms?.enabled].filter(Boolean).length;
}

// Every organization identity on the deployment, and the ability to withdraw a
// verification when a domain changes hands.
router.get('/admin/domains', authorize('admin.domains.manage'), async (req, res, next) => {
  try {
    const identities = await listIdentities();
    res.render('pages/domain-admin', {
      title: 'Organization domains',
      description: 'Which organizations have proven the domain they claim.',
      identities: identities.sort((left, right) => {
        // Unverified first: those are the ones a holder cannot check.
        if (left.isVerified !== right.isVerified) {
          return left.isVerified ? 1 : -1;
        }
        return String(left.organization).localeCompare(String(right.organization));
      }),
      verifiedCount: identities.filter((entry) => entry.isVerified).length,
      saved: req.query.saved || null,
      errorMessage: req.query.error || null
    });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/domains', authorize('admin.domains.manage'), async (req, res, next) => {
  try {
    await revokeVerification(req.body.workspaceId, {
      actorEmail: req.user?.email,
      reason: req.body.reason
    });
    return res.redirect(303, '/admin/domains?saved=revoked');
  } catch (error) {
    if (error.expose) {
      return res.redirect(303, `/admin/domains?error=${encodeURIComponent(error.message)}`);
    }
    return next(error);
  }
});

// Redeeming a break-glass code a customer has sent in.
//
// This is the only path from an administrator here into a customer
// organization, and it is deliberately not a path anybody here can walk alone:
// it needs the code, which only the customer holds, and that code is inert
// unless one of their root wallets authorised it in advance.
router.get('/admin/break-glass', authorize('admin.breakGlass.redeem'), async (req, res, next) => {
  try {
    res.render('pages/break-glass-admin', {
      title: 'Break-glass recovery',
      description: 'Recover an organization that has lost every root wallet.',
      history: (await listBreakGlassCodes()).filter((entry) => entry.isRedeemed),
      redeemed: req.query.organization || null,
      errorMessage: req.query.error || null
    });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/break-glass', authorize('admin.breakGlass.redeem'), async (req, res, next) => {
  try {
    const result = await redeemBreakGlassCode(req.body.code, {
      actorEmail: req.user?.email,
      ticketReference: req.body.ticketReference
    });
    return res.redirect(303, `/admin/break-glass?organization=${encodeURIComponent(result.organization)}`);
  } catch (error) {
    if (error.expose) {
      return res.redirect(303, `/admin/break-glass?error=${encodeURIComponent(error.message)}`);
    }
    return next(error);
  }
});

// Registered wallets, with the credential count that decides whether a wallet
// may be deleted or must only be revoked.
router.get('/admin/wallets', authorize('admin.wallets.manage'), async (req, res, next) => {
  try {
    const [wallets, counts] = await Promise.all([listWallets(), countCredentialsByWalletId()]);
    const rows = wallets
      .map((wallet) => {
        const credentialCount = counts.get(wallet.walletId) || 0;
        return {
          walletId: wallet.walletId,
          email: wallet.email,
          phone: wallet.phone || null,
          status: wallet.status || 'active',
          isRevoked: wallet.status === 'revoked',
          revokedReason: wallet.revokedReason || null,
          revokedBy: wallet.revokedBy || null,
          registeredAt: wallet.registeredAt || wallet.createdAt || null,
          credentialCount,
          // Only a wallet that never held a credential can be erased; anything
          // else has history worth keeping.
          canDelete: credentialCount === 0
        };
      })
      .sort((left, right) => String(right.registeredAt).localeCompare(String(left.registeredAt)));

    res.render('pages/wallet-admin', {
      title: 'Registered wallets',
      description: 'Withdraw a wallet from service, restore one, or remove a wallet that was never used.',
      wallets: rows,
      revokedCount: rows.filter((row) => row.isRevoked).length,
      saved: req.query.saved || null,
      errorMessage: req.query.error || null
    });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/wallets', authorize('admin.wallets.manage'), async (req, res, next) => {
  try {
    const { walletId, action, reason } = req.body;
    const actorEmail = req.user?.email;

    if (action === 'revoke') {
      await revokeWallet(walletId, { actorEmail, reason });
      return res.redirect(303, '/admin/wallets?saved=revoked');
    }
    if (action === 'restore') {
      await restoreWallet(walletId, { actorEmail });
      return res.redirect(303, '/admin/wallets?saved=restored');
    }
    if (action === 'delete') {
      // Re-count here rather than trusting the form: the page may have been
      // open since before a credential was issued.
      const counts = await countCredentialsByWalletId();
      await deleteWallet(walletId, {
        actorEmail,
        reason,
        usageCount: counts.get(walletId) || 0
      });
      return res.redirect(303, '/admin/wallets?saved=deleted');
    }

    return res.redirect(303, '/admin/wallets?error=Unknown+action');
  } catch (error) {
    if (error.expose || error.status === 404) {
      return res.redirect(303, `/admin/wallets?error=${encodeURIComponent(error.message)}`);
    }
    return next(error);
  }
});

// Passwordless accounts and their remaining recovery codes. An account with
// none left cannot get back in on its own — that hard stop is deliberate, and
// this is where an administrator resolves it.
router.get('/admin/account-recovery', authorize('admin.accountRecovery.manage'), async (req, res, next) => {
  try {
    const accounts = await listPasswordlessAccounts();
    res.render('pages/account-recovery-admin', {
      title: 'Account recovery',
      description: 'Passwordless accounts, their remaining recovery codes, and re-enrolment.',
      accounts,
      lockedOutCount: accounts.filter((account) => account.lockedOut).length,
      saved: req.query.saved === '1',
      errorMessage: req.query.error || null
    });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/account-recovery', authorize('admin.accountRecovery.manage'), async (req, res, next) => {
  try {
    await grantReenrolment(req.body.userId, {
      actorEmail: req.user?.email,
      baseUrl: config.app.publicBaseUrl,
      reason: req.body.reason
    });
    return res.redirect(303, '/admin/account-recovery?saved=1');
  } catch (error) {
    if (error.expose) {
      return res.redirect(303, `/admin/account-recovery?error=${encodeURIComponent(error.message)}`);
    }
    return next(error);
  }
});

// Where somebody gets help.
//
// Public and unauthenticated on purpose: the people who most need it are the
// ones who cannot sign in, and it is also the page the App Store requires as a
// support URL — a listing cannot point at something behind a login.
router.get('/support', authorize('public.home'), (req, res) => {
  res.render('pages/support', {
    title: 'Support',
    description: 'Get help with Vanguard Aegis ID and the Aegis ID wallet.',
    supportEmail: config.app.supportEmail,
    hasSupportEmail: Boolean(config.app.supportEmail),
    walletUrlScheme: config.app.walletUrlScheme,
    hasAndroidDownload: Boolean(config.app.androidTestingUrl),
    iosTestFlightUrl: config.app.iosTestFlightUrl,
    hasIosTestFlight: Boolean(config.app.iosTestFlightUrl),
    // Set on production only. Elsewhere the page offers the test builds
    // instead, which are the ones a tester on that environment can use.
    appStoreUrl: config.app.appStoreUrl,
    hasAppStore: Boolean(config.app.appStoreUrl),
    playStoreUrl: config.app.playStoreUrl,
    hasPlayStore: Boolean(config.app.playStoreUrl),
    privacyPolicyUrl: config.app.privacyPolicyUrl,
    hasPrivacyPolicy: Boolean(config.app.privacyPolicyUrl),
    deployEnv: config.app.deployEnv,
    isNonProd: config.app.deployEnv !== 'prod'
  });
});

// The privacy policy, which the App Store and Play both require a URL for.
//
// Public for the same reason /support is: a store listing cannot point at a
// page behind a login, and somebody deciding whether to install the wallet has
// no account yet.
router.get('/privacy', authorize('public.home'), (req, res) => {
  res.render('pages/privacy', {
    // Updated by hand when the policy changes, which is the point — it should
    // not move because a deployment happened.
    lastUpdated: '17 August 2026',
    title: 'Privacy policy',
    description: 'What Vanguard Aegis ID collects, why, and what stays on your device.',
    supportEmail: config.app.supportEmail,
    hasSupportEmail: Boolean(config.app.supportEmail),
    // Billing only exists where there is a key to take a payment with, so the
    // page does not describe a payment processor that is not in the picture.
    checkoutEnabled: config.billing.checkoutEnabled,
    deployEnv: config.app.deployEnv,
    isNonProd: config.app.deployEnv !== 'prod'
  });
});

// Sideloading instructions for the Android wallet. Public, because the badge
// that links here is on the public home page — but deliberately a page rather
// than a bare link to the .apk, so nobody meets Android's "unknown source"
// block with no explanation of what they are installing or why.
router.get('/downloads/android', authorize('public.home'), (req, res) => {
  res.render('pages/android-download', {
    title: 'Install the Aegis ID wallet on Android',
    description: 'Download and install the Vanguard Aegis ID Android wallet for testing.',
    androidDownloadUrl: config.app.androidTestingUrl,
    hasAndroidDownloadUrl: Boolean(config.app.androidTestingUrl),
    androidPackageName: config.mobileApps.androidPackageName,
    deployEnv: config.app.deployEnv,
    // A build is bound to the server it was compiled against, so a tester who
    // installs the wrong one gets failures that look like the app is broken.
    isNonProdBuild: config.app.deployEnv !== 'prod'
  });
});

// Which sign-in methods the platform offers.
router.get('/admin/sign-in-methods', authorize('admin.signInMethods.manage'), async (req, res, next) => {
  try {
    res.render('pages/sign-in-methods', {
      title: 'Sign-in methods',
      description: 'Choose how people may sign in to Aegis ID.',
      methods: await getSignInMethodsForDisplay(),
      saved: req.query.saved === '1',
      errorMessage: req.query.error || null
    });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/sign-in-methods', authorize('admin.signInMethods.manage'), async (req, res, next) => {
  try {
    await updateSignInMethods(req.body, req.user?.email);
    return res.redirect(303, '/admin/sign-in-methods?saved=1');
  } catch (error) {
    if (error.expose) {
      return res.redirect(303, `/admin/sign-in-methods?error=${encodeURIComponent(error.message)}`);
    }
    return next(error);
  }
});

// Registration codes: a paid plan without payment, for testers and comped
// pilots.
router.get('/admin/registration-codes', authorize('admin.registrationCodes.manage'), async (req, res, next) => {
  try {
    res.render('pages/registration-codes', {
      title: 'Registration codes',
      description: 'Issue a code that grants a paid plan without payment.',
      codes: await listRegistrationCodes(),
      ...registrationCodeFormOptions(),
      issued: null,
      errorMessage: req.query.error || null,
      saved: req.query.saved || null
    });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/registration-codes', authorize('admin.registrationCodes.manage'), async (req, res, next) => {
  try {
    if (req.body.action === 'revoke') {
      await revokeRegistrationCode(req.body.codeId, { actorEmail: req.user?.email });
      return res.redirect(303, '/admin/registration-codes?saved=revoked');
    }

    // A checkbox group arrives as a string when one box is ticked.
    const environments = [].concat(req.body.environments || []);
    const { code, record } = await createRegistrationCode({
      planId: req.body.planId,
      environments,
      maxRedemptions: req.body.maxRedemptions,
      expiresInDays: req.body.expiresInDays,
      note: req.body.note,
      actorEmail: req.user?.email
    });

    // Rendered rather than redirected: the plaintext code exists only in this
    // response, and a redirect would put it in the URL, the browser history and
    // every access log between here and the admin.
    return res.render('pages/registration-codes', {
      title: 'Registration codes',
      description: 'Issue a code that grants a paid plan without payment.',
      codes: await listRegistrationCodes(),
      ...registrationCodeFormOptions(),
      issued: { code, record },
      errorMessage: null,
      saved: null
    });
  } catch (error) {
    if (error.expose || error.status === 404) {
      return res.redirect(303, `/admin/registration-codes?error=${encodeURIComponent(error.message)}`);
    }
    return next(error);
  }
});

// Platform-level delivery settings for wallet recovery codes.
router.get('/admin/notifications', authorize('admin.notifications.manage'), async (req, res, next) => {
  try {
    res.render('pages/notification-settings', {
      title: 'Notification delivery',
      description: 'Configure how Aegis ID sends codes, links and notices.',
      // Deliberately not called `settings`: Express puts its own app settings
      // in app.locals.settings, and hbs reads settings.views to find the
      // layout. A local of that name shadows it and every render 500s.
      notificationSettings: await getNotificationSettingsForDisplay(),
      deliveryLog: await listDeliveryLog(25),
      saved: req.query.saved === '1',
      testResult: req.query.test || null
    });
  } catch (error) {
    next(error);
  }
});

router.post('/admin/notifications', authorize('admin.notifications.manage'), async (req, res, next) => {
  try {
    const settings = await updateNotificationSettings(req.body, req.user?.email);
    await writeAuditEvent('admin.notifications.updated', {
      actorEmail: req.user?.email,
      emailEnabled: settings.email.enabled,
      emailPreset: settings.email.preset,
      smsEnabled: settings.sms.enabled,
      smsPreset: settings.sms.preset
    });

    // "Save and test" verifies the SMTP credentials without sending anything.
    if (req.body.action === 'test') {
      try {
        await verifyEmail(settings);
        return res.redirect(303, '/admin/notifications?saved=1&test=ok');
      } catch (error) {
        return res.redirect(303, `/admin/notifications?saved=1&test=${encodeURIComponent(error.message.slice(0, 160))}`);
      }
    }

    res.redirect(303, '/admin/notifications?saved=1');
  } catch (error) {
    next(error);
  }
});

// Demo and test applications. Authenticated only — requireAuthenticated gives a
// redirect to sign-in, and the policy keeps it in the authorization registry.
router.get('/testing', requireAuthenticated, authorize('testing.view'), (req, res) => {
  res.render('pages/testing', {
    title: 'Testing',
    description: 'Demo and test applications for Vanguard Aegis ID.',
    testingApps: getTestingApps()
  });
});

router.get('/health', authorize('admin.health.view'), async (req, res, next) => {
  try {
    const health = await getHealthDashboard();
    res.render('pages/health', {
      title: 'Health',
      description: 'Vanguard Aegis ID service health and recent operational logs.',
      health
    });
  } catch (error) {
    next(error);
  }
});

router.get('/lab/mock-wallet/:kind/:state', requireAuthenticated, authorize('api.verifiedId.present'), async (req, res, next) => {
  try {
    const publicBaseUrl = config.app.publicBaseUrl.replace(/\/$/, '');
    const requestUrl = `${publicBaseUrl}${req.originalUrl}`;
    const qrCodeDataUrl = await QRCode.toDataURL(requestUrl, { margin: 1, width: 460 });

    res.render('pages/mock-wallet', {
      title: 'Mock wallet handoff',
      description: 'Local mock wallet handoff for demo requests.',
      kind: req.params.kind,
      state: req.params.state,
      requestUrl,
      qrCodeDataUrl
    });
  } catch (error) {
    next(error);
  }
});

router.get('/wallet/credential-invitations/:credentialId', authorize('api.wallet.mobile'), async (req, res, next) => {
  try {
    const invite = await getCredentialInvitationView(req.query.organizationId, req.params.credentialId, {
      publicBaseUrl: getRequestBaseUrl(req)
    });
    res.render('pages/credential-invitation', {
      title: 'Credential invitation',
      description: 'Vanguard Aegis ID wallet credential invitation.',
      invite
    });
  } catch (error) {
    next(error);
  }
});

router.get('/demo/metadata/keycloak/realms/:realm/.well-known/openid-configuration', (req, res) => {
  const issuer = `${getRequestBaseUrl(req)}/demo/metadata/keycloak/realms/${req.params.realm}`;
  res.json(buildOidcDiscovery(issuer, 'keycloak'));
});

router.get('/demo/metadata/okta/oauth2/:authorizationServer/.well-known/openid-configuration', (req, res) => {
  const issuer = `${getRequestBaseUrl(req)}/demo/metadata/okta/oauth2/${req.params.authorizationServer}`;
  res.json(buildOidcDiscovery(issuer, 'okta'));
});

router.get('/demo/metadata/generic/oidc', (req, res) => {
  const issuer = `${getRequestBaseUrl(req)}/demo/metadata/generic`;
  res.json(buildOidcDiscovery(issuer, 'generic'));
});

router.get('/demo/metadata/generic/saml', (req, res) => {
  const baseUrl = getRequestBaseUrl(req);
  res.type('application/samlmetadata+xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${baseUrl}/demo/metadata/generic/saml">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${baseUrl}/demo/metadata/generic/saml/sso"/>
  </IDPSSODescriptor>
</EntityDescriptor>`);
});

function buildOidcDiscovery(issuer, provider) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    userinfo_endpoint: `${issuer}/userinfo`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'profile', 'email', 'groups'],
    claims_supported: ['sub', 'email', 'name', 'groups', 'department', 'roles'],
    vanguard_demo_provider: provider
  };
}

function getRequestBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`.replace(/\/$/, '');
}

module.exports = router;
