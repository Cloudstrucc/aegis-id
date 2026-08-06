const express = require('express');

const { requireAuthenticated } = require('../middleware/auth');
const { authorize } = require('../middleware/authorization');
const { summarizeUsage } = require('../services/subscription-usage-service');
const { listIdentities } = require('../services/organization-identity-service');
const { getSubscriptionForUser } = require('../services/subscription-service');
const {
  deleteWorkspaceForSubscription,
  disableWorkspaceForSubscription,
  listWorkspacesForSubscription,
  registerWorkspaceForSubscription
} = require('../services/platform-service');
const {
  ensureAdminCredential,
  getOrganizationBranding,
  listCredentialMembershipsForEmail
} = require('../services/org-admin-service');
const { createIssuerOrganizationInvitation } = require('../services/issuer-organization-service');
const { getWorkspaceWalletOnboardingState } = require('../services/workspace-onboarding-service');
const { writeAuditEvent } = require('../services/audit-service');

const router = express.Router();
router.use('/organizations', requireAuthenticated);

router.get('/organizations/:subscriptionId', authorize('workspace.view'), async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const membershipWorkspaceIds = await getCredentialMembershipWorkspaceIds(req);
    const organizations = await decorateOrganizations(
      await listWorkspacesForSubscription(subscription, { membershipWorkspaceIds }),
      subscription
    );

    // What the plan allows decides whether another organization can be added at
    // all, so the form is offered or withheld on the same basis the server
    // enforces rather than being permanently open.
    const usage = await summarizeUsage(subscription);
    // The identity beside each organization, so an unproven domain is visible
    // from the list rather than only from inside the organization.
    const identities = await listIdentities();
    const identityByWorkspace = new Map(identities.map((entry) => [entry.workspaceId, entry]));
    for (const organization of organizations) {
      organization.identity = identityByWorkspace.get(organization.id) || null;
    }

    res.render('pages/organizations', {
      title: 'Organizations',
      description: 'Choose an organization workspace for Vanguard Cloud Services - Aegis ID.',
      subscription,
      organizations,
      hasOrganizations: organizations.length > 0,
      welcome: req.query.welcome === '1',
      // Opened by the "Add organization" button, or automatically when there is
      // nothing to choose from yet.
      showRegisterForm: organizations.length === 0 || req.query.add === '1',
      canAddWorkspace: usage.canAddWorkspace,
      workspacesUsed: usage.workspacesUsed,
      workspaceLimit: usage.workspaceLimit,
      planLabel: usage.plan.label,
      formValues: {
        // Deliberately blank. Prefilling the subscription's own organization
        // name made this look like it would edit the organization you already
        // have; it would not — registering the same name just re-opens it.
        organization: '',
        role: 'administrator'
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:subscriptionId', authorize('workspace.register'), async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const workspace = await registerWorkspaceForSubscription(subscription, req.body);
    const onboarding = await getWorkspaceWalletOnboardingState(subscription, workspace);

    if (onboarding.requiresWalletSetup && !onboarding.latestInvitation) {
      // Never fail workspace registration because the wallet invitation could not
      // be created (e.g. the Aries lab is unreachable). The workspace is the
      // primary outcome; the invitation can be re-issued from the onboarding page.
      try {
        await createIssuerOrganizationInvitation(subscription, workspace);
      } catch (invitationError) {
        await writeAuditEvent('organization.workspace.invitation.deferred', {
          subscriptionId: subscription.id,
          workspaceId: workspace.id,
          reason: invitationError.message
        });
      }
    }

    // Issue the founding administrator their own credential (plan Issue C).
    try {
      await ensureAdminCredential(workspace, subscription, { walletId: req.body.walletId });
    } catch (credentialError) {
      await writeAuditEvent('organization.admin.credential.deferred', {
        subscriptionId: subscription.id,
        workspaceId: workspace.id,
        reason: credentialError.message
      });
    }

    await writeAuditEvent('organization.workspace.registered', {
      subscriptionId: subscription.id,
      workspaceId: workspace.id,
      organization: workspace.organization,
      role: workspace.role
    });

    res.redirect(303, `${onboarding.requiresWalletSetup ? onboarding.onboardingPath : workspace.dashboardPath}?welcome=1`);
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:subscriptionId/:workspaceId/disable', authorize('workspace.manage'), async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const workspace = await disableWorkspaceForSubscription(subscription, req.params.workspaceId, true);
    await writeAuditEvent('organization.workspace.disabled', {
      subscriptionId: subscription.id,
      workspaceId: workspace.id,
      organization: workspace.organization,
      actorEmail: subscription.email
    });
    res.redirect(303, `/organizations/${subscription.id}`);
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:subscriptionId/:workspaceId/enable', authorize('workspace.manage'), async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const workspace = await disableWorkspaceForSubscription(subscription, req.params.workspaceId, false);
    await writeAuditEvent('organization.workspace.enabled', {
      subscriptionId: subscription.id,
      workspaceId: workspace.id,
      organization: workspace.organization,
      actorEmail: subscription.email
    });
    res.redirect(303, `/organizations/${subscription.id}`);
  } catch (error) {
    next(error);
  }
});

router.post('/organizations/:subscriptionId/:workspaceId/delete', authorize('workspace.manage'), async (req, res, next) => {
  try {
    const subscription = await loadSubscription(req);
    const workspace = await deleteWorkspaceForSubscription(subscription, req.params.workspaceId);
    await writeAuditEvent('organization.workspace.deleted', {
      subscriptionId: subscription.id,
      workspaceId: workspace.id,
      organization: workspace.organization,
      actorEmail: subscription.email
    });
    res.redirect(303, `/organizations/${subscription.id}`);
  } catch (error) {
    next(error);
  }
});

async function decorateOrganizations(organizations, subscription) {
  return Promise.all(organizations.map(async (organization) => {
    const branding = await getOrganizationBranding(organization.id);
    const onboarding = await getWorkspaceWalletOnboardingState(subscription, organization);
    return {
      ...organization,
      brandInitial: organization.organization?.trim()?.charAt(0)?.toUpperCase() || 'V',
      brandPrimaryColor: branding?.primaryColor || '#1769e0',
      brandAccentColor: branding?.accentColor || '#00b7c7',
      brandLogoDataUrl: branding?.logoDataUrl || '',
      openPath: onboarding.requiresWalletSetup ? onboarding.onboardingPath : organization.dashboardPath,
      requiresWalletSetup: onboarding.requiresWalletSetup
    };
  }));
}

async function getCredentialMembershipWorkspaceIds(req) {
  const memberships = await listCredentialMembershipsForEmail(req.user.email);
  return [...new Set(memberships.map((membership) => membership.workspaceId).filter(Boolean))];
}

async function loadSubscription(req) {
  const subscription = await getSubscriptionForUser(req.params.subscriptionId, req.user);
  if (!subscription) {
    const error = new Error('Subscriber session not found.');
    error.status = 404;
    throw error;
  }
  return subscription;
}

module.exports = router;
