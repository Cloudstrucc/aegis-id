const { createApp } = require('./app');
const config = require('./config');

const app = createApp();

app.listen(config.app.port, () => {
  console.log(`${config.app.name} listening on port ${config.app.port}`);
});
