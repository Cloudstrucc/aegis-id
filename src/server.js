const { createApp } = require('./app');
const config = require('./config');
const { logLocalTestModeBanner } = require('./middleware/local-test-mode');
const { logBillingModeBanner } = require('./services/billing-service');
const { backfillOrganizationIdentities } = require('./services/platform-service');
const { backfillAdminMemberships } = require('./services/org-admin-service');

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
});
