const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const hbs = require('hbs');
const morgan = require('morgan');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: resolveEnvFile(rootDir) });
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
  verifiedIdEnabled: process.env.VERIFIED_ID_AUTH_ENABLED !== 'false',
  yubiKeyEnabled: process.env.YUBIKEY_AUTH_ENABLED !== 'false',
  walletPasskeyApprovalsRequired: process.env.AEGIS_WALLET_PASSKEY_APPROVALS_REQUIRED === 'true',
  appName: 'Business Expenses',
  appInstanceId: 'business-expenses-demo'
};

const app = express();

registerHandlebars();

app.set('views', path.join(rootDir, 'views'));
app.set('view engine', 'hbs');
app.set('view options', { layout: 'layouts/main' });
app.set('trust proxy', 1);

function resolveEnvFile(baseDir) {
  const envName =
    process.env.APP_ENV ||
    process.env.DEPLOY_ENV ||
    (process.env.NODE_ENV === 'production' ? 'prod' : 'local');

  const fileNameByEnv = {
    prod: '.env',
    production: '.env',
    local: '.env.local',
    localhost: '.env.local',
    dev: '.env.dev',
    development: '.env.dev',
    qa: '.env.qa',
    test: '.env.qa'
  };

  return path.join(baseDir, fileNameByEnv[envName] || envName || '.env.local');
}

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
    configured: Boolean(config.organizationId || config.issuerConnectionId),
    verifiedIdEnabled: config.verifiedIdEnabled,
    yubiKeyEnabled: config.yubiKeyEnabled
  });
});

app.post('/auth/start', (req, res) => {
  const state = crypto.randomBytes(18).toString('base64url');
  const nonce = crypto.randomBytes(18).toString('base64url');
  const intent = req.body.intent === 'register' ? 'register' : 'sign-in';
  const authMethod = normalizeAuthMethod(req.body.authMethod);
  req.session.oidc = { state, nonce, intent, authMethod };

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
    await upsertUser(req.session.user);

    if (req.session.oidc.authMethod === 'verified-id' && config.verifiedIdEnabled) {
      const presentation = await createVerifiedIdPresentationRequest(req.session.user, action);
      req.session.pendingVerifiedIdTransactionId = presentation.id;
      req.session.verifiedIdRequest = presentation;
      return res.redirect(303, `/verified-id/${presentation.id}?returnTo=/expenses`);
    }

    if (req.session.oidc.authMethod === 'yubikey' && config.yubiKeyEnabled) {
      const stepUp = await createYubiKeyStepUpRequest(req.session.user, action);
      req.session.pendingYubiKeyStepUpId = stepUp.id;
      req.session.yubiKeyStepUp = stepUp;
      return res.redirect(303, `/yubikey/${stepUp.id}?returnTo=/expenses`);
    }

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

app.get('/verified-id/:transactionId', requireKnownVerifiedIdRequest, async (req, res, next) => {
  try {
    const transaction = await loadAndSettleVerifiedId(req);
    res.render('pages/verified-id', {
      title: 'Verified ID Required',
      request: req.session.verifiedIdRequest,
      transaction,
      returnTo: req.query.returnTo || '/expenses'
    });
  } catch (error) {
    next(error);
  }
});

app.get('/verified-id/:transactionId/status', requireKnownVerifiedIdRequest, async (req, res, next) => {
  try {
    const transaction = await loadAndSettleVerifiedId(req);
    res.json({
      id: transaction.id,
      status: transaction.status,
      callbackStatus: transaction.callbackStatus || null,
      returnTo: req.query.returnTo || '/expenses'
    });
  } catch (error) {
    next(error);
  }
});

app.get('/yubikey/:stepUpId', requireKnownYubiKeyStepUp, (req, res) => {
  res.render('pages/yubikey', {
    title: 'YubiKey Step-Up Required',
    request: req.session.yubiKeyStepUp,
    returnTo: req.query.returnTo || '/expenses'
  });
});

app.post('/yubikey/:stepUpId/complete', requireKnownYubiKeyStepUp, async (req, res, next) => {
  try {
    const stepUp = req.session.yubiKeyStepUp;
    const evidence = summarizeYubiKeyEvidence(req.body || {});
    const acceptedAt = new Date().toISOString();
    await appendAssuranceEvent({
      id: crypto.randomUUID(),
      stepUpId: stepUp.id,
      type: 'yubikey-fido2-step-up',
      status: evidence.simulated ? 'pilot-simulated' : 'accepted',
      subject: stepUp.user.email,
      action: stepUp.action,
      application: config.appName,
      relyingPartyId: stepUp.publicKey.rp.id || new URL(config.appPublicBaseUrl).hostname,
      credentialId: evidence.credentialId,
      authenticatorAttachment: evidence.authenticatorAttachment,
      userVerification: 'required',
      simulated: evidence.simulated,
      createdAt: stepUp.createdAt,
      acceptedAt,
      payload: {
        appName: config.appName,
        assurance: evidence.simulated ? 'pilot-yubikey-simulated' : 'fido2-webauthn',
        user: stepUp.user.email,
        action: stepUp.action,
        timestamp: acceptedAt
      }
    });

    req.session.authenticated = true;
    req.session.yubiKeyAuthenticated = true;
    delete req.session.pendingYubiKeyStepUpId;
    delete req.session.yubiKeyStepUp;

    res.json({ ok: true, returnTo: req.query.returnTo || '/expenses' });
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
      createdExpenseId: req.query.created || null,
      yubiKeyAuthenticated: Boolean(req.session.yubiKeyAuthenticated),
      verifiedIdAuthenticated: Boolean(req.session.verifiedIdAuthenticated)
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
      requiredAssurance: config.walletPasskeyApprovalsRequired ? 'passkey' : undefined,
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
      challenges: remoteLedger.challenges || [],
      assuranceEvents: await readAssuranceEvents()
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
  hbs.registerHelper('json', (value) => {
    const json = JSON.stringify(value, null, 2)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

    return new hbs.SafeString(json);
  });
}

function normalizeAuthMethod(value) {
  if (value === 'wallet' || value === 'yubikey') {
    return value;
  }
  return 'verified-id';
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

async function createVerifiedIdPresentationRequest(user, action) {
  return fetchAegisJson('/api/verifier/create-request', {
    method: 'POST',
    body: {
      appName: config.appName,
      subject: user.email,
      purpose: `Authenticate ${user.email} to Business Expenses before viewing or approving expense records.`,
      action
    }
  });
}

async function createYubiKeyStepUpRequest(user, action) {
  const host = new URL(config.appPublicBaseUrl).hostname;
  const stepUp = {
    id: crypto.randomUUID(),
    action,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    user: {
      id: crypto.randomBytes(16).toString('base64url'),
      email: user.email,
      name: user.name || user.email
    },
    publicKey: {
      challenge: crypto.randomBytes(32).toString('base64url'),
      rp: {
        name: 'Vanguard Aegis ID',
        id: host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host) ? undefined : host
      },
      user: {
        id: '',
        name: user.email,
        displayName: user.name || user.email
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 }
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'cross-platform',
        residentKey: 'preferred',
        userVerification: 'required'
      },
      attestation: 'direct',
      timeout: 90000
    }
  };
  stepUp.publicKey.user.id = stepUp.user.id;

  await appendAssuranceEvent({
    id: crypto.randomUUID(),
    stepUpId: stepUp.id,
    type: 'yubikey-fido2-step-up',
    status: 'created',
    subject: user.email,
    action,
    application: config.appName,
    relyingPartyId: stepUp.publicKey.rp.id || host,
    createdAt: stepUp.createdAt,
    payload: {
      appName: config.appName,
      assurance: 'fido2-webauthn',
      user: user.email,
      action,
      timestamp: stepUp.createdAt
    }
  });

  return stepUp;
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

async function loadAndSettleVerifiedId(req) {
  const transaction = await fetchAegisJson(`/api/transactions/${req.params.transactionId}`);
  if (transaction.status === 'verified' || transaction.callbackStatus === 'presentation_verified') {
    if (req.session.pendingVerifiedIdTransactionId === transaction.id) {
      req.session.authenticated = true;
      req.session.verifiedIdAuthenticated = true;
      delete req.session.pendingVerifiedIdTransactionId;
      delete req.session.verifiedIdRequest;
    }
  }
  return transaction;
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

async function readAssuranceEvents() {
  return readJson('assurance-events.json', []);
}

async function appendAssuranceEvent(event) {
  const events = await readAssuranceEvents();
  events.unshift(event);
  await writeJson('assurance-events.json', events.slice(0, 150));
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

function requireKnownVerifiedIdRequest(req, res, next) {
  if (
    req.session.pendingVerifiedIdTransactionId === req.params.transactionId ||
    req.session.authenticated
  ) {
    return next();
  }
  return res.redirect(303, '/');
}

function requireKnownYubiKeyStepUp(req, res, next) {
  if (
    req.session.pendingYubiKeyStepUpId === req.params.stepUpId ||
    req.session.authenticated
  ) {
    return next();
  }
  return res.redirect(303, '/');
}

function summarizeYubiKeyEvidence(body = {}) {
  return {
    credentialId: String(body.credentialId || body.id || 'pilot-fido2-credential').slice(0, 250),
    authenticatorAttachment: String(body.authenticatorAttachment || 'cross-platform').slice(0, 80),
    simulated: Boolean(body.simulated)
  };
}
