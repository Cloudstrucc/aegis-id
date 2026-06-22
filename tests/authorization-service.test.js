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
  assert.equal(isExternalPolicy('api.wallet.mobile'), true);
  assert.throws(() => requirePolicy('missing.policy'), /Unknown authorization policy/);

  for (const policy of policies) {
    assert.equal(policy.id, ids.find((id) => id === policy.id));
    assert.ok(policy.type, `${policy.id} is missing type`);
    assert.ok(policy.resource, `${policy.id} is missing resource`);
    assert.ok(policy.operation, `${policy.id} is missing operation`);
    assert.ok(Array.isArray(policy.fields), `${policy.id} fields must be an array`);

    if (policy.type === 'orgPrivilege') {
      assert.ok(policy.privilegeId, `${policy.id} must map to an org privilege`);
    }
  }
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
