const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Adherence tests for the brand layer.
//
// These exist because of a bug that no other test in the suite could see: a
// "*/" inside a comment in brand-layer.css closed it early, the opening :root
// block was swallowed, every var(--ag-*) resolved to nothing, and the whole
// application silently fell back to Times on a transparent background. The
// server returned 200, every route test passed, and the page was unusable.
//
// So the rules here are about the stylesheet actually working, not about
// taste: tokens must parse, must exist in both themes, must not be declared
// only inside a media query, and the contrast pairs the design depends on
// must hold.

const ROOT = path.join(__dirname, '..');
const BRAND = fs.readFileSync(path.join(ROOT, 'public/styles/brand-layer.css'), 'utf8');
const MAIN = fs.readFileSync(path.join(ROOT, 'public/styles/main.css'), 'utf8');
const LAYOUT = fs.readFileSync(path.join(ROOT, 'views/layouts/main.hbs'), 'utf8');

/** CSS with comments removed, the way a parser sees it. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of one top-level block, by its exact selector. */
function blockFor(css, selector) {
  const source = stripComments(css);
  const start = source.indexOf(selector + ' {');
  if (start === -1) return null;
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(source.indexOf('{', start) + 1, i);
    }
  }
  return null;
}

const tokensIn = (block) => {
  const found = new Map();
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    found.set(match[1], match[2].trim());
  }
  return found;
};

/* --- relative luminance and contrast, for the pairs the design relies on --- */
const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('the brand layer parses: the opening :root block survives comment stripping', () => {
  // The bug this file was written for. A "*/" inside a comment silently eats
  // whatever follows, and the only visible symptom is the whole app falling
  // back to browser defaults.
  const root = blockFor(BRAND, ':root');
  assert.ok(root, 'brand-layer.css must have a top-level :root block the parser can reach');
  assert.ok(tokensIn(root).size > 30, 'the :root block must still carry its tokens');

  // Nothing outside a comment may contain the sequence that ends one.
  const withoutComments = stripComments(BRAND);
  assert.ok(!withoutComments.includes('*/'), 'a stray */ means a comment closed early');
});

test('every --ag- token a rule reads is defined on bare :root', () => {
  const root = tokensIn(blockFor(BRAND, ':root'));
  const used = new Set([...BRAND.matchAll(/var\((--ag-[a-z0-9-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((token) => !root.has(token));
  assert.deepEqual(missing, [], `tokens read but never defined on :root: ${missing.join(', ')}`);
});

test('no colour token is defined only inside a media query or [data-theme]', () => {
  // A token that exists only in a dark block is empty for every viewer whose
  // browser is in light mode, and the rule that reads it computes to its
  // initial value — the classic unreadable-page bug.
  const root = tokensIn(blockFor(BRAND, ':root'));
  const darkBlock = blockFor(BRAND, ':root[data-theme="dark"]');
  assert.ok(darkBlock, 'there must be an explicit dark block for the toggle');
  const darkOnly = [...tokensIn(darkBlock).keys()].filter((token) => !root.has(token));
  assert.deepEqual(darkOnly, [], `defined only in dark: ${darkOnly.join(', ')}`);
});

test('dark mode redefines every colour the light palette defines', () => {
  const root = tokensIn(blockFor(BRAND, ':root'));
  const dark = tokensIn(blockFor(BRAND, ':root[data-theme="dark"]'));
  const colours = [...root.entries()]
    .filter(([, value]) => /^#|^rgba?\(/.test(value))
    .map(([token]) => token);
  const unthemed = colours.filter((token) => !dark.has(token));
  assert.deepEqual(unthemed, [], `light-only colours, so they stay light in dark mode: ${unthemed.join(', ')}`);
});

test('the toggle and the OS preference reach the same dark palette', () => {
  // Two blocks hold the dark values: one under prefers-color-scheme for
  // viewers who never touched the switch, one under [data-theme="dark"] for
  // those who did. They have to agree, or the switch changes the design.
  const explicit = tokensIn(blockFor(BRAND, ':root[data-theme="dark"]'));
  const media = tokensIn(blockFor(BRAND, ':root:not([data-theme="light"])'));
  assert.ok(media.size > 0, 'there must be a prefers-color-scheme dark block');
  const disagree = [...explicit.entries()]
    .filter(([token, value]) => media.has(token) && media.get(token) !== value)
    .map(([token]) => token);
  assert.deepEqual(disagree, [], `the two dark blocks disagree on: ${disagree.join(', ')}`);
});

test('every legacy COLOUR token is aliased, so the old stylesheet is themed', () => {
  // 10,000 lines of main.css read these names. A colour left unaliased keeps
  // its original hard-coded value and stays light in dark mode — which is how
  // the --aeg-ok / --aeg-warn / --aeg-bad status pills were caught.
  //
  // Only colours. main.css also owns the spacing, type-scale, weight and
  // radius tokens, and those are not the brand layer's business.
  const alias = tokensIn(
    blockFor(BRAND, ':root,\n:root[data-theme="dark"]') || blockFor(BRAND, ':root, :root[data-theme="dark"]')
  );
  assert.ok(alias, 'the alias block must exist');

  const isColour = (value) => /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(value.trim());
  const declaredColours = new Map();
  for (const match of stripComments(MAIN).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (isColour(match[2])) declaredColours.set(match[1], match[2].trim());
  }

  const read = new Set([...MAIN.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const unaliased = [...declaredColours.keys()]
    .filter((token) => read.has(token) && !alias.has(token))
    .sort();
  assert.deepEqual(
    unaliased,
    [],
    `legacy colour tokens that main.css reads but the brand layer never redefines, so they stay light in dark mode: ${unaliased.join(', ')}`
  );
});

test('text on its own surface clears 4.5:1 in both themes', () => {
  const light = tokensIn(blockFor(BRAND, ':root'));
  const dark = tokensIn(blockFor(BRAND, ':root[data-theme="dark"]'));
  const pairs = [
    ['--ag-text', '--ag-surface'],
    ['--ag-text', '--ag-bg'],
    ['--ag-muted', '--ag-surface'],
    ['--ag-subtle', '--ag-surface-2'],
    ['--ag-brand-text', '--ag-bg'],
    ['--ag-good', '--ag-good-soft'],
    ['--ag-warn', '--ag-warn-soft'],
    ['--ag-bad', '--ag-bad-soft']
  ];
  for (const [theme, tokens] of [['light', light], ['dark', dark]]) {
    for (const [fg, bg] of pairs) {
      const ratio = contrast(tokens.get(fg), tokens.get(bg));
      assert.ok(
        ratio >= 4.5,
        `${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, below the 4.5:1 needed for body text`
      );
    }
  }
});

test('white on a brand fill clears 4.5:1, so primary buttons are legible', () => {
  const light = tokensIn(blockFor(BRAND, ':root'));
  const ratio = contrast(light.get('--ag-brand-on'), light.get('--ag-brand'));
  assert.ok(ratio >= 4.5, `button label contrast is ${ratio.toFixed(2)}:1`);
});

test('the brand blue is the one in the logo', () => {
  // Taken from AegisLogoColour. If this changes, the artwork and the interface
  // have drifted apart.
  const light = tokensIn(blockFor(BRAND, ':root'));
  assert.equal(light.get('--ag-brand').toUpperCase(), '#0F75BC');
});

test('the layout links every themed asset, and nothing from a third party', () => {
  for (const asset of ['/styles/fonts.css', '/styles/main.css', '/styles/brand-layer.css', '/scripts/theme-boot.js']) {
    assert.ok(LAYOUT.includes(`${asset}?v={{assetVersion}}`), `${asset} must be linked with the asset version`);
  }
  // The CSP is script-src 'self' and style-src 'self'. A third-party font or
  // script host is blocked at runtime and the page silently loses its type.
  assert.ok(!/https?:\/\/fonts\.(googleapis|gstatic)\.com/.test(LAYOUT), 'fonts are self-hosted, not fetched from Google');
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/.test(LAYOUT), 'an inline <script> is blocked by the CSP; use a file under /scripts');
});

test('the theme boot script runs before paint', () => {
  // With defer, the stored theme is applied after first paint and a viewer who
  // chose light on a dark computer gets a dark flash on every navigation.
  const tag = LAYOUT.match(/<script src="\/scripts\/theme-boot\.js[^"]*"[^>]*>/);
  assert.ok(tag, 'theme-boot.js must be linked');
  assert.ok(!/\bdefer\b|\basync\b/.test(tag[0]), 'theme-boot.js must not be deferred');
  assert.ok(
    LAYOUT.indexOf('theme-boot.js') < LAYOUT.indexOf('brand-layer.css'),
    'theme-boot.js must come before the stylesheets'
  );
});

test('the logo pair is switched by CSS, never by an inline display', () => {
  // The reported bug: an inline style="...display:block" on the light logo
  // beats the rule that hides it in dark mode, so both render at once.
  assert.ok(BRAND.includes('.ag-logo--dark { display: none; }'), 'the dark logo starts hidden');
  for (const marker of ['.ag-logo--light { display: none; }', '.ag-logo--dark  { display: block; }']) {
    assert.ok(BRAND.includes(marker), `the brand layer must contain: ${marker}`);
  }
  const partials = path.join(ROOT, 'views/partials');
  for (const file of fs.readdirSync(partials)) {
    const markup = fs.readFileSync(path.join(partials, file), 'utf8');
    for (const tag of markup.match(/<img[^>]*class="[^"]*ag-logo[^"]*"[^>]*>/g) || []) {
      assert.ok(!/style="[^"]*display\s*:/.test(tag), `${file}: an inline display on .ag-logo defeats the theme swap`);
    }
  }
});

test('no rule paints text in a token that is a surface or chrome colour', () => {
  // Three separate bugs in this refactor were the same mistake: a colour was
  // mapped by how it looked rather than by the job it does. A white that is a
  // background becomes --ag-surface; the same white as type on the navy bar is
  // --ag-nav-text. Get it backwards and the heading is invisible — which is
  // exactly what happened to the hero h1 and then to the plan card titles.
  //
  // The hairline and tint tokens are in the same list for the same reason.
  // A breadcrumb separator in --ag-line-strong measured 1.5:1, and the test
  // chips on /testing painted --navy-800 on --ag-brand-soft at 1.2:1 — both
  // are colours chosen to be barely visible against a surface, which is the
  // opposite of what type needs.
  const SURFACE_ONLY = new Set([
    '--ag-surface', '--ag-surface-2', '--ag-surface-3',
    '--ag-nav', '--ag-nav-2', '--ag-nav-line',
    '--ag-line', '--ag-line-strong',
    '--ag-brand-soft', '--ag-good-soft', '--ag-warn-soft', '--ag-bad-soft',
    '--navy-950', '--navy-900', '--navy-800',
    '--line', '--workspace-line', '--soft-blue',
    '--paper', '--mist', '--workspace-ink', '--ink'
  ]);
  const body = stripComments(MAIN);
  const offenders = [];
  for (const match of body.matchAll(/(?:^|[{;])\s*(color|-webkit-text-fill-color)\s*:\s*([^;}]+)/g)) {
    for (const ref of match[2].matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      if (SURFACE_ONLY.has(ref[1])) {
        offenders.push(`${match[1]}: var(${ref[1]})`);
      }
    }
  }
  assert.deepEqual(
    [...new Set(offenders)],
    [],
    'these paint text in a surface or chrome token, so the text disappears in one theme'
  );
});

test('no rule paints a background in a text-only token', () => {
  const TEXT_ONLY = new Set(['--ag-text', '--ag-muted', '--ag-subtle', '--ag-nav-text', '--ag-brand-text']);
  const body = stripComments(MAIN);
  const offenders = [];
  for (const match of body.matchAll(/(?:^|[{;])\s*(background|background-color)\s*:\s*([^;}]+)/g)) {
    for (const ref of match[2].matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      if (TEXT_ONLY.has(ref[1])) offenders.push(`${match[1]}: var(${ref[1]})`);
    }
  }
  assert.deepEqual([...new Set(offenders)], [], 'these fill a surface with an ink token');
});

test('main.css carries almost no literal colours left', () => {
  // Anything still literal cannot respond to the theme. The remainder should
  // be alpha overlays only, which work over any ground.
  //
  // "Overlay" is judged more strictly for a background than for anything
  // else. A card filled with rgba(255,255,255,.94) composites to white over
  // any ground, so it is a surface wearing an alpha — eleven cards stayed
  // white under the dark theme while the ink on them went light, and the
  // 0.98 cutoff waved every one of them through.
  const BACKGROUND = /^background(-color)?$/;
  const body = stripComments(MAIN);
  const opaque = [];
  for (const match of body.matchAll(/(?:^|[{;])\s*([-a-z]+)\s*:\s*([^;}]+)/g)) {
    if (match[1].startsWith('--')) continue;
    const ceiling = BACKGROUND.test(match[1].trim()) ? 0.85 : 0.98;
    for (const colour of match[2].match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g) || []) {
      const alpha = colour.match(/rgba\([^)]*,\s*([\d.]+)\s*\)$/);
      if (!alpha || Number(alpha[1]) >= ceiling) opaque.push(`${match[1]}: ${colour}`);
    }
  }
  assert.equal(
    opaque.length, 0,
    `opaque literal colours cannot follow the theme:\n  ${[...new Set(opaque)].slice(0, 12).join('\n  ')}`
  );
});
