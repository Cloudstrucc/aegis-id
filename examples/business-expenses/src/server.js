const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const hbs = require('hbs');
const morgan = require('morgan');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data', 'runtime');
const seedDir = path.join(rootDir, 'data');
const config = {
  port: Number.parseInt(process.env.PORT || '4300', 10),
  sessionSecret: process.env.SESSION_SECRET || 'dev-business-expenses-secret',
  appPublicBaseUrl: process.env.APP_PUBLIC_BASE_URL || 'http://localhost:4300',
  aegisBaseUrl: (process.env.AEGIS_ID_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  authorizationEndpoint: process.env.AEGIS_OIDC_AUTHORIZATION_ENDPOINT || '/oidc/authorize',
  tokenEndpoint: process.env.AEGIS_OIDC_TOKEN_ENDPOINT || '/oidc/token',
  clientId: process.env.OIDC_CLIENT_ID || 'business-expenses-demo',
  scope: process.env.OIDC_SCOPE || 'openid profile email',
  organizationId: process.env.AEGIS_ORGANIZATION_ID || '',
  issuerConnectionId: process.env.AEGIS_ISSUER_CONNECTION_ID || '',
  appName: 'Business Expenses',
  appInstanceId: 'business-expenses-demo'
};

const app = express();

registerHandlebars();

app.set('views', path.join(rootDir, 'views'));
app.set('view engine', 'hbs');
app.set('view options', { layout: 'layouts/main' });
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        baseUri: ["'self'"],
        formAction: ["'self'", config.aegisBaseUrl],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        fontSrc: ["'self'", 'https://cdn.jsdelivr.net']
      }
    }
  })
);
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(rootDir, 'public')));
app.use(
  session({
    name: 'expenses.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax'
    }
  })
);

app.use((req, res, next) => {
  res.locals.appName = config.appName;
  res.locals.user = req.session.user || null;
  res.locals.isAuthenticated = Boolean(req.session.authenticated);
  res.locals.aegisBaseUrl = config.aegisBaseUrl;
  next();
});

app.get('/', (req, res) => {
  res.render('pages/index', {
    title: 'Business Expenses',
    configured: Boolean(config.organizationId || config.issuerConnectionId)
  });
});

app.post('/auth/start', (req, res) => {
  const state = crypto.randomBytes(18).toString('base64url');
  const nonce = crypto.randomBytes(18).toString('base64url');
  const intent = req.body.intent === 'register' ? 'register' : 'sign-in';
  req.session.oidc = { state, nonce, intent };

  const authorizationUrl = new URL(config.authorizationEndpoint, config.aegisBaseUrl);
  authorizationUrl.searchParams.set('client_id', config.clientId);
  authorizationUrl.searchParams.set('redirect_uri', `${config.appPublicBaseUrl}/auth/callback`);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('scope', config.scope);
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('nonce', nonce);
  authorizationUrl.searchParams.set('organization_id', config.organizationId);
  authorizationUrl.searchParams.set('app_name', config.appName);
  res.redirect(303, authorizationUrl.toString());
});

app.get('/auth/callback', async (req, res, next) => {
  try {
    if (!req.session.oidc || req.query.state !== req.session.oidc.state) {
      const error = new Error('OIDC state did not match this browser session.');
      error.status = 400;
      throw error;
    }

    const token = await exchangeCode(req.query.code);
    const userExisted = await userExists(token.claims.email);
    req.session.user = {
      sub: token.claims.sub,
      email: token.claims.email,
      name: token.claims.name,
      organizationId: token.claims.organization_id
    };
    req.session.authenticated = false;

    const action = userExisted || req.session.oidc.intent === 'sign-in' ? 'sign-in' : 'register';
    const challenge = await createAegisChallenge({
      challengeType: 'authentication',
      action,
      resourceType: 'session',
      resourceId: req.session.id,
      subject: token.claims.email,
      payload: {
        appName: config.appName,
        action,
        timestamp: new Date().toISOString(),
        oidc: {
          issuer: token.claims.iss,
          subject: token.claims.sub,
          email: token.claims.email,
          acr: token.claims.acr
        }
      }
    });

    await upsertUser(req.session.user);
    req.session.pendingAuthChallengeId = challenge.id;
    res.redirect(303, `/challenge/${challenge.id}?returnTo=/expenses`);
  } catch (error) {
    next(error);
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect(303, '/'));
});

app.get('/challenge/:challengeId', requireKnownChallenge, async (req, res, next) => {
  try {
    const challenge = await loadAndSettleChallenge(req);
    res.render('pages/challenge', {
      title: 'Wallet Challenge',
      challenge,
      returnTo: req.query.returnTo || '/expenses'
    });
  } catch (error) {
    next(error);
  }
});

app.get('/challenge/:challengeId/status', requireKnownChallenge, async (req, res, next) => {
  try {
    const challenge = await loadAndSettleChallenge(req);
    res.json({
      id: challenge.id,
      status: challenge.status,
      returnTo: req.query.returnTo || '/expenses'
    });
  } catch (error) {
    next(error);
  }
});

app.get('/expenses', requireAuthenticated, async (req, res, next) => {
  try {
    await settlePendingDecisions(req);
    res.render('pages/expenses', {
      title: 'Expense Records',
      expenses: await readExpenses(),
      decisions: await readDecisions(),
      createdExpenseId: req.query.created || null
    });
  } catch (error) {
    next(error);
  }
});

app.post('/expenses/random', requireAuthenticated, async (req, res, next) => {
  try {
    const expenses = await readExpenses();
    const expense = createRandomExpense(expenses);
    expenses.unshift(expense);
    await writeJson('expenses.json', expenses);
    res.redirect(303, `/expenses?created=${encodeURIComponent(expense.id)}`);
  } catch (error) {
    next(error);
  }
});

app.post('/expenses/:expenseId/:action', requireAuthenticated, async (req, res, next) => {
  try {
    const action = req.params.action === 'reject' ? 'reject' : 'approve';
    const expenses = await readExpenses();
    const expense = expenses.find((item) => item.id === req.params.expenseId);
    if (!expense) {
      const error = new Error('Expense record not found.');
      error.status = 404;
      throw error;
    }

    const challenge = await createAegisChallenge({
      challengeType: 'expense-decision',
      action,
      resourceType: 'expense',
      resourceId: expense.id,
      subject: req.session.user.email,
      payload: {
        appName: config.appName,
        action,
        timestamp: new Date().toISOString(),
        actor: req.session.user.email,
        expense: {
          id: expense.id,
          requester: expense.requester,
          department: expense.department,
          vendor: expense.vendor,
          category: expense.category,
          amount: `${expense.currency} ${expense.amount.toFixed(2)}`
        }
      }
    });
    await appendDecision({
      id: crypto.randomUUID(),
      expenseId: expense.id,
      challengeId: challenge.id,
      action,
      actor: req.session.user.email,
      status: 'pending-wallet',
      createdAt: new Date().toISOString()
    });

    res.redirect(303, `/challenge/${challenge.id}?returnTo=/expenses`);
  } catch (error) {
    next(error);
  }
});

app.get('/ledger', requireAuthenticated, async (req, res, next) => {
  try {
    await settlePendingDecisions(req);
    const remoteLedger = await fetchAegisJson(
      `/api/wallet-challenges/ledger?appInstanceId=${encodeURIComponent(config.appInstanceId)}&limit=100`
    );
    res.render('pages/ledger', {
      title: 'Wallet Ledger',
      decisions: await readDecisions(),
      challenges: remoteLedger.challenges || []
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }
  res.status(error.status || 500).render('pages/error', {
    title: 'Business Expenses Error',
    message: error.message,
    details: error.details
  });
});

app.listen(config.port, () => {
  console.log(`${config.appName} listening on http://localhost:${config.port}`);
});

function registerHandlebars() {
  hbs.registerHelper('eq', (left, right) => left === right);
  hbs.registerHelper('money', (amount, currency) => `${currency || 'CAD'} ${Number(amount || 0).toFixed(2)}`);
  hbs.registerHelper('json', (value) => JSON.stringify(value, null, 2));
}

async function exchangeCode(code) {
  const response = await fetch(new URL(config.tokenEndpoint, config.aegisBaseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(code || ''),
      client_id: config.clientId,
      redirect_uri: `${config.appPublicBaseUrl}/auth/callback`
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || payload.message || 'OIDC token exchange failed.');
  }
  return payload;
}

async function createAegisChallenge(input) {
  const challenge = await fetchAegisJson('/api/wallet-challenges', {
    method: 'POST',
    body: {
      ...input,
      appName: config.appName,
      appInstanceId: config.appInstanceId,
      organizationId: config.organizationId,
      connectionId: config.issuerConnectionId,
      returnUrl: `${config.appPublicBaseUrl}/challenge/pending`,
      ttlSeconds: 900
    }
  });
  return challenge;
}

async function fetchAegisJson(pathname, options = {}) {
  const response = await fetch(new URL(pathname, config.aegisBaseUrl), {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error?.message || payload.message || 'Aegis ID API request failed.');
    error.status = response.status;
    error.details = payload.error?.details || payload.details;
    throw error;
  }
  return payload;
}

async function loadAndSettleChallenge(req) {
  const challenge = await fetchAegisJson(`/api/wallet-challenges/${req.params.challengeId}`);
  if (challenge.status === 'accepted') {
    if (req.session.pendingAuthChallengeId === challenge.id) {
      req.session.authenticated = true;
      delete req.session.pendingAuthChallengeId;
    }
    await settleDecision(challenge);
  }
  return challenge;
}

async function settlePendingDecisions(req) {
  const decisions = await readDecisions();
  const pending = decisions.filter((decision) => decision.status === 'pending-wallet');
  for (const decision of pending) {
    const challenge = await fetchAegisJson(`/api/wallet-challenges/${decision.challengeId}`);
    if (challenge.status === 'accepted') {
      await settleDecision(challenge);
    }
  }
}

async function settleDecision(challenge) {
  if (challenge.resourceType !== 'expense' || !['approve', 'reject'].includes(challenge.action)) {
    return;
  }

  const expenses = await readExpenses();
  const expenseIndex = expenses.findIndex((expense) => expense.id === challenge.resourceId);
  if (expenseIndex !== -1 && expenses[expenseIndex].status === 'pending') {
    expenses[expenseIndex] = {
      ...expenses[expenseIndex],
      status: challenge.action === 'approve' ? 'approved' : 'rejected',
      decidedBy: challenge.subject,
      decidedAt: challenge.acceptedAt
    };
    await writeJson('expenses.json', expenses);
  }

  const decisions = await readDecisions();
  const decisionIndex = decisions.findIndex((decision) => decision.challengeId === challenge.id);
  if (decisionIndex !== -1 && decisions[decisionIndex].status === 'pending-wallet') {
    decisions[decisionIndex] = {
      ...decisions[decisionIndex],
      status: 'wallet-accepted',
      acceptedAt: challenge.acceptedAt
    };
    await writeJson('decisions.json', decisions);
  }
}

async function upsertUser(user) {
  const users = await readJson('users.json', []);
  const index = users.findIndex((candidate) => candidate.email === user.email);
  const nextUser = {
    ...user,
    updatedAt: new Date().toISOString()
  };
  if (index === -1) {
    users.push({ ...nextUser, createdAt: new Date().toISOString() });
  } else {
    users[index] = { ...users[index], ...nextUser };
  }
  await writeJson('users.json', users);
}

async function userExists(email) {
  const users = await readJson('users.json', []);
  return users.some((user) => user.email === email);
}

async function appendDecision(decision) {
  const decisions = await readDecisions();
  decisions.unshift(decision);
  await writeJson('decisions.json', decisions);
}

async function readExpenses() {
  const runtimeExpenses = await readJson('expenses.json', null);
  if (runtimeExpenses) {
    return runtimeExpenses;
  }
  const seedExpenses = JSON.parse(await fs.readFile(path.join(seedDir, 'expenses.seed.json'), 'utf8'));
  await writeJson('expenses.json', seedExpenses);
  return seedExpenses;
}

async function readDecisions() {
  return readJson('decisions.json', []);
}

function createRandomExpense(existingExpenses = []) {
  const requesters = [
    'Avery Brooks',
    'Priya Nair',
    'Daniel Fraser',
    'Sofia Martins',
    'Owen Hughes',
    'Amara Okafor',
    'Theo Wallace',
    'Elena Rossi'
  ];
  const departments = ['Finance', 'Security', 'Delivery', 'HR', 'Legal', 'Cloud Ops', 'Sales', 'Engineering'];
  const vendors = [
    'Azure Marketplace',
    'Vanguard Travel Desk',
    'Northwind SaaS',
    'YubiEnterprise',
    'Contoso Office',
    'Fabrikam Events',
    'Tailspin Labs',
    'A. Datum Training'
  ];
  const categories = [
    'Cloud Services',
    'Client Travel',
    'Software Subscription',
    'Hardware Keys',
    'Training',
    'Office Supplies',
    'Professional Services'
  ];

  const requester = randomItem(requesters);
  const submittedAt = new Date(Date.now() - randomInteger(1, 96) * 60 * 60 * 1000);
  return {
    id: nextExpenseId(existingExpenses),
    requester,
    department: randomItem(departments),
    vendor: randomItem(vendors),
    category: randomItem(categories),
    amount: Number((randomInteger(95, 4200) + Math.random()).toFixed(2)),
    currency: 'CAD',
    submittedAt: submittedAt.toISOString(),
    status: 'pending'
  };
}

function nextExpenseId(expenses = []) {
  const max = expenses.reduce((highest, expense) => {
    const match = /^EXP-2026-(\d+)$/.exec(expense.id || '');
    return match ? Math.max(highest, Number.parseInt(match[1], 10)) : highest;
  }, 1000);
  return `EXP-2026-${String(max + 1).padStart(4, '0')}`;
}

function randomItem(items) {
  return items[randomInteger(0, items.length - 1)];
}

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function readJson(fileName, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, fileName), 'utf8'));
  } catch (error) {
    return fallback;
  }
}

async function writeJson(fileName, value) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, fileName), JSON.stringify(value, null, 2), 'utf8');
}

function requireAuthenticated(req, res, next) {
  if (req.session.authenticated && req.session.user) {
    return next();
  }
  return res.redirect(303, '/');
}

function requireKnownChallenge(req, res, next) {
  if (
    req.session.pendingAuthChallengeId === req.params.challengeId ||
    req.session.authenticated
  ) {
    return next();
  }
  return res.redirect(303, '/');
}
