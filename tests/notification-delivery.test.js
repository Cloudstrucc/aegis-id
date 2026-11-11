const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Phase 1: every outbound message goes through one delivery path, the channel
// matrix is honoured, and codes are never handed back to the caller.

const MODULES = [
  '../src/config',
  '../src/services/notification-settings-service',
  '../src/services/otp-delivery-service',
  '../src/services/auth-service',
  '../src/services/audit-service',
  '../src/adapters/notify/notification-adapter'
];

function resetModules() {
  for (const modulePath of MODULES) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withEnv(env, run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-notify-'));
  const previous = { ...process.env };
  process.env.USER_STORE_PATH = path.join(dir, 'users.json');
  process.env.NOTIFICATION_SETTINGS_STORE_PATH = path.join(dir, 'notify.json');
  process.env.NOTIFICATION_LOG_STORE_PATH = path.join(dir, 'notify-log.json');
  process.env.AUDIT_STORE_PATH = path.join(dir, 'audit.json');
  process.env.MAIL_DROP_PATH = path.join(dir, 'mail');
  Object.assign(process.env, env);
  resetModules();
  try {
    await run({ dir });
  } finally {
    process.env = previous;
    resetModules();
  }
}

async function readMailDrop(dir) {
  try {
    const files = await fs.readdir(path.join(dir, 'mail'));
    const bodies = await Promise.all(
      files.map((file) => fs.readFile(path.join(dir, 'mail', file), 'utf8'))
    );
    return bodies;
  } catch {
    return [];
  }
}

test('a sign-in code is actually sent, not just generated', async () => {
  await withEnv({ NODE_ENV: 'development' }, async ({ dir }) => {
    const { registerUser, createOtpChallenge, verifyOtpChallenge } = require('../src/services/auth-service');
    const user = await registerUser({
      displayName: 'Codey Tester',
      email: 'codey@example.com',
      password: 'CorrectHorseBattery',
      confirmPassword: 'CorrectHorseBattery'
    });

    const challenge = await createOtpChallenge(user.id, 'email');
    assert.equal(challenge.delivered, true);

    const messages = await readMailDrop(dir);
    assert.equal(messages.length, 1, 'exactly one message was sent');

    // Matched as "a six-digit code somewhere in the message" rather than
    // against a sentence: the wording is in a per-locale catalogue now, and
    // a test that pins the English phrasing fails the moment it is reworded
    // or the recipient's locale changes.
    const code = /\b(\d{6})\b/.exec(messages[0])?.[1];
    assert.ok(code, 'the message carries the six-digit code');
    assert.equal(await verifyOtpChallenge(user.id, code), true, 'the sent code is the one that verifies');
  });
});

test('the sign-in code is never returned to the caller', async () => {
  await withEnv({ NODE_ENV: 'development' }, async () => {
    const { registerUser, createOtpChallenge } = require('../src/services/auth-service');
    const user = await registerUser({
      displayName: 'Quiet Tester',
      email: 'quiet@example.com',
      password: 'CorrectHorseBattery',
      confirmPassword: 'CorrectHorseBattery'
    });

    const challenge = await createOtpChallenge(user.id, 'email');
    // Returning it would be a bypass in dev and qa, which are internet-facing
    // and run NODE_ENV=production anyway.
    assert.equal('developmentCode' in challenge, false);
    assert.equal(JSON.stringify(challenge).match(/\d{6}/), null);
  });
});

test('a message type with no channel ticked is not sent', async () => {
  await withEnv({ NODE_ENV: 'development' }, async ({ dir }) => {
    const settings = require('../src/services/notification-settings-service');
    await settings.updateNotificationSettings(
      {
        emailEnabled: 'true',
        emailPreset: 'filesystem',
        // Only wallet recovery may use email; mfa-otp is left unticked.
        'type_wallet-recovery_email': 'true'
      },
      'admin@example.com'
    );

    const { deliverMessage } = require('../src/services/otp-delivery-service');
    const blocked = await deliverMessage({
      type: 'mfa-otp',
      email: 'someone@example.com',
      variables: { code: '111111' }
    });
    assert.equal(blocked.delivered, false, 'mfa-otp has no permitted channel');

    const allowed = await deliverMessage({
      type: 'wallet-recovery',
      email: 'someone@example.com',
      variables: { code: '222222', walletId: 'AEG-TEST' }
    });
    assert.equal(allowed.delivered, true);

    const messages = await readMailDrop(dir);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /222222/);
  });
});

test('an unknown message type is refused rather than silently dropped', async () => {
  await withEnv({ NODE_ENV: 'development' }, async () => {
    const { deliverMessage } = require('../src/services/otp-delivery-service');
    await assert.rejects(
      () => deliverMessage({ type: 'not-a-real-type', email: 'x@example.com' }),
      /Unknown message type/
    );
  });
});

test('every delivery is logged with the recipient masked', async () => {
  await withEnv({ NODE_ENV: 'development' }, async () => {
    const { deliverMessage, listDeliveryLog } = require('../src/services/otp-delivery-service');
    await deliverMessage({
      type: 'wallet-recovery',
      email: 'holder@example.com',
      variables: { code: '333333', walletId: 'AEG-LOG' }
    });

    const log = await listDeliveryLog();
    assert.equal(log.length, 1);
    assert.equal(log[0].type, 'wallet-recovery');
    assert.equal(log[0].delivered, true);
    assert.equal(log[0].recipient, 'ho***@example.com');
    // The log is for admins to read: it must not carry the code itself.
    assert.equal(JSON.stringify(log[0]).includes('333333'), false);
  });
});

test('hosted environments start fail-closed until an admin configures a channel', async () => {
  await withEnv({ NODE_ENV: 'production' }, async () => {
    const { getNotificationSettings } = require('../src/services/notification-settings-service');
    const settings = await getNotificationSettings();
    // dev, qa and prod all run NODE_ENV=production, so none of them may quietly
    // fall back to writing codes to disk.
    assert.equal(settings.email.enabled, false);
    assert.notEqual(settings.email.preset, 'filesystem');
  });
});

test('SMTP env config turns email on in a hosted environment, over a store that has it off', async () => {
  await withEnv({
    NODE_ENV: 'production',
    APP_ENV: 'prod',
    SMTP_HOST: 'smtp.office365.com',
    SMTP_FROM_ADDRESS: 'no-reply@vanguardcs.ca',
    SMTP_USERNAME: 'mailer@vanguardcs.ca',
    SMTP_PASSWORD: 'app-password'
  }, async ({ dir }) => {
    const fs = require('node:fs/promises');
    // A hosted store that never configured email — email off, so nothing sends.
    await fs.writeFile(path.join(dir, 'notify.json'), JSON.stringify({
      email: { enabled: false, preset: 'microsoft-exchange', host: '', fromAddress: '' }
    }));

    const settingsService = require('../src/services/notification-settings-service');
    const settings = await settingsService.getNotificationSettings();
    assert.equal(settings.email.enabled, true, 'env transport turns email on');
    assert.equal(settings.email.host, 'smtp.office365.com');
    assert.equal(settings.email.fromAddress, 'no-reply@vanguardcs.ca');
    assert.equal(settings.email.managedByEnv, true);
    // The matrix still governs which types may use email; mfa-otp does by default.
    assert.equal(settingsService.channelAllowed(settings, 'mfa-otp', 'email'), true);

    // The masked display carries the flag but never the password.
    const display = await settingsService.getNotificationSettingsForDisplay();
    assert.equal(display.email.managedByEnv, true);
    assert.equal(display.email.password, '');
    assert.equal(display.email.hasPassword, true);
  });
});

test('without SMTP env, a hosted environment stays runtime-configured', async () => {
  await withEnv({ NODE_ENV: 'production', APP_ENV: 'prod' }, async () => {
    const settingsService = require('../src/services/notification-settings-service');
    const settings = await settingsService.getNotificationSettings();
    // Fail-closed default: email preset present but no host/from, so nothing
    // sends until an admin configures it — unchanged behaviour.
    assert.notEqual(settings.email.managedByEnv, true);
    assert.equal(settings.email.fromAddress, '');
  });
});

// --- Microsoft Graph, app-only -------------------------------------------
//
// The sender is an unlicensed shared mailbox, and Exchange Online refuses SMTP
// AUTH for one whatever the password is. Graph is how it sends: no licence, no
// password, and the application fenced to one mailbox by an
// ApplicationAccessPolicy rather than by trusting it to address its mail
// correctly.

const GRAPH_ENV = {
  GRAPH_MAIL_TENANT_ID: 'tenant-1234',
  GRAPH_MAIL_CLIENT_ID: 'client-5678',
  GRAPH_MAIL_CLIENT_SECRET: 'secret-value-never-rendered',
  GRAPH_MAIL_FROM_ADDRESS: 'no-reply-aegis-id@example.test'
};

test('Graph beats SMTP when both are configured', async () => {
  // The two can both be set during a migration. The one that needs no licence,
  // no password and is not being retired is the one that should win.
  await withEnv(
    {
      ...GRAPH_ENV,
      SMTP_HOST: 'smtp.office365.com',
      SMTP_FROM_ADDRESS: 'someone-else@example.test'
    },
    async () => {
      const { getNotificationSettings } = require('../src/services/notification-settings-service');
      const settings = await getNotificationSettings();

      assert.equal(settings.email.preset, 'microsoft-graph');
      assert.equal(settings.email.enabled, true);
      assert.equal(settings.email.managedByEnv, true);
      assert.equal(settings.email.fromAddress, GRAPH_ENV.GRAPH_MAIL_FROM_ADDRESS);
      assert.equal(settings.email.clientSecret, GRAPH_ENV.GRAPH_MAIL_CLIENT_SECRET);
    }
  );
});

test('a half-configured Graph transport is not used at all', async () => {
  // Three of the four values is not a transport, it is a 401 on every message.
  // Falling through to the stored settings is right; pretending to be
  // configured is not.
  await withEnv(
    { GRAPH_MAIL_TENANT_ID: 'tenant-1234', GRAPH_MAIL_CLIENT_ID: 'client-5678' },
    async () => {
      const { getNotificationSettings } = require('../src/services/notification-settings-service');
      const settings = await getNotificationSettings();
      assert.notEqual(settings.email.preset, 'microsoft-graph');
      assert.notEqual(settings.email.managedByEnv, true);
    }
  );
});

test('the from-address falls back to the one SMTP already names', async () => {
  await withEnv(
    {
      GRAPH_MAIL_TENANT_ID: 'tenant-1234',
      GRAPH_MAIL_CLIENT_ID: 'client-5678',
      GRAPH_MAIL_CLIENT_SECRET: 'secret-value-never-rendered',
      SMTP_FROM_ADDRESS: 'no-reply-aegis-id@example.test'
    },
    async () => {
      const { getNotificationSettings } = require('../src/services/notification-settings-service');
      const settings = await getNotificationSettings();
      assert.equal(settings.email.preset, 'microsoft-graph');
      assert.equal(settings.email.fromAddress, 'no-reply-aegis-id@example.test');
    }
  );
});

test('the client secret never reaches the browser', async () => {
  // getNotificationSettingsForDisplay is the one function that promises not to
  // leak a stored secret. The Graph client secret is as good as the SMTP
  // password and has to be covered by the same promise.
  await withEnv(GRAPH_ENV, async () => {
    const {
      getNotificationSettingsForDisplay
    } = require('../src/services/notification-settings-service');
    const view = await getNotificationSettingsForDisplay();

    assert.equal(view.email.clientSecret, '');
    assert.equal(view.email.hasClientSecret, true);
    assert.equal(view.email.isGraph, true);
    assert.ok(
      !JSON.stringify(view).includes(GRAPH_ENV.GRAPH_MAIL_CLIENT_SECRET),
      'the client secret is somewhere in the view model'
    );
  });
});

test('Graph sends raw MIME, as the application, and asks for one token', async () => {
  // Posted as MIME rather than as a Graph message resource, because a message
  // resource carries one body and ours carry two — the plain text part is what
  // a text-only client and most spam filters read.
  await withEnv(GRAPH_ENV, async () => {
    const { sendEmail } = require('../src/adapters/notify/notification-adapter');
    const { getNotificationSettings } = require('../src/services/notification-settings-service');
    const settings = await getNotificationSettings();

    const calls = [];
    const realFetch = global.fetch;
    global.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('login.microsoftonline.com')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'token-abc', expires_in: 3600 })
        };
      }
      return { ok: true, text: async () => '' };
    };

    try {
      const first = await sendEmail(settings, {
        to: 'holder@example.test',
        subject: 'Your Aegis ID sign-in code',
        text: 'Plain text part',
        html: '<p>HTML part</p>'
      });
      assert.equal(first.delivered, true);
      // Masked, as every delivery result is.
      assert.equal(first.to, 'ho***@example.test');

      await sendEmail(settings, {
        to: 'holder@example.test',
        subject: 'Again',
        text: 'Plain text part',
        html: '<p>HTML part</p>'
      });
    } finally {
      global.fetch = realFetch;
    }

    const tokenCalls = calls.filter((call) => call.url.includes('login.microsoftonline.com'));
    const sendCalls = calls.filter((call) => call.url.includes('graph.microsoft.com'));

    // One token for two messages. A token per message would make a sign-in
    // code wait on a second round trip to a second service.
    assert.equal(tokenCalls.length, 1);
    assert.equal(sendCalls.length, 2);

    // Client credentials, not a user flow.
    assert.match(String(tokenCalls[0].options.body), /grant_type=client_credentials/);
    assert.match(String(tokenCalls[0].options.body), /scope=https%3A%2F%2Fgraph.microsoft.com%2F.default/);

    // Sent as the configured mailbox, with the token, as MIME.
    assert.equal(
      sendCalls[0].url,
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(GRAPH_ENV.GRAPH_MAIL_FROM_ADDRESS)}/sendMail`
    );
    assert.equal(sendCalls[0].options.headers.Authorization, 'Bearer token-abc');
    assert.equal(sendCalls[0].options.headers['Content-Type'], 'text/plain');

    const mime = Buffer.from(String(sendCalls[0].options.body), 'base64').toString('utf8');
    assert.match(mime, /multipart\/alternative/);
    assert.match(mime, /text\/plain/);
    assert.match(mime, /text\/html/);
    assert.match(mime, new RegExp(GRAPH_ENV.GRAPH_MAIL_FROM_ADDRESS));
  });
});

test('Graph failures say what went wrong without quoting the secret', async () => {
  await withEnv(GRAPH_ENV, async () => {
    const { sendEmail } = require('../src/adapters/notify/notification-adapter');
    const { getNotificationSettings } = require('../src/services/notification-settings-service');
    const settings = await getNotificationSettings();

    const realFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: 'invalid_client',
        error_description: 'AADSTS7000215: Invalid client secret provided.'
      })
    });

    try {
      await assert.rejects(
        () =>
          sendEmail(settings, {
            to: 'holder@example.test',
            subject: 's',
            text: 't',
            html: '<p>h</p>'
          }),
        (error) => {
          assert.match(error.message, /AADSTS7000215/);
          assert.ok(
            !error.message.includes(GRAPH_ENV.GRAPH_MAIL_CLIENT_SECRET),
            'the secret is in the error message'
          );
          return true;
        }
      );
    } finally {
      global.fetch = realFetch;
    }
  });
});
