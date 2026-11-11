const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The two-view record table.
//
// Thirty tables are rendered by six different services, so the component
// upgrades the table that is already in the page rather than asking thirty
// templates to change. That choice is what these tests protect: the selector
// it upgrades by, the script being loaded everywhere, and the three
// behaviours that made it worth building.
//
// What a test cannot check is the part that actually matters — whether the
// actions column ends up first on a real page — because that needs a rendered
// table. That was verified signed in; this guards the contract around it.

const ROOT = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const SCRIPT = read('public/scripts/data-table.js');

test('every record table class is upgraded', () => {
  // The four classes the product renders record tables with. A fifth added
  // later is covered by adding it here and to the selector, which is the
  // whole point of upgrading by class.
  for (const selector of ['table.data-table', 'table.people-table', 'table.aeg-table', 'table.workspace-table']) {
    assert.ok(SCRIPT.includes(selector), `${selector} is not upgraded`);
  }
});

test('the script is loaded on every page, not per route', () => {
  const layout = read('views/layouts/main.hbs');
  assert.match(layout, /scripts\/data-table\.js/);

  // Before main.js, so a table is upgraded before anything else reads the
  // page, and with the asset version so a deploy is not served the old one.
  assert.match(layout, /data-table\.js\?v=\{\{assetVersion\}\}/);
});

test('actions are found by what the product puts them in', () => {
  // `.row-actions` is the wrapper, and it is the only reliable signal.
  // Matching any button or form instead claimed the credentials table's
  // "QR / link" column — which holds a button and is not the actions — and
  // missed the people directory, whose first row is the administrator's own
  // profile and has a different shape from every other row.
  assert.match(SCRIPT, /tests = \['\.row-actions', '\.icon-button'\]/);
  assert.ok(
    SCRIPT.indexOf('moveColumnFirst') < SCRIPT.indexOf('buildCards'),
    'the column has to move before the cards are built from it'
  );
});

test('a row cannot be left with nothing to identify or act on it', () => {
  // The actions column and the first real column are always offered; hiding
  // either leaves a row that cannot be recognised or used.
  assert.match(SCRIPT, /column\.index !== actionsIndex/);
});

test('ids are stripped from the cards', () => {
  // Cards are cloned from the rows, so every id in a cell would exist twice —
  // which breaks every label and every modal target that uses one.
  assert.match(SCRIPT, /removeAttribute\('id'\)/);
});

test('a table inside another table is left alone', () => {
  // The connected-app sub-tables are part of their parent row, not record
  // lists of their own.
  assert.match(SCRIPT, /parentElement\.closest\('table'\)/);
});

test('the preference is per table and survives storage being refused', () => {
  assert.match(SCRIPT, /localStorage/);
  // Private windows and blocked site data both throw on access, and a table
  // that throws is a page that does not render.
  const reads = SCRIPT.split('localStorage').length - 1;
  const guards = SCRIPT.split('catch').length - 1;
  assert.ok(guards >= 2, `${reads} storage calls and only ${guards} catch blocks`);
});

test('the component has styles for both views', () => {
  const css = read('public/styles/main.css');
  for (const rule of ['.dt-cards', '.dt-card', '.dt-views', '.dt-columns__menu', '.dt--cards', '.dt--table']) {
    assert.ok(css.includes(rule), `${rule} has no styling`);
  }

  // Wrapping five buttons into five rows made every row five rows tall.
  assert.match(css, /\.dt-table td:first-child \.row-actions \{[^}]*flex-wrap: nowrap/s);
});

test('the column menu is closed until it is opened', () => {
  const css = read('public/styles/main.css');

  // `.dt-columns__menu { display: grid }` outranks the user agent's
  // `[hidden] { display: none }` — author styles always do — so the menu was
  // open from the moment it was built and setting .hidden did nothing. It was
  // stuck on screen over the table beneath it.
  assert.match(css, /\.dt-columns__menu\[hidden\]\s*\{\s*display:\s*none/s);

  // And it closes the two ways a menu should.
  assert.match(SCRIPT, /menu\.hidden = true/);
  assert.match(SCRIPT, /event\.key === 'Escape'/);
  assert.match(SCRIPT, /!menuWrap\.contains\(event\.target\)/);
});
