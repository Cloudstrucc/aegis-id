const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Who administers an organization, as opposed to who administers the platform.
//
// The bug this exists to prevent coming back: somebody given an administrator
// role in an organization's People screen was treated as an employee
// everywhere, because `isWorkspaceAdmin()` reads workspace membership and
// nothing wrote membership from a role assignment.
//
// The boundary this exists to hold: fixing that must not widen platform access
// by a single page. `admin-access.test.js` asserts the other half — that an
// invited holder still never reaches /admin — and the two tests together are
// the proof that tenant administration and platform administration are
// separate things.

const MODULES = [
  '../src/config',
  '../src/services/admin-access-service',
  '../src/services/tenant-access-service',
  '../src/services/platform-service',
  '../src/services/org-admin-service',
  '../src/services/organization-identity-service',
  '../src/services/subscription-service',
  '../src/services/wallet-registry-service',
  '../src/services/root-wallet-service',
  '../src/services/audit-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-tenant-access-'));
  const previous = { ...process.env };
  process.env.SUBSCRIPTION_STORE_PATH = path.join(dir, 'subs.json');
  process.env.SUBSCRIBER_WORKSPACE_STORE_PATH = path.join(dir, 'ws.json');
  process.env.ORG_ADMIN_STORE_PATH = path.join(dir, 'oa.json');
  process.env.ORG_ADMIN_EVENT_STORE_PATH = path.join(dir, 'oae.json');
  process.env.ORGANIZATION_IDENTITY_STORE_PATH = path.join(dir, 'ident.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  // Issuance is otherwise blocked for an organization with no root wallet, and
  // these tests are about roles rather than about recovery.
  process.env.ROOT_WALLET_POLICY_ENFORCED = 'false';
  resetModules();
  try {
    await run({
      access: require('../src/services/admin-access-service'),
      tenants: require('../src/services/tenant-access-service'),
      platform: require('../src/services/platform-service'),
      org: require('../src/services/org-admin-service'),
      subscriptions: require('../src/services/subscription-service'),
      orgStorePath: process.env.ORG_ADMIN_STORE_PATH
    });
  } finally {
    process.env = previous;
    resetModules();
  }
}

const OWNER = { id: 'user-owner', email: 'owner@example.com' };
const INVITED = { id: 'user-invited', email: 'invited@example.com' };
const EMPLOYEE = { id: 'user-employee', email: 'employee@example.com' };
const OUTSIDER = { id: 'user-outsider', email: 'outsider@example.com' };

/** An organization with an owner, and the raw workspace record behind it. */
async function seedOrganization({ platform, subscriptions }, name = 'Cloudstrucc', owner = OWNER) {
  const subscription = await subscriptions.createSubscription(
    { organization: name, consent: 'yes', plan: 'pro' },
    owner
  );
  await platform.registerWorkspaceForSubscription(subscription, {
    organization: name,
    role: 'administrator'
  });
  const workspace = (await platform.listAllWorkspaces()).find(
    (candidate) => candidate.organization === name
  );
  return { subscription, workspace };
}

function adminRoleId(state) {
  return state.roles.find((role) => role.adminRole).id;
}

function namedRoleId(state, name) {
  return state.roles.find((role) => role.name === name).id;
}

test('every new organization is seeded with an assignable administrator role', async () => {
  await withEnv(async (ctx) => {
    const { workspace } = await seedOrganization(ctx);
    const state = await ctx.org.getOrCreateState(workspace);

    const admin = state.roles.filter((role) => role.adminRole);
    assert.equal(admin.length, 1, 'exactly one seeded admin role');
    assert.equal(admin[0].name, 'Organization admin');

    // The role that used to be the only admin-sounding option grants nothing,
    // and no longer says otherwise.
    const nominee = state.roles.find((role) => role.id === 'role-admin-eligible');
    assert.equal(nominee.name, 'Co-admin nominee');
    assert.equal(nominee.adminRole, false);
    assert.match(nominee.description, /no administrative access/i);
  });
});

test('an organization that predates the seeded admin role gets one on first read', async () => {
  await withEnv(async (ctx) => {
    const { workspace } = await seedOrganization(ctx);
    await ctx.org.getOrCreateState(workspace);

    // Rewind the store to the old shape: three roles, none of them an admin
    // role, and the misleading label. This is what a real organization created
    // before the seeded role looks like on disk.
    const states = JSON.parse(await fs.readFile(ctx.orgStorePath, 'utf8'));
    const stored = states.find((record) => record.workspaceId === workspace.id);
    stored.roles = stored.roles
      .filter((role) => !role.adminRole)
      .map((role) => (role.id === 'role-admin-eligible' ? { ...role, name: 'Admin Eligible' } : role));
    assert.equal(stored.roles.length, 3);
    await fs.writeFile(ctx.orgStorePath, JSON.stringify(states));

    const repaired = await ctx.org.getOrCreateState(workspace);
    assert.ok(repaired.roles.some((role) => role.adminRole), 'an admin role is seeded in');
    assert.equal(
      repaired.roles.find((role) => role.adminRole).name,
      'Organization admin'
    );
    assert.equal(
      repaired.roles.find((role) => role.id === 'role-admin-eligible').name,
      'Co-admin nominee'
    );
  });
});

test('assigning an administrator role makes somebody an administrator of that organization', async () => {
  await withEnv(async (ctx) => {
    const { subscription, workspace } = await seedOrganization(ctx);
    const state = await ctx.org.getOrCreateState(workspace);

    // Invite them as an employee first. They administer nothing.
    const credential = await ctx.org.issueCredential(workspace, subscription, {
      holderEmail: INVITED.email,
      displayName: 'Invited Admin',
      personType: 'employee',
      roleIds: [namedRoleId(state, 'Employee')]
    });

    let tenant = await ctx.tenants.getTenantForUser(INVITED, (await ctx.tenants.listTenantsForUser(INVITED))[0]?.handle);
    assert.equal(tenant.isAdmin, false, 'an employee is not an administrator');

    // Now give them the administrator role, exactly as the People screen does.
    const current = (await ctx.platform.listAllWorkspaces()).find((item) => item.id === workspace.id);
    await ctx.org.updateCredentialProfile(current, subscription, credential.id, {
      roleIds: [adminRoleId(state)],
      holderEmail: INVITED.email,
      displayName: 'Invited Admin',
      personType: 'employee'
    });

    const after = (await ctx.tenants.listTenantsForUser(INVITED))[0];
    assert.equal(after.isAdmin, true, 'the role assignment took effect');
    assert.equal(after.roleLabel, 'Administrator');

    // The membership role — the thing isWorkspaceAdmin() actually reads — was
    // written too, which is the defect this guards.
    const stored = (await ctx.platform.listAllWorkspaces()).find((item) => item.id === workspace.id);
    const member = stored.members.find((entry) => entry.email === INVITED.email);
    assert.equal(member.role, 'administrator');
    assert.equal(member.grantedByRole, true);
    assert.equal(ctx.org.isWorkspaceAdmin(stored, { email: INVITED.email }), true);
  });
});

test('administering one organization grants nothing in another', async () => {
  await withEnv(async (ctx) => {
    const first = await seedOrganization(ctx, 'Cloudstrucc');
    // A second subscriber entirely, so this is two tenants rather than two
    // workspaces under one plan.
    const second = await seedOrganization(ctx, 'VanguardCS', OUTSIDER);
    const state = await ctx.org.getOrCreateState(first.workspace);

    await ctx.org.issueCredential(first.workspace, first.subscription, {
      holderEmail: INVITED.email,
      displayName: 'Invited Admin',
      personType: 'employee',
      roleIds: [adminRoleId(state)]
    });

    const reachable = await ctx.tenants.listTenantsForUser(INVITED);
    assert.deepEqual(reachable.map((tenant) => tenant.organization), ['Cloudstrucc']);

    // The other organization is not merely un-administered — it is not visible,
    // and asking for it by handle answers 404 rather than 403, so the URL
    // cannot be used to discover that it exists.
    const vanguard = (await ctx.tenants.listTenantsForUser(OUTSIDER))
      .find((tenant) => tenant.organization === 'VanguardCS');
    assert.ok(vanguard.handle, 'the second organization has a handle');
    await assert.rejects(
      () => ctx.tenants.assertTenantAdmin(INVITED, vanguard.handle),
      (error) => error.status === 404
    );
    assert.equal(second.workspace.organization, 'VanguardCS');
  });
});

test('a non-admin member of an organization is refused its settings', async () => {
  await withEnv(async (ctx) => {
    const { subscription, workspace } = await seedOrganization(ctx);
    const state = await ctx.org.getOrCreateState(workspace);

    await ctx.org.issueCredential(workspace, subscription, {
      holderEmail: EMPLOYEE.email,
      displayName: 'Plain Employee',
      personType: 'employee',
      roleIds: [namedRoleId(state, 'Employee')]
    });

    const tenant = (await ctx.tenants.listTenantsForUser(EMPLOYEE))[0];
    assert.equal(tenant.isAdmin, false);
    await assert.rejects(
      () => ctx.tenants.assertTenantAdmin(EMPLOYEE, tenant.handle),
      (error) => error.status === 403
    );

    // A privilege they do hold still resolves, so the two policy types really
    // are different gates rather than one.
    await ctx.tenants.assertTenantPrivilege(EMPLOYEE, tenant.handle, 'credentials.view.own');
    await assert.rejects(
      () => ctx.tenants.assertTenantPrivilege(EMPLOYEE, tenant.handle, 'roles.manage'),
      (error) => error.status === 403
    );
  });
});

test('somebody with no membership sees no organizations at all', async () => {
  await withEnv(async (ctx) => {
    await seedOrganization(ctx);
    assert.deepEqual(await ctx.tenants.listTenantsForUser(OUTSIDER), []);
    assert.equal(await ctx.tenants.canAdministerAnyTenant(OUTSIDER), false);
    assert.deepEqual(await ctx.tenants.listTenantsForUser(null), []);
  });
});

test('tenant administration does not open the platform area', async () => {
  await withEnv(async (ctx) => {
    const { subscription, workspace } = await seedOrganization(ctx);
    const state = await ctx.org.getOrCreateState(workspace);

    await ctx.org.issueCredential(workspace, subscription, {
      holderEmail: INVITED.email,
      displayName: 'Invited Admin',
      personType: 'employee',
      roleIds: [adminRoleId(state)]
    });
    await ctx.subscriptions.ensureAccountAccessSubscription(INVITED);

    // They administer their organization...
    assert.equal(await ctx.tenants.canAdministerAnyTenant(INVITED), true);
    // ...and still cannot reach sign-in methods, notification delivery or
    // registration codes, which decide how the whole deployment behaves.
    assert.equal(await ctx.access.canViewAdminOperations(INVITED), false);
    await assert.rejects(
      () => ctx.access.assertAdminOperations(INVITED),
      /subscribers who administer/
    );
  });
});

test('revoking the credential that carried the role withdraws the administration', async () => {
  await withEnv(async (ctx) => {
    const { subscription, workspace } = await seedOrganization(ctx);
    const state = await ctx.org.getOrCreateState(workspace);

    const credential = await ctx.org.issueCredential(workspace, subscription, {
      holderEmail: INVITED.email,
      displayName: 'Invited Admin',
      personType: 'employee',
      roleIds: [adminRoleId(state)]
    });
    assert.equal((await ctx.tenants.listTenantsForUser(INVITED))[0].isAdmin, true);

    const current = (await ctx.platform.listAllWorkspaces()).find((item) => item.id === workspace.id);
    await ctx.org.revokeCredential(current, subscription, credential.id, 'Left the company');

    const stored = (await ctx.platform.listAllWorkspaces()).find((item) => item.id === workspace.id);
    const member = stored.members.find((entry) => entry.email === INVITED.email);
    assert.notEqual(member.role, 'administrator', 'a revoked holder stops administering');
  });
});

test('the workspace owner is never demoted by a role sync', async () => {
  await withEnv(async (ctx) => {
    const { subscription, workspace } = await seedOrganization(ctx);
    const state = await ctx.org.getOrCreateState(workspace);

    // The owner holds no credential with an admin role — their administration
    // comes from ownership. A sync that read only roles would strand them.
    const credential = await ctx.org.issueCredential(workspace, subscription, {
      holderEmail: OWNER.email,
      displayName: 'Owner',
      personType: 'employee',
      roleIds: [namedRoleId(state, 'Employee')]
    });
    const current = (await ctx.platform.listAllWorkspaces()).find((item) => item.id === workspace.id);
    await ctx.org.revokeCredential(current, subscription, credential.id, 'tidy up');

    const stored = (await ctx.platform.listAllWorkspaces()).find((item) => item.id === workspace.id);
    assert.equal(ctx.org.isWorkspaceAdmin(stored, { email: OWNER.email }), true);
    assert.equal((await ctx.tenants.listTenantsForUser(OWNER))[0].isAdmin, true);
  });
});

test('the backfill grants administration to holders whose role already said so', async () => {
  await withEnv(async (ctx) => {
    const { subscription, workspace } = await seedOrganization(ctx);
    const state = await ctx.org.getOrCreateState(workspace);

    await ctx.org.issueCredential(workspace, subscription, {
      holderEmail: INVITED.email,
      displayName: 'Invited Admin',
      personType: 'employee',
      roleIds: [adminRoleId(state)]
    });

    // Rewind to the pre-sync world: the role is assigned, the membership is not.
    await ctx.platform.revokeWorkspaceMemberRole(workspace.id, INVITED.email, 'administrator');
    let stored = (await ctx.platform.listAllWorkspaces()).find((item) => item.id === workspace.id);
    assert.equal(ctx.org.isWorkspaceAdmin(stored, { email: INVITED.email }), false);

    const result = await ctx.org.backfillAdminMemberships();
    assert.equal(result.granted, 1);

    stored = (await ctx.platform.listAllWorkspaces()).find((item) => item.id === workspace.id);
    assert.equal(ctx.org.isWorkspaceAdmin(stored, { email: INVITED.email }), true);

    // Idempotent: running it again changes nothing.
    assert.equal((await ctx.org.backfillAdminMemberships()).granted, 0);
  });
});
