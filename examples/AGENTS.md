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

### Configuration

Reads its own `.env`: `PORT` (4300), `AEGIS_ID_BASE_URL`, `AEGIS_ORGANIZATION_ID`,
`AEGIS_ISSUER_CONNECTION_ID`, `OIDC_CLIENT_ID`, `OIDC_SCOPE`, `SESSION_SECRET`,
plus `VERIFIED_ID_AUTH_ENABLED` and `YUBIKEY_AUTH_ENABLED` toggles.

`AEGIS_ORGANIZATION_ID` must name an organization the wallet is connected to, or
challenges raised here have nothing to deliver to.

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
