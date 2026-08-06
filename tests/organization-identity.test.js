const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Organization identity: a handle everyone gets, and a domain some prove.
//
// The problem this solves is concrete. Organization names are free text and
// scoped per subscriber, so anyone can create an organization called
// "Cloudstrucc" — and a holder looking at a credential invitation has no way to
// tell it from the real one. A verified domain is the thing that cannot be
// typed, only proven.

const MODULES = [
  '../src/config',
  '../src/services/organization-identity-service',
  '../src/services/rate-limit-service',
  '../src/services/audit-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-org-identity-'));
  const previous = { ...process.env };
  process.env.PUBLIC_BASE_URL = 'https://vanguard-aegis-id-65067d.azurewebsites.net';
  process.env.ORGANIZATION_IDENTITY_STORE_PATH = path.join(dir, 'identities.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  resetModules();
  try {
    require('../src/services/rate-limit-service').resetAll();
    await run({ dir, identity: require('../src/services/organization-identity-service') });
  } finally {
    process.env = previous;
    resetModules();
  }
}

const WORKSPACE = { id: 'ws-1', subscriptionId: 'sub-1', organization: 'Cloudstrucc' };
const OTHER = { id: 'ws-2', subscriptionId: 'sub-2', organization: 'Cloudstrucc' };

/** A stub DNS resolver, because the suite cannot publish real records. */
function resolver(map) {
  return async (hostname) => {
    if (!(hostname in map)) {
      const error = new Error('not found');
      error.code = 'ENOTFOUND';
      throw error;
    }
    return map[hostname];
  };
}

test('every organization gets a unique handle, name collisions and all', async () => {
  await withEnv(async ({ identity }) => {
    const first = await identity.ensureIdentity(WORKSPACE);
    const second = await identity.ensureIdentity(OTHER);

    // Two subscribers, the same name — which the platform allows and always
    // will, because real companies do share names.
    assert.equal(first.organization, second.organization);
    assert.notEqual(first.handle, second.handle);
    assert.match(first.handle, /^cloudstrucc-[a-z0-9]{4}$/);
    assert.match(second.handle, /^cloudstrucc-[a-z0-9]{4}$/);
  });
});

test('the handle is stable once assigned', async () => {
  await withEnv(async ({ identity }) => {
    const first = await identity.ensureIdentity(WORKSPACE);
    const again = await identity.ensureIdentity(WORKSPACE);
    assert.equal(again.handle, first.handle, 'an identity is created once, not re-rolled');
  });
});

test('an unverified organization still has somewhere to be looked up', async () => {
  await withEnv(async ({ identity }) => {
    const record = await identity.ensureIdentity(WORKSPACE);

    assert.equal(record.isVerified, false);
    assert.equal(record.displayIdentity, record.handle);
    // Path-based, because App Service serves only its own hostname — a
    // subdomain of azurewebsites.net would never resolve.
    assert.equal(
      record.canonicalUrl,
      `https://vanguard-aegis-id-65067d.azurewebsites.net/orgs/${record.handle}`
    );
    assert.equal(
      record.didWeb,
      `did:web:vanguard-aegis-id-65067d.azurewebsites.net:orgs:${record.handle}`
    );
  });
});

test('a domain is only verified when the TXT record is actually there', async () => {
  await withEnv(async ({ identity }) => {
    await identity.ensureIdentity(WORKSPACE);
    const claimed = await identity.startDomainClaim(WORKSPACE.id, 'cloudstrucc.com');

    assert.equal(claimed.status, 'pending');
    assert.equal(claimed.isVerified, false);
    assert.equal(claimed.challenge.fullRecordName, '_aegis-challenge.cloudstrucc.com');
    assert.match(claimed.challenge.value, /^aegis-domain-verification=/);

    // Nothing published yet.
    identity.setTxtResolverForTesting(resolver({}));
    const missing = await identity.verifyDomain(WORKSPACE.id);
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, 'no-record');
    assert.equal(missing.identity.isVerified, false);

    // Something published, but not ours.
    identity.setTxtResolverForTesting(resolver({ '_aegis-challenge.cloudstrucc.com': [['nonsense']] }));
    const wrong = await identity.verifyDomain(WORKSPACE.id);
    assert.equal(wrong.ok, false);
    assert.equal(wrong.reason, 'mismatch');

    // The real thing.
    identity.setTxtResolverForTesting(
      resolver({ '_aegis-challenge.cloudstrucc.com': [[claimed.challenge.value]] })
    );
    const verified = await identity.verifyDomain(WORKSPACE.id);
    assert.equal(verified.ok, true);
    assert.equal(verified.identity.isVerified, true);
    assert.equal(verified.identity.displayIdentity, 'cloudstrucc.com');
    assert.equal(verified.identity.didWeb, 'did:web:cloudstrucc.com');
  });
});

test('a long TXT value split into chunks still matches', async () => {
  await withEnv(async ({ identity }) => {
    await identity.ensureIdentity(WORKSPACE);
    const claimed = await identity.startDomainClaim(WORKSPACE.id, 'cloudstrucc.com');
    const value = claimed.challenge.value;

    // DNS splits strings over 255 characters, and resolvers hand them back as
    // separate chunks. Joining them is not optional.
    const split = [value.slice(0, 10), value.slice(10)];
    identity.setTxtResolverForTesting(resolver({ '_aegis-challenge.cloudstrucc.com': [split] }));

    assert.equal((await identity.verifyDomain(WORKSPACE.id)).ok, true);
  });
});

test('the token is not kept once it has been used', async () => {
  await withEnv(async ({ dir, identity }) => {
    await identity.ensureIdentity(WORKSPACE);
    const claimed = await identity.startDomainClaim(WORKSPACE.id, 'cloudstrucc.com');
    identity.setTxtResolverForTesting(
      resolver({ '_aegis-challenge.cloudstrucc.com': [[claimed.challenge.value]] })
    );
    await identity.verifyDomain(WORKSPACE.id);

    const stored = await fs.readFile(path.join(dir, 'identities.json'), 'utf8');
    assert.equal(stored.includes(claimed.challenge.value.split('=')[1]), false);
  });
});

test('re-claiming issues a fresh token', async () => {
  await withEnv(async ({ identity }) => {
    await identity.ensureIdentity(WORKSPACE);
    const first = await identity.startDomainClaim(WORKSPACE.id, 'cloudstrucc.com');
    const second = await identity.startDomainClaim(WORKSPACE.id, 'cloudstrucc.com');

    // Otherwise somebody who saw the old value could finish an abandoned claim.
    assert.notEqual(first.challenge.value, second.challenge.value);
  });
});

test('a domain already verified elsewhere cannot be claimed', async () => {
  await withEnv(async ({ identity }) => {
    await identity.ensureIdentity(WORKSPACE);
    await identity.ensureIdentity(OTHER);

    const claimed = await identity.startDomainClaim(WORKSPACE.id, 'cloudstrucc.com');
    identity.setTxtResolverForTesting(
      resolver({ '_aegis-challenge.cloudstrucc.com': [[claimed.challenge.value]] })
    );
    await identity.verifyDomain(WORKSPACE.id);

    await assert.rejects(
      () => identity.startDomainClaim(OTHER.id, 'cloudstrucc.com'),
      /already verified by another organization/
    );
  });
});

test('two organizations may race for the same unproven domain', async () => {
  await withEnv(async ({ identity }) => {
    await identity.ensureIdentity(WORKSPACE);
    await identity.ensureIdentity(OTHER);

    // Claiming is not owning. Only publishing the record decides it, so an
    // unproven claim must not be able to block the real owner.
    await identity.startDomainClaim(WORKSPACE.id, 'contested.com');
    const second = await identity.startDomainClaim(OTHER.id, 'contested.com');
    assert.equal(second.status, 'pending');

    identity.setTxtResolverForTesting(
      resolver({ '_aegis-challenge.contested.com': [[second.challenge.value]] })
    );
    assert.equal((await identity.verifyDomain(OTHER.id)).ok, true);
    // The other claimant published nothing, so it stays unverified.
    assert.equal((await identity.verifyDomain(WORKSPACE.id)).ok, false);
  });
});

test('junk is refused rather than guessed at', async () => {
  await withEnv(async ({ identity }) => {
    await identity.ensureIdentity(WORKSPACE);
    for (const bad of ['', 'localhost', 'not a domain', 'com', '.com', 'a..b.com', '-lead.com', 'https://']) {
      await assert.rejects(
        () => identity.startDomainClaim(WORKSPACE.id, bad),
        /Enter a domain/,
        `should refuse ${JSON.stringify(bad)}`
      );
    }
  });
});

test('a pasted URL is reduced to its domain', async () => {
  await withEnv(async ({ identity }) => {
    const { normalizeDomain } = identity;
    assert.equal(normalizeDomain('https://Cloudstrucc.com/path?x=1'), 'cloudstrucc.com');
    assert.equal(normalizeDomain('  HTTP://www.cloudstrucc.com:8443/  '), 'www.cloudstrucc.com');
    assert.equal(normalizeDomain('cloudstrucc.com.'), 'cloudstrucc.com');
    assert.equal(normalizeDomain('someone@cloudstrucc.com'), 'cloudstrucc.com');
  });
});

test('an expired challenge is refused rather than quietly accepted', async () => {
  await withEnv(async ({ dir, identity }) => {
    await identity.ensureIdentity(WORKSPACE);
    const claimed = await identity.startDomainClaim(WORKSPACE.id, 'cloudstrucc.com');

    const file = path.join(dir, 'identities.json');
    const records = JSON.parse(await fs.readFile(file, 'utf8'));
    records[0].challenge.expiresAt = new Date(Date.now() - 1000).toISOString();
    await fs.writeFile(file, JSON.stringify(records, null, 2));

    identity.setTxtResolverForTesting(
      resolver({ '_aegis-challenge.cloudstrucc.com': [[claimed.challenge.value]] })
    );
    await assert.rejects(() => identity.verifyDomain(WORKSPACE.id), /expired/);
  });
});

test('checking is rate limited, because propagation makes people click', async () => {
  await withEnv(async ({ identity }) => {
    await identity.ensureIdentity(WORKSPACE);
    await identity.startDomainClaim(WORKSPACE.id, 'cloudstrucc.com');
    identity.setTxtResolverForTesting(resolver({}));

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await identity.verifyDomain(WORKSPACE.id);
    }
    await assert.rejects(() => identity.verifyDomain(WORKSPACE.id), /Too many checks/);
  });
});

test('revoking a verification keeps the handle', async () => {
  await withEnv(async ({ identity }) => {
    const created = await identity.ensureIdentity(WORKSPACE);
    const claimed = await identity.startDomainClaim(WORKSPACE.id, 'cloudstrucc.com');
    identity.setTxtResolverForTesting(
      resolver({ '_aegis-challenge.cloudstrucc.com': [[claimed.challenge.value]] })
    );
    await identity.verifyDomain(WORKSPACE.id);

    const revoked = await identity.revokeVerification(WORKSPACE.id, {
      actorEmail: 'admin@example.com',
      reason: 'Domain changed hands'
    });

    assert.equal(revoked.isVerified, false);
    assert.equal(revoked.domain, null);
    // The handle is the organization's identity, not the domain's.
    assert.equal(revoked.handle, created.handle);
    assert.equal(revoked.revokedReason, 'Domain changed hands');
  });
});

test('the whole lifecycle is on the evidence chain', async () => {
  await withEnv(async ({ identity }) => {
    const { verifyAuditChain } = require('../src/services/audit-service');
    await identity.ensureIdentity(WORKSPACE);
    const claimed = await identity.startDomainClaim(WORKSPACE.id, 'cloudstrucc.com', {
      actorEmail: 'owner@example.com'
    });
    identity.setTxtResolverForTesting(resolver({}));
    await identity.verifyDomain(WORKSPACE.id);
    identity.setTxtResolverForTesting(
      resolver({ '_aegis-challenge.cloudstrucc.com': [[claimed.challenge.value]] })
    );
    await identity.verifyDomain(WORKSPACE.id);
    await identity.revokeVerification(WORKSPACE.id, { actorEmail: 'admin@example.com' });

    const events = JSON.parse(await fs.readFile(process.env.AUDIT_STORE_PATH, 'utf8'));
    const types = events.map((entry) => entry.type);
    for (const expected of [
      'organization.identity.created',
      'organization.domain.claimed',
      'organization.domain.verification.failed',
      'organization.domain.verified',
      'organization.domain.verification.revoked'
    ]) {
      assert.ok(types.includes(expected), `missing ${expected}`);
    }

    assert.equal((await verifyAuditChain()).ok, true);
  });
});
