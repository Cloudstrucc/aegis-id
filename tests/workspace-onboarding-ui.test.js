const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The wallet setup page, and two rules that reached further than they meant to.
//
// Both were invisible in the file and obvious on the page: a header clearance
// written for pages that sit under the fixed site header applied inside the
// application shell too, and a QR-code sizing rule written as `img` also
// caught the App Store badge in the same card. Neither broke anything that
// would fail a test elsewhere — the page rendered, it just rendered wrong.

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('the fixed-header clearance stops at the application shell', () => {
  const css = read('public/styles/main.css');

  // Inside the shell, <main> is .app-shell__main: it sits below the shell's
  // own topbar and breadcrumb, and `.app-shell .band { padding: 0 }` already
  // says the bands carry none of their own. Unscoped, this rule outranked that
  // and opened every shell page with 152px of nothing.
  assert.ok(
    css.includes('main:not(.app-shell__main) > .band:first-child:not(.band--page-top)'),
    'the clearance rule is not scoped away from the application shell'
  );
  assert.doesNotMatch(
    css,
    /^main > \.band:first-child:not\(\.band--page-top\)/m,
    'an unscoped copy of the clearance rule is back'
  );
});

test('the onboarding QR sizing does not apply to the store badges', () => {
  const css = read('public/styles/main.css');

  // `width: 100%; height: auto` is right for a QR code and wrong for a store
  // badge, which is drawn at a fixed height beside another badge.
  assert.ok(
    css.includes('.demo-qr-card--onboarding .demo-qr-card__image'),
    'the QR rule no longer targets the QR code by its own class'
  );
  assert.doesNotMatch(
    css,
    /^\.demo-qr-card--onboarding img,$/m,
    'the QR rule is matching every image in the card again'
  );
});

test('wallet setup checks for itself instead of asking to be refreshed', () => {
  const template = read('views/pages/workspace-onboarding.hbs');
  const route = read('src/routes/dashboard.js');
  const script = read('public/scripts/workspace-onboarding.js');

  // The control, which works with the script blocked because it is a link to
  // this page and this page decides where to send the reader.
  assert.ok(template.includes('data-onboarding-check="{{onboardingPath}}"'));
  assert.match(template, /Check now<\/a>/);

  // And the page must no longer tell them to do it by hand.
  assert.ok(
    !/Refresh after acceptance/i.test(template),
    'the page still asks the reader to refresh it themselves'
  );

  assert.ok(route.includes("src: '/scripts/workspace-onboarding.js'"), 'the script is not loaded');
  // The check is the request itself: this route redirects to the dashboard as
  // soon as a wallet has accepted, so a followed redirect is the answer.
  assert.ok(script.includes('response.redirected'));
});

test('upgrade-insecure-requests is dropped only outside production', () => {
  const source = read('src/app.js');

  // Hosted environments are https and keep the directive. On a plaintext
  // localhost origin it rewrites every same-origin fetch to https, where
  // nothing is listening — which is how the check above failed with
  // ERR_SSL_PROTOCOL_ERROR while links on the same page kept working.
  assert.match(
    source,
    /config\.app\.env === 'production' \? \{\} : \{ upgradeInsecureRequests: null \}/,
    'the directive is no longer conditional on the environment'
  );
});
