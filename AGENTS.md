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

The Android leg needs a booted emulator (`Aegis_API35_arm64`) and the `local`
flavour installed; `--install-wallet` builds and installs it. Two Android
specifics the leg handles: the app is launched before deep-linking, because a
freshly installed package is in the *stopped* state and implicit intents skip
those; and the URL is quoted for the **device** shell, where an unquoted `&` is
a background operator that silently truncates it at the first parameter.

## iOS releases

`scripts/release-ios.sh --env dev|qa|prod|all` archives, exports and uploads;
`--env` is repeatable and mirrors the Azure deploy scripts, and bare
environment names still work. It reads `ASC_KEY_ID` and `ASC_ISSUER_ID` from an
untracked `.env.ios` at the repo root (template: `.env.ios.example`); exported
values win, and `IOS_ENV_FILE` overrides the location. These are per Apple
**team**, not per environment — dev, qa and prod share one App Store Connect
account — so they never belong in `.env.dev` / `.env.qa` / `.env`, which
configure the web app and are forwarded to Azure App Service. The `.p8` private
key lives at `~/.appstoreconnect/private_keys/`, never in the repo.

## Android releases

`scripts/release-android.sh --env dev|qa|prod|all` builds and signs an `.aab`
per environment into `artifacts/android/`. Signing comes from an untracked
`.env.android` (template `.env.android.example`); one keystore covers every
environment. Nothing is uploaded — Play publishing is manual. `versionCode` is
minutes since 2020-01-01, because Play caps it at 2100000000 and the
`YYYYMMDDHHMM` stamp iOS uses does not fit.

## Sign-in and delivery

**Every outbound message goes through `deliverMessage` in
`src/services/otp-delivery-service.js`** — sign-in codes, password reset links
and wallet recovery codes. Codes and links are never returned in a response.
Locally the `filesystem` transport writes them to `artifacts/mail/`; dev, qa and
prod start fail-closed until an admin configures SMTP or SMS at
`/admin/notifications`, where a per-message-type channel matrix decides what may
go over email and what over SMS.

**Which sign-in methods exist is configured, not hardcoded** —
`src/services/sign-in-methods-service.js` and `/admin/sign-in-methods`. Two flags
per method: `firstFactor` (may start a sign-in) and `satisfiesSecond`
(finishing it is enough on its own). A passkey with user verification is
possession plus inherence, so it completes a sign-in alone; a password never
does. The service refuses to save a configuration with no enabled first factor,
and refuses to make wallet approval the only one.

**Entra sign-in links only — it must never auto-provision an account.** No
matching Aegis account means refused, not created.

**Passwordless enrolment is off by default** and must be turned on per method
under "New accounts" at `/admin/sign-in-methods` — it changes who can obtain an
account, so it is never enabled by an upgrade. A passwordless account stores
`passwordHash: null`; `verifyUserPassword` returns null for such accounts before
reaching bcrypt, which throws on a null hash. Those accounts get ten single-use
recovery codes at enrolment (there is no password to reset) and must confirm
their email, since without a password registering proves nothing about the
address.

**A lost authenticator is recovered at `/auth/recover`** with a recovery code
*plus* a code emailed to the registered address. A written-down code is only
possession, whereas the passkey it stands in for was possession plus inherence,
so pairing the two keeps the assurance — the same shape as Tier-1 wallet
recovery. Every step answers identically whether or not the account exists, and
running out of codes is a hard stop that needs an admin.

**A locked-out account is resolved at `/admin/account-recovery`**, which lists
passwordless accounts and their remaining codes. An admin verifies the person
out of band and authorises a one-time, hour-long re-enrolment grant; the link
goes to the account's own address and the holder registers a new passkey and
receives fresh codes. **The admin never sees a credential or a code** — one who
could would make every passwordless account only as strong as its
administrator. Who authorised it and why is on the evidence chain.

## Subscription plans

`src/services/plan-service.js` is the single catalogue of tiers, limits and
prices. Amounts are in cents and live only there, so changing pricing is a
one-file edit.

**The plan on the record and the plan in effect are different things.** A trial
that has expired, or a paid plan whose `billingStatus` is not `active` or
`comped`, falls back to Trial limits — never to nothing. Existing workspaces
and credentials keep working and only new issuance is blocked, because a
billing event must not revoke somebody's identity credential.

A subscription with **no `billingStatus` field at all** predates billing and is
grandfathered onto its plan. Every record created since sets the field, so its
absence is unambiguous. An explicit empty string is a real answer and is
treated as lapsed.

Limits are enforced server-side at the only two paths that mint anything:
`registerWorkspaceForSubscription` and `issueCredential`. Metered plans have no
credential ceiling by design — the customer pays for what they issue rather
than being cut off. Limit failures are **402**, not 403: it is a billing limit,
not a permission failure.

## Wallet administration

`/admin/wallets` lists every registered wallet. **Revoking** sets
`status: 'revoked'` and is enforced in `assertBinding`, which every credential
acceptance goes through — so a revoked wallet genuinely stops working rather
than merely looking disabled. The record and its evidence stay, because a lost
or compromised wallet is exactly the case where the trail matters.

**Deleting** erases the wallet and is only offered when no credential has ever
bound to it, so a wallet with history can never be deleted away. The count is
re-checked server-side at delete time rather than trusted from the form. Both
actions carry the actor and a reason onto the evidence chain; for a deletion
that audit entry is the only remaining record the wallet existed.

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
