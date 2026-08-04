const { createApp } = require('./app');
const config = require('./config');
const { logLocalTestModeBanner } = require('./middleware/local-test-mode');
const { logBillingModeBanner } = require('./services/billing-service');

const app = createApp();

app.listen(config.app.port, () => {
  console.log(`${config.app.name} listening on port ${config.app.port}`);
  // Neither of these had a caller before. A banner nobody prints is a banner
  // nobody reads.
  logLocalTestModeBanner();
  logBillingModeBanner();
});
