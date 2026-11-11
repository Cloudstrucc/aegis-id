const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// An empty state that asks for something must offer the control that does it.
//
// Three of these shipped as dead ends. The wallet register said a wallet
// appears once somebody accepts an invitation and did not link to issuance.
// The adapters page said "pick a protocol below" with nothing to press and the
// catalogue a screen further down. The connected-apps table named the "Create
// registration" button in prose while the button itself was at the top of a
// long blade. In each case the reader was told an action existed and left to
// find it.
//
// What a test cannot check is whether the wording is useful. What it can check
// is that the control is still there, which is the part that gets lost when
// somebody rewrites the copy.

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

/**
 * Every empty state that implies creating or configuring something, and the
 * control it has to carry. A new one belongs here at the same time it is
 * written — that is the whole point of the list.
 */
const EMPTY_STATES = [
  {
    what: 'the organization-scoped and platform-wide wallet registers',
    view: 'views/pages/wallet-admin.hbs',
    heading: 'No wallets to show',
    // Supplied by the route, because where you issue a credential differs
    // between the two scopes this page serves.
    control: /\{\{#if emptyAction\}\}[\s\S]{0,200}href="\{\{emptyAction\.href\}\}"/
  },
  {
    what: 'the authentication adapters list',
    view: 'views/pages/auth-adapters.hbs',
    heading: 'No adapters configured yet',
    control: /href="#add-an-adapter"/,
    // An in-page anchor is only a control if the target exists.
    target: /id="add-an-adapter"/
  },
  {
    what: 'the organization workspace list',
    view: 'views/pages/organizations.hbs',
    heading: 'Register your organization to continue.',
    control: /href="#add-an-organization"/,
    target: /id="add-an-organization"/
  },
  {
    what: 'the connected-app registrations table',
    view: 'views/pages/dashboard.hbs',
    heading: 'No connected-app registrations yet',
    // The same modal target the button at the top of the blade carries.
    control: /data-modal-target="#modal-connected-app-create"/
  }
];

for (const state of EMPTY_STATES) {
  test(`${state.what} offers a way out of its empty state`, () => {
    const view = read(state.view);

    assert.ok(
      view.includes(state.heading),
      `${state.view} no longer contains the empty state "${state.heading}" — ` +
        'if it was renamed, rename it here; if it was removed, remove this case'
    );

    assert.match(
      view,
      state.control,
      `the "${state.heading}" empty state has no control. It tells the reader ` +
        'an action exists; it has to offer it.'
    );

    if (state.target) {
      assert.match(
        view,
        state.target,
        `the "${state.heading}" empty state anchors at a target that does not ` +
          'exist on the page, so the control goes nowhere'
      );
    }
  });
}

test('an anchored control points at a target on its own page', () => {
  // An in-page anchor that misses is worse than no anchor: the page does not
  // move and nothing says why. Checked across every view, not just the ones
  // listed above, so a new anchor is covered the day it is written.
  const viewsDir = path.join(ROOT, 'views', 'pages');
  const failures = [];

  for (const fileName of fs.readdirSync(viewsDir).filter((name) => name.endsWith('.hbs'))) {
    const view = fs.readFileSync(path.join(viewsDir, fileName), 'utf8');
    const anchors = [...view.matchAll(/href="#([a-z0-9][a-z0-9-]*)"/gi)].map((match) => match[1]);

    for (const anchor of new Set(anchors)) {
      // Handlebars-built ids and the blade router's own hash navigation are
      // resolved at runtime, not in the template.
      if (view.includes(`data-blade-link`) && view.includes(`href="#${anchor}"`)
          && !view.includes(`id="${anchor}"`)
          && new RegExp(`data-blade="${anchor}"`).test(view)) {
        continue;
      }
      if (new RegExp(`id="${anchor}"`).test(view)) {
        continue;
      }
      if (new RegExp(`data-blade="${anchor}"`).test(view)) {
        continue;
      }
      failures.push(`${fileName}: href="#${anchor}" has no id or blade of that name`);
    }
  }

  assert.deepEqual(failures, [], failures.join('\n'));
});
