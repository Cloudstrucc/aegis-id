const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const helmet = require('helmet');
const hbs = require('hbs');
const morgan = require('morgan');
const passport = require('passport');
const rateLimit = require('express-rate-limit');
const session = require('express-session');

const config = require('./config');
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');
const pageRoutes = require('./routes/pages');
const subscriptionRoutes = require('./routes/subscriptions');
const organizationRoutes = require('./routes/organizations');
const dashboardRoutes = require('./routes/dashboard');
const orgAdminRoutes = require('./routes/org-admin');
const oidcProviderRoutes = require('./routes/oidc-provider');
const apiRoutes = require('./routes/api');
const oidcWalletDemoRoutes = require('./routes/oidc-wallet-demo');
const issuerOrganizationRoutes = require('./routes/issuer-organizations');
const { attachAuthLocals } = require('./middleware/auth');
const { configurePassport } = require('./services/passport-service');

function registerHandlebars() {
  const partialsDir = path.join(config.paths.views, 'partials');
  for (const fileName of fs.readdirSync(partialsDir)) {
    if (path.extname(fileName) === '.hbs') {
      hbs.registerPartial(path.basename(fileName, '.hbs'), fs.readFileSync(path.join(partialsDir, fileName), 'utf8'));
    }
  }
  hbs.registerHelper('eq', (left, right) => left === right);
  hbs.registerHelper('json', (value) => JSON.stringify(value, null, 2));
  hbs.registerHelper('year', () => new Date().getFullYear());
}

function createApp() {
  registerHandlebars();
  configurePassport(passport);

  const app = express();

  app.set('trust proxy', 1);
  app.set('views', config.paths.views);
  app.set('view engine', 'hbs');
  app.set('view options', { layout: 'layouts/main' });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"]
        }
      }
    })
  );
  app.use(morgan(config.app.env === 'production' ? 'combined' : 'dev'));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(config.paths.public, { maxAge: config.app.env === 'production' ? '1d' : 0 }));
  app.use(
    session({
      name: 'aegis.sid',
      secret: config.auth.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.app.env === 'production'
      }
    })
  );
  app.use(passport.initialize());
  app.use(passport.session());

  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 60,
      standardHeaders: true,
      legacyHeaders: false
    })
  );

  app.use((req, res, next) => {
    res.locals.appName = config.app.name;
    res.locals.currentPath = req.path;
    res.locals.verifiedIdMode = config.verifiedId.mode;
    next();
  });
  app.use(attachAuthLocals);

  app.use('/', authRoutes);
  app.use('/', accountRoutes);
  app.use('/', pageRoutes);
  app.use('/', subscriptionRoutes);
  app.use('/', organizationRoutes);
  app.use('/', dashboardRoutes);
  app.use('/', orgAdminRoutes);
  app.use('/', oidcProviderRoutes);
  app.use('/', issuerOrganizationRoutes);
  app.use('/', oidcWalletDemoRoutes);
  app.use('/api', apiRoutes);

  app.use((req, res) => {
    res.status(404).render('pages/not-found', {
      title: 'Not found',
      description: 'The requested page does not exist.'
    });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    const status = error.status || 500;
    const payload = {
      message: status >= 500 ? 'Something went wrong.' : error.message,
      details: config.app.env === 'production' ? undefined : error.details || error.stack
    };

    if (req.path.startsWith('/api')) {
      return res.status(status).json({ error: payload });
    }

    return res.status(status).render('pages/error', {
      title: 'Service issue',
      description: payload.message,
      error: payload
    });
  });

  return app;
}

module.exports = { createApp };
