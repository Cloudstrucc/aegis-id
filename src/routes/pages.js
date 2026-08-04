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
