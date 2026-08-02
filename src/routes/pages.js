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
const { writeAuditEvent } = require('../services/audit-service');

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

// Platform-level delivery settings for wallet recovery codes.
router.get('/admin/notifications', authorize('admin.notifications.manage'), async (req, res, next) => {
  try {
    res.render('pages/notification-settings', {
      title: 'Notification delivery',
      description: 'Configure how Aegis ID sends codes, links and notices.',
      settings: await getNotificationSettingsForDisplay(),
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
