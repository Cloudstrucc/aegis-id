const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Recovering an organization administrator through the organization's own root
// wallets, rather than through email or through Vanguard.
//
// Four properties carry it, and each is a way the feature could be worthless:
//
//   * two approvals, from two DIFFERENT wallets — otherwise one stolen device
//     is a takeover
//   * a token belongs to one wallet — otherwise "two approvals" is one device
//     scanning twice
//   * the person recovering never receives a token — otherwise a stolen inbox
//     approves its own recovery and nothing has been gained over email
//   * once an organization is at the recommended count, the weaker path closes
//     — otherwise an attacker simply uses that one

const MODULES = [
  '../src/config',
  '../src/services/approver-recovery-service',
  '../src/services/account-reenrolment-service',
  '../src/services/root-wallet-service',
  '../src/services/wallet-registry-service',
  '../src/services/platform-service',
  '../src/services/subscription-service',
  '../src/services/admin-access-service',
  '../src/services/notification-settings-service',
  '../src/services/otp-delivery-service',
  // The adapter holds its own reference to config, so without resetting it too
  // every test after the first writes its mail into the previous test's
  // directory and reads an empty one.
  '../src/adapters/notify/notification-adapter',
  '../src/services/audit-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

const OWNER_EMAIL = 'admin@vanguardcs.ca';
const WORKSPACE_ID = 'ws-approvers';

async function withEnv(run, { enforced = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-approver-recovery-'));
  const previous = { ...process.env };

  process.env.ROOT_WALLET_POLICY_ENFORCED = enforced ? 'true' : 'false';
  process.env.ROOT_WALLET_STORE_PATH = path.join(dir, 'root-wallets.json');
  process.env.WALLET_STORE_PATH = path.join(dir, 'wallets.json');
  process.env.USER_STORE_PATH = path.join(dir, 'users.json');
  process.env.SUBSCRIPTION_STORE_PATH = path.join(dir, 'subscriptions.json');
  process.env.SUBSCRIBER_WORKSPACE_STORE_PATH = path.join(dir, 'workspaces.json');
  process.env.ACCOUNT_REENROLMENT_STORE_PATH = path.join(dir, 'grants.json');
  process.env.APPROVER_RECOVERY_STORE_PATH = path.join(dir, 'approver-recovery.json');
  process.env.NOTIFICATION_SETTINGS_STORE_PATH = path.join(dir, 'notification-settings.json');
  process.env.NOTIFICATION_LOG_STORE_PATH = path.join(dir, 'notification-log.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  // The filesystem transport writes messages to disk, so a test can read what
  // each recipient was actually sent — which is the point of half of these.
  process.env.MAIL_DROP_PATH = path.join(dir, 'mail');
  resetModules();

  try {
    const registry = require('../src/services/wallet-registry-service');
    const roots = require('../src/services/root-wallet-service');
    const recovery = require('../src/services/approver-recovery-service');

    await seedAccount(dir);

    await run({ dir, registry, roots, recovery });
  } finally {
    process.env = previous;
    resetModules();
  }
}

/**
 * A passwordless administrator who owns a workspace. Written straight to the
 * stores: the point here is the recovery, not the signup path.
 */
async function seedAccount(dir) {
  await fs.writeFile(
    path.join(dir, 'users.json'),
    JSON.stringify([
      {
        id: 'user-1',
        email: OWNER_EMAIL,
        displayName: 'Fred',
        passwordHash: null,
        passwordless: true,
        passkeys: [],
        createdAt: new Date().toISOString()
      }
    ])
  );
  await fs.writeFile(
    path.join(dir, 'subscriptions.json'),
    JSON.stringify([
      { id: 'sub-1', userId: 'user-1', email: OWNER_EMAIL, organization: 'VCS-613', plan: 'basic' }
    ])
  );
  await fs.writeFile(
    path.join(dir, 'workspaces.json'),
    JSON.stringify([
      {
        id: WORKSPACE_ID,
        subscriptionId: 'sub-1',
        ownerEmail: OWNER_EMAIL,
        organization: 'VCS-613',
        members: [],
        createdAt: new Date().toISOString()
      }
    ])
  );
}

let seedCounter = 0;

/** Confirmed root wallets, each with its own registered holder address. */
async function confirmedRootWallets(roots, registry, count) {
  const created = [];
  for (let index = 0; index < count; index += 1) {
    const email = `holder${seedCounter++}@example.com`;
    const wallet = await registry.registerWallet({ email, phone: '', devicePublicKey: `device-${email}` });
    const { confirmationToken } = await roots.nominateRootWallet(WORKSPACE_ID, wallet.walletId, {
      actorEmail: OWNER_EMAIL
    });
    await roots.confirmRootWallet(wallet.walletId, confirmationToken);
    created.push(wallet);
  }
  return created;
}

/**
 * Every message the filesystem transport wrote, newest last. It writes plain
 * text with a `To:` header, so this reads what each recipient actually got —
 * which is the point of half of these tests.
 */
async function sentMessages(dir) {
  const mailDir = path.join(dir, 'mail');
  const names = await fs.readdir(mailDir).catch(() => []);
  const messages = [];
  for (const name of names.sort()) {
    const body = await fs.readFile(path.join(mailDir, name), 'utf8');
    messages.push({ to: /^To: (.*)$/m.exec(body)?.[1]?.trim() || '', body });
  }
  return messages;
}

/** The approval deep links, read out of what each holder was actually sent. */
async function approvalLinks(dir) {
  const links = [];
  for (const message of await sentMessages(dir)) {
    const match = /(\S+:\/\/recovery-approve\?\S+)/.exec(message.body);
    if (!match) {
      continue;
    }
    const url = new URL(match[1]);
    links.push({
      to: message.to,
      requestId: url.searchParams.get('request_id'),
      token: url.searchParams.get('token')
    });
  }
  return links;
}

test('two distinct root wallets approve, and one alone is not enough', async () => {
  await withEnv(async ({ dir, registry, roots, recovery }) => {
    await confirmedRootWallets(roots, registry, 3);
    await recovery.startApproverRecovery(OWNER_EMAIL, { baseUrl: 'https://aegis.test' });

    const links = await approvalLinks(dir);
    assert.equal(links.length, 3, 'one link per confirmed root wallet');

    const wallets = await registry.listWallets();
    const walletFor = (token) => links.find((link) => link.token === token);

    // Each token belongs to exactly one wallet. Presenting it from another
    // wallet is refused, so "two approvals" cannot be one device twice.
    const first = links[0];
    const otherWallet = wallets.find((wallet) => wallet.email === walletFor(links[1].token).to);
    await assert.rejects(
      () => recovery.approveRecoveryRequest(otherWallet.walletId, first.requestId, first.token),
      /not valid/
    );

    const firstWallet = wallets.find((wallet) => wallet.email === first.to);
    const afterOne = await recovery.approveRecoveryRequest(firstWallet.walletId, first.requestId, first.token);
    assert.equal(afterOne.approvalCount, 1);
    assert.equal(afterOne.isApproved, false);

    // The same wallet scanning again is not a second approval.
    const again = await recovery.approveRecoveryRequest(firstWallet.walletId, first.requestId, first.token);
    assert.equal(again.approvalCount, 1, 'one device cannot approve twice');

    const second = links[1];
    const secondWallet = wallets.find((wallet) => wallet.email === second.to);
    const afterTwo = await recovery.approveRecoveryRequest(secondWallet.walletId, second.requestId, second.token);
    assert.equal(afterTwo.approvalCount, 2);
    assert.equal(afterTwo.isApproved, true);
  });
});

test('the person recovering is never sent anything that can approve', async () => {
  await withEnv(async ({ dir, registry, roots, recovery }) => {
    await confirmedRootWallets(roots, registry, 3);
    await recovery.startApproverRecovery(OWNER_EMAIL, { baseUrl: 'https://aegis.test' });

    const messages = await sentMessages(dir);
    const toRequester = messages.filter((message) => message.to === OWNER_EMAIL);
    assert.ok(toRequester.length > 0, 'the requester is told the request is in flight');

    // This is the property that makes it better than email: taking over the
    // administrator's inbox reaches a status page and nothing usable.
    for (const message of toRequester) {
      assert.ok(
        !message.body.includes('recovery-approve'),
        'no approval link may reach the person recovering'
      );
    }
  });
});

test('the grant is issued only once, and only with enough approvals', async () => {
  await withEnv(async ({ dir, registry, roots, recovery }) => {
    await confirmedRootWallets(roots, registry, 3);
    await recovery.startApproverRecovery(OWNER_EMAIL, { baseUrl: 'https://aegis.test' });

    const statusToken = await requesterStatusToken(dir);
    const links = await approvalLinks(dir);
    const wallets = await registry.listWallets();

    await assert.rejects(
      () => recovery.claimApproverRecovery(statusToken, { baseUrl: 'https://aegis.test' }),
      (error) => error.status === 409
    );

    for (const link of links.slice(0, 2)) {
      const wallet = wallets.find((entry) => entry.email === link.to);
      await recovery.approveRecoveryRequest(wallet.walletId, link.requestId, link.token);
    }

    const claimed = await recovery.claimApproverRecovery(statusToken, { baseUrl: 'https://aegis.test' });
    assert.equal(claimed.isGranted, true);

    // Spent. A second claim cannot mint a second grant.
    await assert.rejects(
      () => recovery.claimApproverRecovery(statusToken, { baseUrl: 'https://aegis.test' }),
      (error) => error.status === 410
    );

    // The re-enrolment link went to the account's own address, as it does when
    // an administrator authorises one — the difference is who authorised it.
    const reenrolment = (await sentMessages(dir)).filter((message) => message.body.includes('/auth/reenrol/'));
    assert.equal(reenrolment.length, 1);
    assert.equal(reenrolment[0].to, OWNER_EMAIL);
  });
});

/** The status link the requester was sent, which carries no approval token. */
async function requesterStatusToken(dir) {
  for (const message of await sentMessages(dir)) {
    const match = /\/auth\/recover\/approvals\/([A-Za-z0-9_-]+)/.exec(message.body);
    if (match) {
      return match[1];
    }
  }
  return null;
}

test('an organization with one root wallet cannot use this at all', async () => {
  await withEnv(async ({ dir, registry, roots, recovery }) => {
    await confirmedRootWallets(roots, registry, 1);
    await recovery.startApproverRecovery(OWNER_EMAIL, { baseUrl: 'https://aegis.test' });

    // Below two approvers there is nobody to ask, so nothing is sent and the
    // caller is told exactly what an unknown address is told.
    assert.equal((await approvalLinks(dir)).length, 0);
  });
});

test('an unknown address is answered identically and creates nothing', async () => {
  await withEnv(async ({ dir, registry, roots, recovery }) => {
    await confirmedRootWallets(roots, registry, 3);
    const result = await recovery.startApproverRecovery('nobody@example.com', {
      baseUrl: 'https://aegis.test'
    });

    assert.deepEqual(result, { requested: true });
    assert.equal((await approvalLinks(dir)).length, 0);
  });
});

test('the weaker path closes at the recommended count, and only when enforced', async () => {
  await withEnv(async ({ registry, roots, recovery }) => {
    const account = { id: 'user-1', email: OWNER_EMAIL };

    await confirmedRootWallets(roots, registry, 2);
    assert.equal(await recovery.canUseApproverRecovery(account), true);
    // Two is enough to approve, but not enough to take the older path away —
    // an organization that cannot reliably find two approvers would be locked
    // out rather than protected.
    assert.equal(await recovery.requiresApproverRecovery(account), false);

    await confirmedRootWallets(roots, registry, 1);
    assert.equal(await recovery.requiresApproverRecovery(account), true);
  });
});

test('enforcement off leaves the older path open however many wallets there are', async () => {
  await withEnv(
    async ({ registry, roots, recovery }) => {
      await confirmedRootWallets(roots, registry, 3);
      const account = { id: 'user-1', email: OWNER_EMAIL };

      assert.equal(await recovery.canUseApproverRecovery(account), true);
      assert.equal(await recovery.requiresApproverRecovery(account), false);
    },
    { enforced: false }
  );
});
