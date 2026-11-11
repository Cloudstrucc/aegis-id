const { createApp } = require('./app');
const config = require('./config');
const { logLocalTestModeBanner } = require('./middleware/local-test-mode');
const { logBillingModeBanner } = require('./services/billing-service');
const { backfillOrganizationIdentities } = require('./services/platform-service');
const { backfillAdminMemberships } = require('./services/org-admin-service');
const {
  hasConfiguredOperators,
  inferDeploymentOperatorEmail
} = require('./services/admin-access-service');

const app = createApp();

app.listen(config.app.port, () => {
  console.log(`${config.app.name} listening on port ${config.app.port}`);
  // Neither of these had a caller before. A banner nobody prints is a banner
  // nobody reads.
  logLocalTestModeBanner();
  logBillingModeBanner();

  // Organizations created before identities existed have no handle, so they are
  // missing from the admin list and have no public page. Idempotent, and a
  // failure here must not stop the app serving.
  backfillOrganizationIdentities()
    .then(({ created }) => {
      if (created) {
        console.log(`Assigned handles to ${created} organization(s) that predated organization identity.`);
      }
    })
    .catch((error) => console.error('Organization identity backfill failed:', error.message));

  // People who were given an administrator role before role assignment wrote
  // workspace membership are administrators in one role system and employees in
  // the other. Grants only, idempotent, and never fatal.
  backfillAdminMemberships()
    .then(({ granted }) => {
      if (granted) {
        console.log(`Granted workspace administration to ${granted} holder(s) whose role already said so.`);
      }
    })
    .catch((error) => console.error('Administrator membership backfill failed:', error.message));

  // Who gets /admin. It decides who can read every wallet, domain and
  // delivered message on this installation, so an installation that has not
  // said is told what it is doing instead — once, at startup, where whoever
  // deployed it is looking.
  if (hasConfiguredOperators()) {
    console.log('Platform administration is restricted to PLATFORM_OPERATOR_EMAILS.');
  } else {
    inferDeploymentOperatorEmail()
      .then((email) => {
        console.warn(
          'PLATFORM_OPERATOR_EMAILS is not set. Platform administration is ' +
            (email
              ? `grandfathered to ${email}, the owner of the oldest subscription that administers an organization.`
              : 'unavailable: no subscription on this deployment administers an organization yet.') +
            ' Set the variable to name the operators explicitly.'
        );
      })
      .catch((error) => console.error('Could not determine the platform operator:', error.message));
  }
});
