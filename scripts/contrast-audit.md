# Contrast audit

`scripts/contrast-audit.js` is a browser snippet, not a Node script. It walks
every text node on the current page, works out what is actually painted behind
it, and reports anything under WCAG AA — in its **resting** state and in its
**hover** state.

It is here because the static tests in `tests/brand-theme.test.js` can only
check the token definitions. They cannot see what a rule resolves to once the
cascade, a parent's background and an alpha channel have all had their say —
and most of the invisible-text bugs in the brand refit were only visible at
runtime.

## Running it

Serve it from the app so the CSP allows it (`script-src 'self'`), or paste it
into the console:

```bash
cp scripts/contrast-audit.js public/__audit.js   # temporary
```

```js
// in the page console, for each route and each theme
eval(await (await fetch('/__audit.js')).text())
```

Remove `public/__audit.js` afterwards; it is a debugging aid, not an asset.

Set the theme with `localStorage.setItem('aegis-theme', 'dark')` and reload —
it survives navigation, so a whole sweep runs in one theme at a time. On the
dashboard, click each `.app-side [data-blade-link]` between runs: a hidden
panel has no layout boxes and is not measured.

## Self-test

A clean result is only meaningful if the tool can fail. Before trusting a
sweep, plant a rule and confirm it is caught:

```js
const s = document.createElement('style');
s.textContent = '.app-nav:hover{color:#fafafa;background:#f8f8f9}';
document.head.appendChild(s);
__contrastAudit().hoverTotal;   // must be > 0
s.remove();
```

This is not ceremony. The hover pass silently reported zero on every page for
its first few runs — see below.

## What it handles that a naive check does not

- **Alpha.** A translucent colour is composited over everything behind it
  before the ratio is taken, so `rgba(255,255,255,.72)` on white is correctly
  reported as invisible rather than scored against the token.
- **Gradients.** Every colour stop is parsed and the worst one is used, so a
  label on a gradient tile is judged rather than skipped. The solid behind the
  gradient counts as a candidate ground only when some stop is translucent —
  an opaque gradient hides it. Stops at zero alpha paint nothing and are
  dropped, and `color(srgb …)` is understood, because that is how Chrome
  serialises a computed `color-mix()`.
- **Hover states**, read back from `document.styleSheets`. Every `:hover` rule
  matching an element is collected, ordered by specificity then source order,
  and the last `color` and `background-color` win. The hover pass deliberately
  does *not* skip a wrapper whose child holds the text — a hover rule is
  written on the thing the pointer is over while the words usually live in a
  span inside it — unless that child sets a colour of its own.
- **Photographic backgrounds** are skipped — the ratio is unknowable without
  sampling pixels, and guessing would be worse than saying nothing.
- **Large text** uses the 3:1 threshold, normal text 4.5:1.
- In the resting pass, only the innermost element carrying the text is
  measured, so one string is not reported once per ancestor.

## Two bugs in the tool worth remembering

Both made it report **zero findings on pages that had real failures**, which
is the worst way for a linter to be wrong.

1. **`CSSStyleRule` has a `cssRules` property.** Since CSS nesting shipped,
   every style rule exposes an (empty) rule list, so `if (rule.cssRules)` as a
   test for "is this a grouping rule?" skipped every ordinary rule in the
   stylesheet. The hover pass found nothing on any page. Dispatch on
   `selectorText` instead, and descend separately for genuine nesting.
2. **`getComputedStyle` on a detached element returns empty.** The probe used
   to resolve a declared `var()` was removed from the DOM before the finding
   was built, so every hover finding reported an empty foreground colour and
   named nothing actionable.
