const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// A7 (configurable assurance derivation) and OTP delivery behaviour.

const MODULES = [
  '../src/config',
  '../src/services/org-admin-service',
  '../src/services/wallet-registry-service',
  '../src/services/notification-settings-service',
  '../src/services/otp-delivery-service',
  '../src/services/audit-service'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(env, run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-assurance-'));
  const previous = { ...process.env };
  process.env.ORG_ADMIN_STORE_PATH = path.join(dir, 'org-admin.json');
  process.env.ORG_ADMIN_EVENT_STORE_PATH = path.join(dir, 'events.json');
  process.env.SUBSCRIBER_WORKSPACE_STORE_PATH = path.join(dir, 'workspaces.json');
  process.env.WALLET_STORE_PATH = path.join(dir, 'wallets.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  process.env.NOTIFICATION_SETTINGS_STORE_PATH = path.join(dir, 'notify.json');
  Object.assign(process.env, env);
  resetModules();
  try {
    await run({ dir });
  } finally {
    process.env = previous;
    resetModules();
  }
}

const workspace = {
  id: 'ws-1',
  subscriptionId: 'sub-1',
  organization: 'VCS',
  ownerEmail: 'admin@vcs.ca',
  members: [{ email: 'admin@vcs.ca', role: 'administrator', addedAt: new Date().toISOString() }],
  platforms: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
const subscription = { id: 'sub-1', email: 'admin@vcs.ca', organization: 'VCS' };

test('A7 derive mode: a YubiKey assurance claim yields high assurance', async () => {
  await withEnv({ CREDENTIAL_ASSURANCE_MODE: 'derive' }, async () => {
    const orgAdmin = require('../src/services/org-admin-service');
    const credential = await orgAdmin.issueCredential(workspace, subscription, {
      holderEmail: 'hardware@example.com',
      assuranceLevel: '',
      assurance: 'FIDO2_YUBIKEY'
    });
    // The claim carries the hardware signal, so the credential is high assurance
    // and a Tier-1 self-service recovery will suspend it.
    assert.equal(credential.assuranceLevel, 'high');
  });
});

test('A7 derive mode: an ordinary credential stays at the default level', async () => {
  await withEnv({ CREDENTIAL_ASSURANCE_MODE: 'derive' }, async () => {
    const orgAdmin = require('../src/services/org-admin-service');
    const credential = await orgAdmin.issueCredential(workspace, subscription, {
      holderEmail: 'ordinary@example.com'
    });
    assert.equal(credential.assuranceLevel, 'medium');
  });
});

test('A7 explicit mode ignores derivation signals', async () => {
  await withEnv({ CREDENTIAL_ASSURANCE_MODE: 'explicit' }, async () => {
    const orgAdmin = require('../src/services/org-admin-service');
    const credential = await orgAdmin.issueCredential(workspace, subscription, {
      holderEmail: 'explicit@example.com',
      assurance: 'FIDO2_YUBIKEY'
    });
    assert.equal(credential.assuranceLevel, 'medium', 'explicit mode must not infer high');
  });
});

test('A7: an explicitly supplied level always wins', async () => {
  await withEnv({ CREDENTIAL_ASSURANCE_MODE: 'derive' }, async () => {
    const orgAdmin = require('../src/services/org-admin-service');
    const credential = await orgAdmin.issueCredential(workspace, subscription, {
      holderEmail: 'pinned@example.com',
      assuranceLevel: 'low',
      assurance: 'FIDO2_YUBIKEY'
    });
    assert.equal(credential.assuranceLevel, 'low');
  });
});

test('A7: the high-assurance signal list is configurable', async () => {
  await withEnv(
    { CREDENTIAL_ASSURANCE_MODE: 'derive', CREDENTIAL_ASSURANCE_HIGH_SIGNALS: 'smartcard' },
    async () => {
      const orgAdmin = require('../src/services/org-admin-service');
      const yubikey = await orgAdmin.issueCredential(workspace, subscription, {
        holderEmail: 'yk@example.com',
        assurance: 'FIDO2_YUBIKEY'
      });
      const smartcard = await orgAdmin.issueCredential(workspace, subscription, {
        holderEmail: 'sc@example.com',
        assurance: 'SMARTCARD_PIV'
      });
      assert.equal(yubikey.assuranceLevel, 'medium', 'yubikey is no longer a configured signal');
      assert.equal(smartcard.assuranceLevel, 'high', 'smartcard is now the configured signal');
    }
  );
});

test('OTP delivery returns the code locally when no channel is configured', async () => {
  await withEnv({ NODE_ENV: 'development' }, async () => {
    const { deliverRecoveryCode } = require('../src/services/otp-delivery-service');
    const result = await deliverRecoveryCode({
      code: '123456',
      walletId: 'AEG-TEST',
      email: 'holder@example.com'
    });
    assert.equal(result.delivered, false);
    assert.equal(result.devCode, '123456', 'local testing needs no mail server');
  });
});

test('OTP delivery fails closed in production when nothing is configured', async () => {
  await withEnv({ NODE_ENV: 'production' }, async () => {
    const { deliverRecoveryCode } = require('../src/services/otp-delivery-service');
    // Returning the code here would let anyone who can reach the API recover
    // any wallet, so production must refuse instead.
    await assert.rejects(
      () =>
        deliverRecoveryCode({
          code: '123456',
          walletId: 'AEG-TEST',
          email: 'holder@example.com'
        }),
      (error) => error.status === 503
    );
  });
});

test('notification settings mask secrets and keep stored values on blank save', async () => {
  await withEnv({}, async () => {
    const settings = require('../src/services/notification-settings-service');

    await settings.updateNotificationSettings(
      {
        emailEnabled: 'true',
        emailPreset: 'gmail',
        emailUsername: 'sender@vanguardcs.ca',
        emailPassword: 'app-password-secret',
        emailFromAddress: 'no-reply@vanguardcs.ca'
      },
      'admin@vcs.ca'
    );

    const display = await settings.getNotificationSettingsForDisplay();
    assert.equal(display.email.password, '', 'secret must never be sent to the browser');
    assert.equal(display.email.hasPassword, true);
    assert.equal(display.email.host, 'smtp.gmail.com', 'preset supplies the host');

    // Saving again with a blank password keeps the stored one.
    await settings.updateNotificationSettings(
      { emailEnabled: 'true', emailPreset: 'gmail', emailPassword: '' },
      'admin@vcs.ca'
    );
    const stored = await settings.getNotificationSettings();
    assert.equal(stored.email.password, 'app-password-secret');
  });
});

test('Exchange and Gmail presets use STARTTLS on 587', async () => {
  await withEnv({}, async () => {
    const { EMAIL_PRESETS } = require('../src/services/notification-settings-service');
    for (const id of ['microsoft-exchange', 'gmail']) {
      assert.equal(EMAIL_PRESETS[id].port, 587);
      assert.equal(EMAIL_PRESETS[id].secure, false);
      assert.equal(EMAIL_PRESETS[id].requireTls, true);
    }
    assert.equal(EMAIL_PRESETS['microsoft-exchange'].host, 'smtp.office365.com');
    assert.equal(EMAIL_PRESETS.gmail.host, 'smtp.gmail.com');
  });
});
