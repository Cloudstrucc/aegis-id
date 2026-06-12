const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const helmet = require('helmet');
const hbs = require('hbs');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const pageRoutes = require('./routes/pages');
const subscriptionRoutes = require('./routes/subscriptions');
const apiRoutes = require('./routes/api');

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
          styleSrc: ["'self'"]
        }
      }
    })
  );
  app.use(morgan(config.app.env === 'production' ? 'combined' : 'dev'));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(config.paths.public, { maxAge: config.app.env === 'production' ? '1d' : 0 }));

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

  app.use('/', pageRoutes);
  app.use('/', subscriptionRoutes);
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
