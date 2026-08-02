# Aegis ID — Agent Operating Guide

Vanguard Aegis ID is a standalone identity, authorization, wallet challenge,
credential, and connected-app platform with companion iOS and Android apps.

This is the canonical repo-wide guidance file for coding agents.

## Repository layout

The repo holds **four separate applications**, not one. Know which you are in
before changing anything.

| Path | What it is | Run it |
|---|---|---|
| `/src`, `/views`, `/public` | **Aegis ID** — the platform. Node/Express + Handlebars. Port 3000. | `npm start` |
| `/examples/business-expenses` | **Business Expenses** — a *standalone* Node/Express relying-party app with its own `package.json` and `node_modules`. Port 4300. Contains the **Digital Signature** app at `/signatures`. | `cd examples/business-expenses && npm start` |
| `/ios/VanguardAegisWallet` | iOS wallet (SwiftUI). Schemes: default, Dev, QA, Local. | Xcode, or `scripts/release-ios.sh` |
| `/android/VanguardAegisWallet` | Android wallet (Compose). | `./gradlew` |
| `/aries-lab` | ACA-Py agents + optional VON ledger, Docker. **Lab only** — never on the product path. | `docker compose up` |

### The example apps

`examples/business-expenses` is a **real second application**, deployed
separately to `vanguard-business-expenses-*.azurewebsites.net`. It signs in
through Aegis OIDC and raises wallet challenges against the platform. It is the
host for two things the product brief refers to as separate apps:

- **Business Expenses** — `/expenses`, wallet-signed expense approvals
- **Digital signature** — `/signatures`, envelope signing (`/apps/signatures` is its landing page)

It reads `AEGIS_ID_BASE_URL`, `AEGIS_ORGANIZATION_ID`, and `OIDC_CLIENT_ID` from
its own `.env`, and defaults to `http://localhost:3000` for the platform.

When a change touches the demo journey end to end, check whether it needs a
matching change in this app — it is easy to miss because it has its own
dependency tree and is not exercised by `npm test` at the repo root.

## Environments

`local` is the only environment where `NODE_ENV=development`. **`dev`, `qa` and
`prod` all run `NODE_ENV=production`**, so any guard written as
`NODE_ENV !== 'production'` is inert everywhere except localhost. That is
deliberate — it is what keeps local-only affordances out of hosted environments.

Persistent state on hosted environments lives on the `/home` mount
(`/home/data/aegis-id/<env>/`), never in `wwwroot`, which is replaced on every
deploy. A new JSON store therefore needs its `*_STORE_PATH` added to
`scripts/deploy-azure-webapp.sh` and set as an app setting, or it will be
silently wiped on the next deployment.

## Output and workflow

- Be concise. No chatty narration.
- Implement directly unless design analysis is explicitly requested first.
- Compact context aggressively.
- Keep changes scoped. No unrelated cleanup.
- Reuse existing helpers and shared services before adding new abstractions.
- Prefer `apply_patch` for manual edits.

## Testing

- Do not run tests, lint, or build checks unless explicitly asked.
- If a change clearly needs a test, add it, but do not execute it unless asked.
- If verification is requested, run the smallest targeted scope possible.

### The end-to-end journey

`scripts/e2e/run.sh` drives the whole holder journey and starts both Node apps
itself — no `npm start` needed first. It claims ports **3000 and 4300** by
default, because the wallet's Local build is compiled against
`AEGIS_WEB_APP_BASE_URL = http://localhost:3000`; a busy port moves only that
app to 3210/4310, and if Aegis moves the iOS leg skips. Each run writes to
`artifacts/e2e/<timestamp>/`, with every `*_STORE_PATH` pointed inside it.

The iOS leg needs the wallet installed on a booted simulator: `--install-wallet`
builds the Local scheme and installs it. Note the Local configuration registers
the **`aegisid-dev`** URL scheme and the `.dev` bundle id, not `aegisid` — the
harness reads `AEGIS_URL_SCHEME` from the project rather than assuming. It also
launches the app before deep-linking, because opening a custom scheme from the
home screen raises an "Open in …?" prompt that nothing can dismiss.

## Product identity

Aegis ID is a standalone platform. It is not subordinate to Microsoft,
Keycloak, YubiKey, or any other vendor. Those are integrations.

Core capabilities:

- Aegis-issued OIDC/OAuth for connected apps
- upstream federation to enterprise IdPs
- downstream relying-party integrations
- wallet-backed challenge approval with immutable ledger evidence
- centralized RBAC and policy enforcement
- credential issuance, consent, and revocation
- hardware-backed assurance such as WebAuthn, passkeys, and YubiKey

## Architecture invariants

1. Aegis is the policy decision point.
2. Deny by default.
3. Authorization must be centralized.
4. Server-side enforcement is mandatory.
5. Wallet challenge approve and decline paths are both meaningful.
6. Integrations are adapters, not the product identity.

## Security rules

- Reuse the authorization service and policy helpers.
- Prefer shared middleware and registries over inline conditionals.
- Keep secrets masked by default.
- Protect admin-only features with the same RBAC system used elsewhere.
- Use official, well-supported libraries for auth and security-sensitive code.

## Stack

- Web: Node.js, Express, Handlebars, shared CSS/JS
- Mobile: `/ios`, `/android`
- Identity: Passport, Aegis OIDC/OAuth, upstream federation, WebAuthn/passkeys
- Credential/wallet: Aegis wallet challenges, Verified ID integration, Aries lab
- Docs: Markdown rendered in-app

## UX rules

- Authenticated surfaces should feel like enterprise software.
- Avoid oversized typography in dashboards, docs, and admin views.
- Avoid accidental overflow and horizontal scrolling.
- Keep tables responsive within their container.
- Keep modals and forms visually integrated with the product.

## Environments

- local
- dev
- qa
- prod

Tenants:

- Cloudstrucc default
- VanguardCS additional tenant

## Default feature workflow

1. inspect the existing implementation
2. identify the smallest correct integration point
3. implement using existing architecture
4. update docs if developer/operator workflow changed
5. add tests if useful, but do not run them unless asked

## Nested guidance

When working in these areas, also read the nearest nested `AGENTS.md`:

- `/src`
- `/views`
- `/public`
- `/ios`
- `/android`
- `/tests`
- `/examples`
