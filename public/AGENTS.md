# Aegis ID Front-End Styling Guidance

Use this guidance for CSS, client-side JS, and static assets under `/public`.

## Design intent

- authenticated product surfaces should look like enterprise software
- docs should feel like professional technical documentation
- marketing pages can be expressive, but must remain controlled and readable

## Rules

- Reduce visual noise.
- Prefer smaller, calmer typography in operational surfaces.
- Avoid clipping, hidden overflow, and horizontal scrolling.
- Fix spacing, contrast, and layout issues before adding decorative styling.
- Do not turn operational pages into marketing pages.

## Two rules that have each cost a release

**A rule keyed on `main > :first-child` applies inside the application shell
too.** The fixed site header needs clearing on a plain page, and that clearance
was written as `main > .band:first-child { padding-top: 152px }`. Inside the
shell `<main>` is `.app-shell__main`, which sits below the shell's own topbar
and breadcrumb, and `.app-shell .band` already zeroes the bands' padding — so
every shell page opened with a screenful of nothing. Scope page-level spacing
with `main:not(.app-shell__main)`, and check the result with
`scripts/layout-gap-audit.js` rather than by reading the rule.

**A rule keyed on an element rather than its class catches its neighbours.**
`.demo-qr-card--onboarding img { width: 100%; height: auto }` was written for a
QR code and also found the App Store badge in the same card, which is drawn at
a fixed height beside another badge. Target the thing by its own class.

Both are invisible in review and obvious on the page. Open it.

## Colour

`--ag-brand-text` is for links, the active row and interactive affordances.
Text somebody reads is `--ag-text`; secondary labels and metadata are
`--ag-muted`. Setting the brand colour on a container paints everything inside
it — that is how the documentation came to render every heading, paragraph,
list item and code block in the link colour.

Run `scripts/contrast-audit.js` on the rendered page in both themes before
calling a colour change done. It reports resting and hover pairs, and it
catches the hover rules that a screenshot cannot show.
