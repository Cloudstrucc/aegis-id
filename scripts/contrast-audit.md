# Contrast audit

`scripts/contrast-audit.js` is a browser snippet, not a Node script. It walks
every text node on the current page, works out what is actually painted behind
it, and reports anything under WCAG AA.

It is here because the static tests in `tests/brand-theme.test.js` can only
check the token definitions. They cannot see what a rule resolves to once the
cascade, a parent's background and an alpha channel have all had their say —
and three invisible-text bugs in the brand refit were only visible at runtime.

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

## What it handles that a naive check does not

- **Alpha.** A translucent colour is composited over everything behind it
  before the ratio is taken, so `rgba(255,255,255,.72)` on white is correctly
  reported as invisible rather than scored against the token.
- **Gradients.** Every colour stop is parsed and the worst one is used, so a
  label on a gradient tile is judged rather than skipped. Scoring these as
  failures was the main source of false positives in the first version.
- **Photographic backgrounds** are skipped — the ratio is unknowable without
  sampling pixels, and guessing would be worse than saying nothing.
- **Large text** uses the 3:1 threshold, normal text 4.5:1.
- Only the innermost element carrying the text is measured, so one string is
  not reported once per ancestor.
