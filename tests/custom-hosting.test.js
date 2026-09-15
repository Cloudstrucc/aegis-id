const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// Phase C: serving the platform from an organization's own hostname. The DNS
// and TLS provisioning is a deployment concern (provider "manual" here goes
// live the moment the CNAME resolves); what these cover is ours — a host is
// bound only to a verified domain, a request on that host resolves to the
// organization and its branding, and the routes that belong to the platform
// do not answer on a customer's domain.

const IDENTITY_VARS = [
  'ORGANIZATION_IDENTITY_STORE_PATH',
  'SUBSCRIBER_WORKSPACE_STORE_PATH',
  'ORG_ADMIN_STORE_PATH',
  'ORG_ADMIN_EVENT_STORE_PATH',
  'AUDIT_STORE_PATH'
];

function resolveModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/src/')) {
      delete require.cache[key];
    }
  }
}

async function withEnv(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-hosting-'));
  const previous = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: 'development',
    APP_ENV: 'no-such-env-file',
    PUBLIC_BASE_URL: 'https://platform.example',
    SESSION_SECRET: 'test-secret-test-secret-test-secret',
    CUSTOM_HOSTING_PROVIDER: 'manual',
    ORGANIZATION_IDENTITY_STORE_PATH: path.join(dir, 'identities.json'),
    SUBSCRIBER_WORKSPACE_STORE_PATH: path.join(dir, 'workspaces.json'),
    ORG_ADMIN_STORE_PATH: path.join(dir, 'org-admin.json'),
    ORG_ADMIN_EVENT_STORE_PATH: path.join(dir, 'org-admin-events.json'),
    AUDIT_STORE_PATH: path.join(dir, 'audit.json'),
    NOTIFICATION_SETTINGS_STORE_PATH: path.join(dir, 'notify.json'),
    NOTIFICATION_LOG_STORE_PATH: path.join(dir, 'notify-log.json'),
    MAIL_DROP_PATH: path.join(dir, 'mail')
  });
  resolveModules();
  try {
    await run({ dir });
  } finally {
    process.env = previous;
    resolveModules();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const WORKSPACE = {
  id: 'org-contoso',
  subscriptionId: 'sub-contoso',
  organization: 'Contoso',
  ownerEmail: 'admin@contoso.example',
  members: [{ email: 'admin@contoso.example', role: 'administrator', addedAt: new Date().toISOString() }],
  platforms: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

async function seedVerifiedOrg(identity) {
  await fs.writeFile(process.env.SUBSCRIBER_WORKSPACE_STORE_PATH, JSON.stringify([WORKSPACE]), 'utf8');
  await identity.ensureIdentity(WORKSPACE);
  const claimed = await identity.startDomainClaim(WORKSPACE.id, 'contoso.example');
  identity.setTxtResolverForTesting(async () => [[claimed.challenge.value]]);
  const verified = await identity.verifyDomain(WORKSPACE.id);
  assert.equal(verified.ok, true);
  return verified.identity;
}

test('a hostname can only be bound to the verified domain, and only that name or below it', async () => {
  await withEnv(async () => {
    const identity = require('../src/services/organization-identity-service');
    await seedVerifiedOrg(identity);

    await assert.rejects(identity.requestHosting(WORKSPACE.id, 'id.somewhere-else.com'), /must be contoso.example/);
    const view = await identity.requestHosting(WORKSPACE.id, 'id.contoso.example');
    assert.equal(view.hosting.status, 'pending-dns');
    assert.equal(view.hosting.cnameTarget, 'platform.example');
  });
});

test('hosting goes live when the CNAME points at the platform, and a request on that host resolves to the organization', async () => {
  await withEnv(async () => {
    const identity = require('../src/services/organization-identity-service');
    const site = require('../src/services/site-context-service');
    await seedVerifiedOrg(identity);
    await identity.requestHosting(WORKSPACE.id, 'id.contoso.example');

    // Wrong target: stays pending, and the host does not resolve.
    identity.setCnameResolverForTesting(async () => ['someone-else.azurewebsites.net']);
    const pending = await identity.checkHosting(WORKSPACE.id);
    assert.equal(pending.ok, false);
    assert.equal((await site.resolveSiteForRequest('id.contoso.example')).kind, 'platform');

    // Right target: active, and now the host is the organization's.
    identity.setCnameResolverForTesting(async () => ['platform.example']);
    const active = await identity.checkHosting(WORKSPACE.id);
    assert.equal(active.ok, true);
    assert.equal(active.identity.hosting.status, 'active');

    const resolved = await site.resolveSiteForRequest('id.contoso.example');
    assert.equal(resolved.kind, 'organization');
    assert.equal(resolved.workspaceId, WORKSPACE.id);
    assert.equal(resolved.baseUrl, 'https://id.contoso.example');
    assert.equal(resolved.branding.displayName, 'Contoso');
    assert.equal(await site.baseUrlForWorkspace(WORKSPACE.id), 'https://id.contoso.example');

    // An unknown host is the platform, never another org's branding.
    assert.equal((await site.resolveSiteForRequest('random.example')).kind, 'platform');
  });
});

test('withdrawing the domain takes the host down with it', async () => {
  await withEnv(async () => {
    const identity = require('../src/services/organization-identity-service');
    const site = require('../src/services/site-context-service');
    await seedVerifiedOrg(identity);
    await identity.requestHosting(WORKSPACE.id, 'id.contoso.example');
    identity.setCnameResolverForTesting(async () => ['platform.example']);
    await identity.checkHosting(WORKSPACE.id);
    assert.equal((await site.resolveSiteForRequest('id.contoso.example')).kind, 'organization');

    await identity.revokeVerification(WORKSPACE.id, { actorEmail: 'admin@contoso.example', reason: 'domain sold' });
    assert.equal((await site.resolveSiteForRequest('id.contoso.example')).kind, 'platform');
  });
});

test('platform-only routes redirect off an organization host, and its root is the public page', async () => {
  await withEnv(async () => {
    const identity = require('../src/services/organization-identity-service');
    await seedVerifiedOrg(identity);
    await identity.requestHosting(WORKSPACE.id, 'id.contoso.example');
    identity.setCnameResolverForTesting(async () => ['platform.example']);
    const active = await identity.checkHosting(WORKSPACE.id);
    const handle = active.identity.handle;

    const { createApp } = require('../src/app');
    const server = http.createServer(createApp());
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    const req = (p) => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: p, headers: { Host: 'id.contoso.example' } }, (res) => {
        resolve({ status: res.statusCode, location: res.headers.location });
        res.resume();
      }).on('error', reject);
    });

    try {
      const root = await req('/');
      assert.equal(root.status, 302);
      assert.equal(root.location, `/orgs/${handle}`);

      const subscribe = await req('/subscribe');
      assert.equal(subscribe.status, 302);
      assert.match(subscribe.location, /^https:\/\/platform\.example\/subscribe/);

      const admin = await req('/admin');
      assert.match(admin.location, /^https:\/\/platform\.example\/admin/);

      // Its own public page stays; another org's redirects to the platform.
      const own = await req(`/orgs/${handle}`);
      assert.equal(own.status, 200);
      const other = await req('/orgs/someone-else-1234');
      assert.match(other.location, /^https:\/\/platform\.example\/orgs\/someone-else-1234/);

      // Sign-in and the wallet API are served on the host.
      const login = await req('/auth/login');
      assert.equal(login.status, 200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test('with hosting disabled at the deployment, no host resolves to an organization', async () => {
  await withEnv(async () => {
    process.env.CUSTOM_HOSTING_PROVIDER = 'none';
    resolveModules();
    const identity = require('../src/services/organization-identity-service');
    const site = require('../src/services/site-context-service');
    assert.equal(identity.hostingEnabled(), false);
    await assert.rejects(identity.requestHosting('org-contoso', 'id.contoso.example'), /not enabled/);
    assert.equal((await site.resolveSiteForRequest('id.contoso.example')).kind, 'platform');
  });
});
