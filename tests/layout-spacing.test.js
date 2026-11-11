const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Dead space at the top of a page.
//
// A page opened with a screenful of nothing between the breadcrumb and the
// first card. Nothing failed: the page rendered, the content was all there,
// it was just 152px lower than it should have been. It reached production on
// several pages at once because the cause was one shared rule and the symptom
// was per-page.
//
// The rule is a clearance for pages whose <main> sits under the fixed site
// header. Inside the application shell <main> is .app-shell__main, which sits
// below the shell's own topbar and breadcrumb, and `.app-shell .band`
// already zeroes the bands' padding — the unscoped rule simply outranked it.
//
// This file guards the shape of that rule. What it cannot do is measure a
// rendered page, which is what actually shows the defect: use
// scripts/layout-gap-audit.js in the browser for that, the way
// scripts/contrast-audit.js is used for colour.

const STYLES = path.join(__dirname, '..', 'public', 'styles');
const CSS = fs.readFileSync(path.join(STYLES, 'main.css'), 'utf8');
const BRAND = fs.readFileSync(path.join(STYLES, 'brand-layer.css'), 'utf8');

/**
 * Every rule in main.css as { line, selector, body }.
 *
 * Deliberately crude — enough to find a selector and read its declarations,
 * not a parser. A rule that confuses it shows up as a finding rather than
 * being silently skipped, which is the right way round for a guard.
 */
function rules() {
  const found = [];
  // Comments out first, replaced by their own newlines so the reported line
  // numbers still point at the rule. Left in, a comment above a rule becomes
  // part of its "selector" and the rule stops matching anything — which is
  // exactly how the first version of this guard passed against a stylesheet
  // that still had the defect in it.
  const source = CSS.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''));
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(source))) {
    const selector = match[1].trim();
    if (!selector || selector.startsWith('@') || selector.startsWith('/*')) {
      continue;
    }
    found.push({
      line: source.slice(0, match.index).split('\n').length,
      selector: selector.split('\n').map((part) => part.trim()).join(' '),
      body: match[2]
    });
  }
  return found;
}

test('page-level header clearance never applies inside the application shell', () => {
  // `main > .band:first-child` and `main > .page-hero` are the two shapes the
  // clearance has taken. Either one, unscoped, puts a screenful of nothing at
  // the top of every shell page that opens with that element.
  //
  // Only rules that set vertical space count. The same selector also carries
  // the typography ramp for a page's opening heading, which is a size rather
  // than a gap and is right in both layouts.
  const offenders = rules().filter((rule) => {
    const setsSpace = /(^|[;\s])(padding|padding-top|padding-block|margin|margin-top|margin-block)\s*:/.test(rule.body);
    if (!setsSpace) {
      return false;
    }
    return rule.selector.split(',').some((part) => {
      // Functional pseudo-classes carry their own selectors inside them, and
      // a space in there is not a descendant combinator.
      const flat = part.replace(/\([^()]*\)/g, '()').trim();
      if (!/^main\s*>\s*\.(band|page-hero|hero)\b/.test(flat)) {
        return false;
      }
      if (flat.includes('main:not(')) {
        return false;
      }
      // Only the first element itself. A rule on something inside it sets
      // spacing within the content, which is right in either layout.
      return flat.split(/\s+/).length <= 3;
    });
  });

  assert.deepEqual(
    offenders.map((rule) => `main.css:${rule.line} ${rule.selector}`),
    [],
    'a rule that adds space above the first element of <main> is not excluded from the shell'
  );
});

test('the shell still zeroes the padding the page-level rules carry', () => {
  // The exclusion above is only correct because of this: inside the shell the
  // bands and heroes have no padding of their own, so removing the clearance
  // leaves the right amount of space rather than none.
  assert.match(CSS, /\.app-shell \.band \{[^}]*padding:\s*0/s);
  // The hero's reset lives in the brand layer, which is loaded last.
  assert.match(BRAND, /\.app-shell \.page-hero \{[^}]*padding:\s*0/s);
});

test('the rendered-page audit is where it says it is', () => {
  // Named in AGENTS.md and in the comment above. A guard that points at a
  // missing file is worse than no guard.
  const audit = path.join(__dirname, '..', 'scripts', 'layout-gap-audit.js');
  assert.ok(fs.existsSync(audit), 'scripts/layout-gap-audit.js is missing');

  const source = fs.readFileSync(audit, 'utf8');
  assert.match(source, /app-shell__main/);
  assert.match(source, /fails:/);
});
