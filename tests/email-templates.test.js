const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  parseAcceptLanguage,
  resolveLocale,
  localeForUser,
  normalizeLocale
} = require('../src/services/i18n-service');
const { buildMessage, messageTypes, CATALOGUES } = require('../src/emails');
const { PALETTE } = require('../src/emails/render');
const { MESSAGE_TYPES } = require('../src/services/notification-settings-service');

// Adherence tests for the outbound message catalogues.
//
// The failure mode these guard against is not an exception — it is a message
// that sends perfectly well and is wrong: half-translated, missing its text
// part, carrying a code in the subject line, or styled with CSS that the
// recipient's mail client throws away. None of that shows up in a route test,
// and none of it is visible until somebody receives one.

const ROOT = path.join(__dirname, '..');
const BRAND = fs.readFileSync(path.join(ROOT, 'public/styles/brand-layer.css'), 'utf8');

/** Plausible values for every variable any message asks for. */
const VARIABLES = {
  code: '482913',
  walletId: 'AEG-4K7P-2M9X-T3BW',
  resetUrl: 'https://example.test/auth/reset?token=abc',
  verifyUrl: 'https://example.test/auth/verify?token=abc',
  reenrolUrl: 'https://example.test/auth/reenrol?token=abc',
  approvalUrl: 'https://example.test/auth/recover/approve/abc',
  statusUrl: 'https://example.test/auth/recover/approvals/abc',
  expiresInMinutes: 30,
  expiresInHours: 72,
  displayName: 'Marie Tremblay',
  organizationName: 'Cloudstrucc',
  requesterEmail: 'f.pearson@cloudstrucc.com',
  approvalsRequired: 2
};

const build = (type, locale, extra = {}) => buildMessage({
  type,
  locale,
  variables: { ...VARIABLES, ...extra },
  brand: 'Aegis ID',
  baseUrl: 'https://aegis.example.test',
  organizationName: 'Cloudstrucc',
  supportEmail: 'help@example.test'
});

test('both locales carry exactly the same keys', () => {
  const [first, ...rest] = SUPPORTED_LOCALES;
  const reference = {
    messages: Object.keys(CATALOGUES[first].messages).sort(),
    common: Object.keys(CATALOGUES[first].common).sort()
  };
  for (const locale of rest) {
    assert.deepEqual(
      Object.keys(CATALOGUES[locale].messages).sort(), reference.messages,
      `${locale} does not define the same messages as ${first}`
    );
    assert.deepEqual(
      Object.keys(CATALOGUES[locale].common).sort(), reference.common,
      `${locale} does not define the same shared strings as ${first}`
    );
  }
});

test('every message renders in every locale with all four parts', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const type of messageTypes()) {
      const message = build(type, locale);
      for (const part of ['subject', 'preview', 'html', 'text', 'sms']) {
        assert.ok(
          String(message[part] || '').trim().length > 0,
          `${locale}/${type} produced an empty ${part}`
        );
      }
      assert.equal(message.locale, locale);
      // "undefined" in a rendered message means a variable name was changed
      // on one side of the catalogue and not the other.
      assert.ok(!message.text.includes('undefined'), `${locale}/${type} text has an unresolved variable`);
      assert.ok(!message.subject.includes('undefined'), `${locale}/${type} subject has an unresolved variable`);
    }
  }
});

test('the two locales actually differ', () => {
  // A catalogue copied and not translated passes every other test here.
  for (const type of messageTypes()) {
    const en = build(type, 'en-CA');
    const fr = build(type, 'fr-CA');
    assert.notEqual(en.text, fr.text, `${type} is identical in both locales`);
    assert.notEqual(en.subject, fr.subject, `${type} has the same subject in both locales`);
  }
});

test('no subject or preview carries the code or the link', () => {
  // A code in the subject shows on a locked screen, and a link in a preview
  // is a one-tap takeover from a notification. Both are conveniences this
  // product should not be offering.
  const secrets = [VARIABLES.code, VARIABLES.resetUrl, VARIABLES.verifyUrl,
    VARIABLES.reenrolUrl, VARIABLES.approvalUrl, VARIABLES.statusUrl];
  for (const locale of SUPPORTED_LOCALES) {
    for (const type of messageTypes()) {
      const { subject, preview } = build(type, locale);
      for (const secret of secrets) {
        assert.ok(!subject.includes(secret), `${locale}/${type}: the subject carries ${secret}`);
        assert.ok(!preview.includes(secret), `${locale}/${type}: the preview carries ${secret}`);
      }
    }
  }
});

test('a code or link appears in the body that carries it', () => {
  // The mirror of the test above: having removed them from the subject, the
  // body is the only place left, so it had better be there.
  const expected = {
    'mfa-otp': VARIABLES.code,
    'wallet-recovery': VARIABLES.code,
    'password-reset': VARIABLES.resetUrl,
    'email-verification': VARIABLES.verifyUrl,
    'account-reenrolment': VARIABLES.reenrolUrl,
    'approver-recovery': VARIABLES.approvalUrl,
    'approver-recovery-status': VARIABLES.statusUrl
  };
  for (const locale of SUPPORTED_LOCALES) {
    for (const [type, value] of Object.entries(expected)) {
      const { text, html } = build(type, locale);
      assert.ok(text.includes(value), `${locale}/${type}: the text part is missing ${value}`);
      assert.ok(html.includes(value), `${locale}/${type}: the HTML part is missing ${value}`);
    }
  }
});

test('values are escaped into the HTML', () => {
  // Display names and organization names are free text typed by people.
  const message = build('email-verification', 'en-CA', {
    displayName: '<script>alert(1)</script>'
  });
  assert.ok(!message.html.includes('<script>'), 'a display name reached the HTML unescaped');
  assert.ok(message.html.includes('&lt;script&gt;'), 'the display name was dropped rather than escaped');
});

test('the catalogue and the delivery matrix describe the same messages', () => {
  // /admin/notifications decides per message type which channels may carry
  // it. A type in one list and not the other is either an unreachable
  // setting or a message that cannot be switched off.
  assert.deepEqual(
    messageTypes().sort(),
    Object.keys(MESSAGE_TYPES).sort(),
    'the catalogue and the notification matrix disagree about which messages exist'
  );
});

test('the email palette is still in step with the brand layer', () => {
  // Mail cannot use custom properties, so these values are a copy. A copy
  // with nothing holding it in place is a copy that goes stale.
  const root = BRAND.replace(/\/\*[\s\S]*?\*\//g, '');
  const block = root.slice(root.indexOf(':root {'), root.indexOf('}', root.indexOf(':root {')));
  const tokenOf = (name) => block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();

  const pairs = [
    ['brand', 'ag-brand'], ['brandOn', 'ag-brand-on'], ['brandSoft', 'ag-brand-soft'],
    ['brandLine', 'ag-brand-line'], ['text', 'ag-text'], ['muted', 'ag-muted'],
    ['subtle', 'ag-subtle'], ['line', 'ag-line'], ['surface', 'ag-surface'],
    ['bg', 'ag-bg'], ['warn', 'ag-warn'], ['warnSoft', 'ag-warn-soft'], ['warnLine', 'ag-warn-line']
  ];
  for (const [key, token] of pairs) {
    const value = tokenOf(token);
    assert.ok(value, `brand-layer.css no longer defines --${token}`);
    assert.equal(
      PALETTE[key].toLowerCase(), value.toLowerCase(),
      `the email palette's ${key} has drifted from --${token}`
    );
  }
});

test('the HTML uses nothing a mail client will throw away', () => {
  const { html } = build('password-reset', 'en-CA');
  assert.ok(!html.includes('var(--'), 'a custom property in mail resolves to nothing');
  assert.ok(!/<link\b/i.test(html), 'an external stylesheet will not load in mail');
  assert.ok(!/\sclass=/.test(html), 'class selectors need a <style> block many clients strip');
  assert.ok(!/<style\b/i.test(html), 'Gmail strips <style> in forwarded mail; styles are inline');
  assert.ok(html.includes('<!doctype html>'), 'a mail body without a doctype renders in quirks mode');
  assert.ok(/<img[^>]+alt=/.test(html), 'the lockup needs alt text — images are blocked by default');
});

test('the lockup is absolute and served from the sending deployment', () => {
  const { html } = buildMessage({
    type: 'mfa-otp', locale: 'en-CA', variables: VARIABLES,
    brand: 'Aegis ID', baseUrl: 'https://contoso.example.test/'
  });
  assert.ok(
    html.includes('https://contoso.example.test/images/brand/aegis-lockup-colour.png'),
    'a relative image path resolves against the mail client, not against us'
  );
});

test('the footer names the organization only when there is one', () => {
  const platform = buildMessage({
    type: 'mfa-otp', locale: 'en-CA', variables: VARIABLES, brand: 'Aegis ID', baseUrl: ''
  });
  assert.ok(!platform.text.includes('on behalf of'), 'a platform message claimed to be on somebody else behalf');

  const tenant = build('mfa-otp', 'en-CA');
  assert.ok(tenant.text.includes('Cloudstrucc'), 'a message sent for an organization does not name it');

  // The case that actually shipped: a caller with no organization branding
  // gets the platform defaults back, whose display name is the brand, and
  // the footer read "Sent by Aegis ID on behalf of Aegis ID."
  const sameName = buildMessage({
    type: 'mfa-otp', locale: 'en-CA', variables: VARIABLES,
    brand: 'Aegis ID', baseUrl: '', organizationName: 'Aegis ID'
  });
  assert.ok(!sameName.text.includes('on behalf of'), 'the brand was named as its own sender');
});

test('an unknown message type is refused rather than sent empty', () => {
  assert.throws(() => build('no-such-message', 'en-CA'), /Unknown message type/);
});

test('locale negotiation prefers the account, then the browser, then en-CA', () => {
  assert.equal(resolveLocale('fr-CA'), 'fr-CA');
  assert.equal(resolveLocale('fr'), 'fr-CA', 'a bare language tag should match');
  assert.equal(resolveLocale('fr-FR'), 'fr-CA', 'another region of the same language should match');
  assert.equal(resolveLocale('de'), DEFAULT_LOCALE, 'an unsupported language falls back');
  assert.equal(resolveLocale(null, undefined, ''), DEFAULT_LOCALE);

  // q-values decide, not document order.
  assert.deepEqual(parseAcceptLanguage('en;q=0.5,fr-CA,de;q=0.8'), ['fr-CA', 'de', 'en']);
  assert.equal(resolveLocale(parseAcceptLanguage('en;q=0.5,fr-CA')), 'fr-CA');

  // The stored preference beats the browser, because it is the only one that
  // is still true when a background job sends the message an hour later.
  const req = { get: () => 'en-CA' };
  assert.equal(localeForUser({ locale: 'fr-CA' }, req), 'fr-CA');
  assert.equal(localeForUser({}, req), 'en-CA');
  assert.equal(localeForUser(null, null), DEFAULT_LOCALE);
});

test('an unsupported stored locale is cleared, not kept', () => {
  assert.equal(normalizeLocale('de-DE'), '');
  assert.equal(normalizeLocale('fr'), 'fr-CA');
  assert.equal(normalizeLocale(''), '');
});
