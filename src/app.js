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
  hbs.registerHelper('json', (value) => new hbs.handlebars.SafeString(safeJson(value, 2)));
  hbs.registerHelper('jsonScript', (value) => new hbs.handlebars.SafeString(safeJson(value)));
  hbs.registerHelper('year', () => new Date().getFullYear());
}

function safeJson(value, spaces = 0) {
  return JSON.stringify(value, null, spaces)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function renderDocumentPage(filePath, options = {}) {
  return (req, res, next) => {
    try {
      const documentPage = buildDocumentPage(filePath, options);
      res.render('pages/document-page', {
        title: options.title,
        description: options.description,
        bodyClass: options.bodyClass || 'document-page',
        ...documentPage
      });
    } catch (error) {
      next(error);
    }
  };
}

function buildDocumentPage(filePath, options = {}) {
  const html = fs.readFileSync(filePath, 'utf8');
  let style = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((match) => match[1].trim())
    .join('\n\n');
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || '';
  let content = '';

  if (options.extract === 'main') {
    const topbar = options.removeTopbar
      ? ''
      : body.match(/<header\s+class="topbar"[\s\S]*?<\/header>/i)?.[0] || '';
    content = `${topbar}${body.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] || body}`;
  } else {
    content = body;
  }

  content = stripDocumentChrome(content, options);
  if (options.scopeDocument !== false) {
    ({ content, style } = scopeEmbeddedDocument(content, style));
  }

  return {
    documentStyle: style,
    documentHtml: content.trim(),
    documentScripts: options.scripts || []
  };
}

function stripDocumentChrome(content, options = {}) {
  let output = content
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, '');

  if (options.removeTopbar) {
    output = output.replace(/<header\s+class="topbar"[\s\S]*?<\/header>/i, '');
    output = output.replace(/<div\s+class="topbar"[\s\S]*?<\/div>\s*/i, '');
  }

  output = output.replace(/href="get-started-guide\.html#/g, 'href="/docs/tutorial/get-started-guide.html#');
  output = output.replace(/href="aegis-verified-id-value-story\.html#/g, 'href="/docs/aegis-verified-id-value-story.html#');
  output = output.replace(/target="_blank"\s+rel="noopener"\s*(?=href="#|href="\/docs)/g, '');
  output = output.replace(/\s+target="_blank"\s+rel="noopener"(?=>)/g, '');

  return output;
}

function scopeEmbeddedDocument(content, style) {
  const prefixedContent = prefixHtmlClasses(content);
  const prefixedStyle = prefixCssClasses(style);
  return {
    content: prefixedContent,
    style: scopeCssSelectors(prefixedStyle, '.embedded-document')
  };
}

function prefixHtmlClasses(html) {
  return html.replace(/\bclass=(["'])([\s\S]*?)\1/g, (match, quote, classValue) => {
    const classes = classValue
      .split(/\s+/)
      .filter(Boolean)
      .map(prefixDocumentClass)
      .join(' ');
    return `class=${quote}${classes}${quote}`;
  });
}

function prefixCssClasses(css) {
  return css.replace(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g, (match, className, offset, source) => {
    const previous = source[offset - 1];
    if (previous && /[a-zA-Z0-9_-]/.test(previous)) {
      return match;
    }
    return `.${prefixDocumentClass(className)}`;
  });
}

function prefixDocumentClass(className) {
  if (className.startsWith('doc-')) {
    return className;
  }
  return `doc-${className}`;
}

function scopeCssSelectors(css, scope) {
  let output = '';
  let cursor = 0;

  while (cursor < css.length) {
    const openIndex = css.indexOf('{', cursor);
    if (openIndex === -1) {
      output += css.slice(cursor);
      break;
    }

    const selector = css.slice(cursor, openIndex).trim();
    const closeIndex = findMatchingBrace(css, openIndex);
    if (closeIndex === -1) {
      output += css.slice(cursor);
      break;
    }

    const body = css.slice(openIndex + 1, closeIndex);
    if (isNestedAtRule(selector)) {
      output += `${selector} {\n${scopeCssSelectors(body, scope)}\n}\n`;
    } else if (isRawAtRule(selector)) {
      output += `${selector} {${body}}\n`;
    } else {
      output += `${scopeSelectorList(selector, scope)} {${body}}\n`;
    }
    cursor = closeIndex + 1;
  }

  return output;
}

function findMatchingBrace(css, openIndex) {
  let depth = 0;
  let quote = null;
  let inComment = false;

  for (let index = openIndex; index < css.length; index += 1) {
    const char = css[index];
    const next = css[index + 1];

    if (inComment) {
      if (char === '*' && next === '/') {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      inComment = true;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function isNestedAtRule(selector) {
  return /^@(media|supports|container|layer)\b/i.test(selector);
}

function isRawAtRule(selector) {
  return /^@(keyframes|font-face|page|property)\b/i.test(selector);
}

function scopeSelectorList(selectorList, scope) {
  return splitSelectorList(selectorList)
    .map((selector) => scopeSingleSelector(selector.trim(), scope))
    .join(',\n');
}

function splitSelectorList(selectorList) {
  const selectors = [];
  let current = '';
  let depth = 0;
  let quote = null;

  for (let index = 0; index < selectorList.length; index += 1) {
    const char = selectorList[index];
    if (quote) {
      current += char;
      if (char === '\\') {
        index += 1;
        current += selectorList[index] || '';
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === '[') {
      depth += 1;
      current += char;
      continue;
    }
    if (char === ')' || char === ']') {
      depth -= 1;
      current += char;
      continue;
    }
    if (char === ',' && depth === 0) {
      selectors.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  if (current.trim()) {
    selectors.push(current);
  }
  return selectors;
}

function scopeSingleSelector(selector, scope) {
  if (!selector || selector.startsWith('@') || selector.startsWith(scope)) {
    return selector;
  }
  if (/^(:root|html|body)(?=$|[\s.#:[>+~])/.test(selector)) {
    return selector.replace(/^(:root|html|body)/, scope);
  }
  return `${scope} ${selector}`;
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
          scriptSrc: ["'self'", "'unsafe-eval'", "'wasm-unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'"]
        }
      }
    })
  );
  app.use(morgan(config.app.env === 'production' ? 'combined' : 'dev'));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.get('/.well-known/apple-app-site-association', (req, res) => {
    const appIds = config.mobileApps.iosBundleIds.map(
      (bundleId) => `${config.mobileApps.iosTeamId}.${bundleId}`
    );
    res.type('application/json').send({
      webcredentials: {
        apps: appIds
      },
      applinks: {
        apps: [],
        details: [
          {
            appIDs: appIds,
            components: [
              {
                '/': '/wallet/*',
                comment: 'Vanguard Aegis ID mobile wallet handoff links.'
              }
            ]
          }
        ]
      }
    });
  });
  app.get('/.well-known/assetlinks.json', (req, res) => {
    res.type('application/json').send(
      config.mobileApps.androidSha256CertFingerprints.map((fingerprint) => ({
        relation: ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
        target: {
          namespace: 'android_app',
          package_name: config.mobileApps.androidPackageName,
          sha256_cert_fingerprints: [fingerprint]
        }
      }))
    );
  });
  app.use('/images', (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  });
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

  app.get(
    '/docs/tutorial/get-started-guide.html',
    renderDocumentPage(path.join(config.paths.root, 'docs', 'tutorial', 'get-started-guide.html'), {
      title: 'Get Started Guide',
      description: 'Vanguard Aegis ID onboarding and assurance setup guide.',
      extract: 'main',
      removeTopbar: false,
      scripts: [{ src: '/docs/tutorial/assets/get-started-guide.js' }]
    })
  );
  app.get(
    '/docs/aegis-verified-id-value-story.html',
    renderDocumentPage(path.join(config.paths.public, 'docs', 'aegis-verified-id-value-story.html'), {
      title: 'Product Brief',
      description: 'Vanguard Aegis ID product brief and value story.',
      removeTopbar: true
    })
  );
  app.use(express.static(config.paths.public, { maxAge: config.app.env === 'production' ? '1d' : 0 }));
  app.use(
    '/docs/tutorial',
    express.static(path.join(config.paths.root, 'docs', 'tutorial'), {
      maxAge: config.app.env === 'production' ? '1d' : 0
    })
  );
  app.use(
    '/vendor/mediapipe/face_detection',
    express.static(path.join(config.paths.root, 'node_modules', '@mediapipe', 'face_detection'), {
      maxAge: config.app.env === 'production' ? '7d' : 0
    })
  );
  app.use(
    '/vendor/d3',
    express.static(path.join(config.paths.root, 'node_modules', 'd3', 'dist'), {
      maxAge: config.app.env === 'production' ? '7d' : 0
    })
  );
  app.use(
    '/vendor/d3-flextree',
    express.static(path.join(config.paths.root, 'node_modules', 'd3-flextree', 'build'), {
      maxAge: config.app.env === 'production' ? '7d' : 0
    })
  );
  app.use(
    '/vendor/d3-org-chart',
    express.static(path.join(config.paths.root, 'node_modules', 'd3-org-chart', 'build'), {
      maxAge: config.app.env === 'production' ? '7d' : 0
    })
  );

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
    const shouldExpose = error.expose || status < 500;
    const payload = {
      message: shouldExpose ? error.message : 'Something went wrong.',
      details: shouldExpose
        ? error.details
        : config.app.env === 'production'
          ? undefined
          : error.details || error.stack
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
