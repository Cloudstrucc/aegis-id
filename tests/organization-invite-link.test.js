const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// The invitation link a wallet receives.
//
// This exists because of a bug that was invisible on both sides. The link is
// built with URLSearchParams, which encodes a space as `+`. The wallet read it
// with URLQueryItem, which decodes percent escapes and leaves `+` alone —
// because a plus only means a space under form encoding. So "Northwind
// Logistics" was issued correctly, transmitted correctly, and displayed as
// "Northwind+Logistics" in the wallet for every organization with a space in
// its name.
//
// Nothing failed, which is why it survived: the link worked, the invitation was
// accepted, and only the name was wrong. These assert the shape of what the
// server emits, so the decoding rule the wallet has to follow stays written
// down on this side too.

const MODULES = ['../src/config', '../src/services/issuer-organization-service'];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-org-invite-'));
  const previous = { ...process.env };

  process.env.ISSUER_ORG_STORE_PATH = path.join(dir, 'issuer-organizations.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  process.env.PUBLIC_BASE_URL = 'http://localhost:3000';
  process.env.WALLET_URL_SCHEME = 'aegisid-local';

  resetModules();
  try {
    await run(require('../src/services/issuer-organization-service'));
  } finally {
    process.env = previous;
    resetModules();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const SUBSCRIPTION = { id: 'sub-1', organization: 'Northwind Logistics' };
const WORKSPACE = { id: 'ws-1', organization: 'Northwind Logistics' };

test('the invite link carries this environment’s wallet scheme', async () => {
  await withEnv(async (service) => {
    const record = await service.createIssuerOrganizationInvitation(SUBSCRIPTION, WORKSPACE);
    // A bare `aegisid` opens the production build, or on iOS nothing at all.
    assert.match(record.invitationUrl, /^aegisid-local:\/\/org-invite\?/);
  });
});

test('an organization name with a space survives the round trip', async () => {
  await withEnv(async (service) => {
    const record = await service.createIssuerOrganizationInvitation(SUBSCRIPTION, WORKSPACE);
    const url = new URL(record.invitationUrl);

    // URLSearchParams decodes `+` back to a space, because it applies form
    // encoding in both directions. A reader that does not — URLQueryItem on
    // iOS, for one — has to replace `+` itself.
    assert.equal(url.searchParams.get('organization_name'), 'Northwind Logistics');

    // The raw form is what the wallet actually parses, so assert the encoding
    // rather than only the decoded value.
    assert.match(record.invitationUrl, /organization_name=Northwind\+Logistics/);
  });
});

test('the link names the organization and where to reach it', async () => {
  await withEnv(async (service) => {
    const record = await service.createIssuerOrganizationInvitation(SUBSCRIPTION, WORKSPACE);
    const url = new URL(record.invitationUrl);

    assert.equal(url.searchParams.get('organization_id'), 'ws-1');
    assert.equal(url.searchParams.get('subscription_id'), 'sub-1');
    assert.equal(url.searchParams.get('vanguard_web_app_url'), 'http://localhost:3000');
    assert.ok(url.searchParams.get('invitation_id'));
  });
});
