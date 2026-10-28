const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  getPolicy,
  isExternalPolicy,
  listPolicies,
  requirePolicy
} = require('../src/services/authorization-service');
const { authorize } = require('../src/middleware/authorization');

const ROUTES_DIR = path.join(__dirname, '..', 'src', 'routes');

test('authorization registry exposes explicit, valid policies', () => {
  const policies = listPolicies();
  const ids = policies.map((policy) => policy.id);

  assert.ok(policies.length > 0);
  assert.equal(new Set(ids).size, ids.length, 'Policy IDs must be unique.');
  assert.ok(getPolicy('org.credentials.issue'));
  assert.equal(getPolicy('admin.health.view').type, 'adminAnyWorkspace');
  assert.equal(getPolicy('public.health'), null);
  assert.equal(isExternalPolicy('api.wallet.mobile'), true);
  assert.throws(() => requirePolicy('missing.policy'), /Unknown authorization policy/);

  for (const policy of policies) {
    assert.equal(policy.id, ids.find((id) => id === policy.id));
    assert.ok(policy.type, `${policy.id} is missing type`);
    assert.ok(policy.resource, `${policy.id} is missing resource`);
    assert.ok(policy.operation, `${policy.id} is missing operation`);
    assert.ok(Array.isArray(policy.fields), `${policy.id} fields must be an array`);

    if (policy.type === 'orgPrivilege' || policy.type === 'tenantPrivilege') {
      assert.ok(policy.privilegeId, `${policy.id} must map to an org privilege`);
    }
  }
});

// The scope split is the security property of the tenancy work, so it is
// asserted rather than described. Organization-scoped settings are reachable by
// an administrator of that organization; platform-wide settings are not, and
// drifting one of the second list to a tenant type would hand an invited
// administrator the power to decide how everybody on the deployment signs in.
test('organization settings and platform settings are different gates', () => {
  const tenantScoped = [
    'tenant.settings.view',
    'tenant.adapters.manage',
    'tenant.wallets.manage',
    'tenant.domain.manage',
    'tenant.people.view'
  ];
  const platformOnly = [
    'admin.dashboard.view',
    'admin.signInMethods.manage',
    'admin.notifications.manage',
    'admin.registrationCodes.manage',
    'admin.accountRecovery.manage',
    'admin.breakGlass.redeem',
    'admin.wallets.manage',
    'admin.domains.manage',
    'admin.authAdapters.manage'
  ];

  for (const policyId of tenantScoped) {
    const policy = requirePolicy(policyId);
    assert.ok(
      policy.type === 'tenantAdmin' || policy.type === 'tenantPrivilege',
      `${policyId} must be organization-scoped, not ${policy.type}`
    );
  }

  for (const policyId of platformOnly) {
    assert.equal(
      requirePolicy(policyId).type,
      'adminAnyWorkspace',
      `${policyId} must stay behind the platform gate`
    );
  }
});

test('authorization middleware denies organization-scoped policies without a session', async () => {
  for (const policyId of ['tenant.settings.view', 'tenant.people.view']) {
    const error = await invokeMiddleware(authorize(policyId), {
      path: '/orgs/somebody-else-1234/settings',
      params: { handle: 'somebody-else-1234' },
      body: {},
      query: {},
      isAuthenticated: () => false,
      get: () => 'text/html'
    });

    assert.equal(error.status, 401, `${policyId} should require a session`);
  }
});

test('an organization handle alone does not resolve a tenant', async () => {
  // The resolver re-checks membership itself, so a signed-in stranger putting a
  // handle in the URL gets a 404 — not a 403, which would confirm it exists.
  const error = await invokeMiddleware(authorize('tenant.settings.view'), {
    path: '/orgs/not-a-real-handle/settings',
    params: { handle: 'not-a-real-handle' },
    body: {},
    query: {},
    user: { id: 'stranger', email: 'stranger@example.com' },
    isAuthenticated: () => true,
    get: () => 'text/html'
  });

  assert.equal(error.status, 404);
});

test('authorization middleware denies authenticated policies without a session', async () => {
  const middleware = authorize('account.view');
  const error = await invokeMiddleware(middleware, {
    path: '/account',
    isAuthenticated: () => false,
    get: () => 'text/html'
  });

  assert.equal(error.status, 401);
  assert.equal(error.redirectTo, '/auth/login');
});

test('authorization middleware allows explicitly external policies without a session', async () => {
  const middleware = authorize('api.wallet.mobile');
  const error = await invokeMiddleware(middleware, {
    path: '/api/wallet/passkeys/register/options',
    isAuthenticated: () => false,
    get: () => 'application/json'
  });

  assert.equal(error, null);
});

test('mutating Express routes declare an authorization policy', async () => {
  const routeFiles = (await fs.readdir(ROUTES_DIR))
    .filter((file) => file.endsWith('.js'))
    .sort();
  const missing = [];

  for (const file of routeFiles) {
    const absolutePath = path.join(ROUTES_DIR, file);
    const source = await fs.readFile(absolutePath, 'utf8');
    const routeExpression = /router\.(post|put|patch|delete)\s*\(/g;
    let match;

    while ((match = routeExpression.exec(source)) !== null) {
      const statement = readCallStatement(source, match.index);
      if (!statement.includes('authorize(')) {
        missing.push(`${file}:${lineNumber(source, match.index)} ${statement.slice(0, 120).replace(/\s+/g, ' ')}`);
      }
    }
  }

  assert.deepEqual(missing, [], `Mutating routes missing authorize(...):\n${missing.join('\n')}`);
});

test('all route policy references exist in the registry', async () => {
  const routeFiles = (await fs.readdir(ROUTES_DIR))
    .filter((file) => file.endsWith('.js'))
    .sort();
  const missingPolicies = [];

  for (const file of routeFiles) {
    const source = await fs.readFile(path.join(ROUTES_DIR, file), 'utf8');
    const policyReference = /authorize\(\s*['"]([^'"]+)['"]/g;
    let match;

    while ((match = policyReference.exec(source)) !== null) {
      if (!getPolicy(match[1])) {
        missingPolicies.push(`${file}:${lineNumber(source, match.index)} ${match[1]}`);
      }
    }
  }

  assert.deepEqual(missingPolicies, [], `Routes reference unknown policies:\n${missingPolicies.join('\n')}`);
});

function invokeMiddleware(middleware, req) {
  return new Promise((resolve) => {
    middleware(req, { locals: {} }, (error) => {
      resolve(error || null);
    });
  });
}

function readCallStatement(source, startIndex) {
  let depth = 0;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      depth += 1;
    }
    if (char === ')') {
      depth -= 1;
    }
    if (depth === 0 && source[index + 1] === ';') {
      return source.slice(startIndex, index + 2);
    }
  }
  return source.slice(startIndex);
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}
