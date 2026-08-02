const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

// Guards a footgun that costs a whole page rather than a field.
//
// Express puts its own app settings in app.locals.settings, and hbs reads
// settings.views to resolve the layout. A render local literally named
// `settings` shadows it, so hbs calls path.join(undefined, 'layout') and every
// request to that page 500s — with a stack pointing into node_modules, nowhere
// near the route that caused it.
//
// This is not theoretical: /admin/notifications shipped with exactly that and
// could never render.

const ROUTES_DIR = path.resolve(__dirname, '..', 'src', 'routes');

const RESERVED_LOCALS = [
  // Shadows app.locals.settings, which hbs needs for the layout path.
  'settings',
  // Express reserves these on the render options object.
  'cache',
  '_locals'
];

function routeFiles() {
  return fs
    .readdirSync(ROUTES_DIR)
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name, source: fs.readFileSync(path.join(ROUTES_DIR, name), 'utf8') }));
}

test('express really does expose app settings as a local named settings', () => {
  // If this ever stops being true the rule below can be relaxed — but until
  // then, the collision is real.
  const app = express();
  assert.equal(typeof app.locals.settings, 'object');
  assert.ok('views' in app.locals.settings);
});

test('no route passes a render local that shadows an express one', () => {
  const offenders = [];

  for (const { name, source } of routeFiles()) {
    const lines = source.split('\n');
    lines.forEach((line, index) => {
      for (const reserved of RESERVED_LOCALS) {
        // A render local, i.e. `settings: value` as an object property.
        if (new RegExp(`^\\s+${reserved}:\\s`).test(line)) {
          offenders.push(`${name}:${index + 1} passes a local named "${reserved}"`);
        }
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `These shadow an Express render local and will 500 the whole page:\n${offenders.join('\n')}`
  );
});

test('every rendered view exists on disk', () => {
  // A typo'd view name is another whole-page failure that only shows at
  // request time.
  const viewsDir = path.resolve(__dirname, '..', 'views');
  const missing = [];

  for (const { name, source } of routeFiles()) {
    for (const match of source.matchAll(/res\.render\(\s*'([^']+)'/g)) {
      const view = match[1];
      if (!fs.existsSync(path.join(viewsDir, `${view}.hbs`))) {
        missing.push(`${name} renders '${view}', but views/${view}.hbs does not exist`);
      }
    }
  }

  assert.deepEqual(missing, [], missing.join('\n'));
});
