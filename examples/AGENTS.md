# Example Applications — Agent Guidance

Read [`/AGENTS.md`](../AGENTS.md) first.

Everything under `examples/` is a **separate application** with its own
`package.json`, `node_modules`, `.env` files, and deployment. Repo-root commands
do not reach it: `npm test` at the root does **not** run these apps, and
`scripts/deploy-azure-webapp.sh` does **not** deploy them.

## business-expenses

A standalone Node/Express + Handlebars relying-party app that consumes Aegis ID.
It is what proves the platform works from an application's point of view.

```bash
cd examples/business-expenses
cp .env.example .env      # first run only
npm install               # its own dependency tree
npm start                 # http://localhost:4300
```

Requires Aegis ID running on `http://localhost:3000` (its `AEGIS_ID_BASE_URL`
default).

### Surfaces

| Route | What it exercises |
|---|---|
| `/` | App landing |
| `/apps/:appId` | Per-app landing pages, including `/apps/signatures` |
| `/auth/start`, `/auth/callback` | Aegis OIDC sign-in |
| `/expenses` | Expense approval, wallet-signed |
| `/signatures` | **Digital signature app** — templates and envelopes |
| `/verified-id/:id`, `/yubikey/:id` | Assurance step-ups |
| `/challenge/:id`, `/challenge/:id/status` | Wallet challenge and its polling endpoint |
| `/ledger` | Records this app raised against Aegis |

The Testing page in the platform links to `/apps/signatures` for the signature
demo, via `DIGITAL_SIGNATURE_APP_URL` or derived from the Business Expenses URL.

### Organization selection

**`AEGIS_ORGANIZATION_ID` is no longer required.** The holder signs in through
Aegis OIDC and the token carries every organization they hold a live credential
in. A holder in more than one is sent to `/organizations` to choose before the
demo surfaces open; a holder in exactly one is selected automatically. Only
organizations present on their own token are selectable, so a posted id cannot
reach an organization they do not belong to.

Challenges are addressed to the chosen organization, falling back to
`AEGIS_ORGANIZATION_ID` only when nothing was chosen.

### Per-holder data

Demo records live under `data/holders/<holder>/` and are namespaced per signed-in
holder using `AsyncLocalStorage`, so concurrent sessions never see each other's
records. `users.json` stays shared because it describes the app rather than a
holder. Records seed themselves on first read, so a new holder gets a working set
without any setup. `/expenses/reset` and `/signatures/reset` drop that holder's
files, and expenses re-seed on the next read.

When adding a store, decide whether it is per-holder (default) or belongs in
`GLOBAL_FILES`.

### Third-party browser assets

**Nothing is loaded from a CDN.** Bootstrap, the Bootswatch Flatly theme,
Bootstrap Icons and pdf.js are served from the app's own origin out of
`public/vendor/`, and the committed `public/vendor/manifest.txt` records what
each file is and its hash.

Re-download or upgrade with `scripts/fetch-example-vendor.sh`, which pins the
versions in one place, strips the Google Fonts `@import` that Bootswatch themes
carry, and prints the two files that reference the result. The output is
committed, because the deploy zip excludes `node_modules` — these are assets,
not dependencies.

This matters more here than it looks. A CDN link is a request the holder's
browser makes to someone else's server, so it hands a third party their IP
address and the page they were on, for every page view of an identity demo —
while `/cookies` tells them no third party is involved. It also forces the
Content Security Policy to admit a whole external origin for scripts, styles,
fonts and workers, which is most of that policy's value gone. The policy in
`src/server.js` is now `'self'` throughout, and
`tests/example-app-assets.test.js` at the repo root fails if an absolute
`src`/`href` reappears, if the policy names an origin again, or if the vendored
tree stops matching its manifest. That test is at the root because this app has
no runner of its own, which is how the CDN links survived unnoticed in the
first place.

### Configuration

Reads its own `.env`: `PORT` (4300), `AEGIS_ID_BASE_URL`, `OIDC_CLIENT_ID`,
`OIDC_SCOPE`, `SESSION_SECRET`, plus `VERIFIED_ID_AUTH_ENABLED` and
`YUBIKEY_AUTH_ENABLED` toggles. `AEGIS_ORGANIZATION_ID` and
`AEGIS_ISSUER_CONNECTION_ID` remain as optional fallbacks.

## When platform changes affect these apps

This app calls the platform's external API surface, so a change there can break
it silently — nothing at the repo root will fail. Check it whenever you touch:

- wallet challenge creation, delivery, or status polling
- the OIDC provider endpoints or token/claims shape
- organization connection or credential binding
- anything reached through `api.walletChallenge.external` or
  `api.oidcProvider.external`

The end-to-end journey test (`scripts/e2e/`) drives this app, so run it after
such a change rather than assuming the root test suite covers it.
