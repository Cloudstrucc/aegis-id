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
the **`aegisid-local`** URL scheme and the `.dev` bundle id, not `aegisid` — the
harness reads `AEGIS_URL_SCHEME` from the project rather than assuming. It also
launches the app before deep-linking, because opening a custom scheme from the
home screen raises an "Open in …?" prompt that nothing can dismiss.

The Android leg needs a booted emulator (`Aegis_API35_arm64`) and the `local`
flavour installed; `--install-wallet` builds and installs it. Two Android
specifics the leg handles: the app is launched before deep-linking, because a
freshly installed package is in the *stopped* state and implicit intents skip
those; and the URL is quoted for the **device** shell, where an unquoted `&` is
a background operator that silently truncates it at the first parameter.

## Passkeys for other services

Both wallets act as **FIDO2 credential providers**, so a holder can use the
Aegis wallet as their passkey for any site that supports one — not only for
Aegis. iOS ships an `ASCredentialProviderExtension` target; Android a
`CredentialProviderService` (API 34+). Full notes in
[`docs/wallet-passkey-provider.md`](docs/wallet-passkey-provider.md).

**Same-device only, and that is a platform limit rather than a gap.** Signing in
on a desktop by scanning a QR is the hybrid (caBLE) transport, implemented
inside iOS and Play services with no third-party API on either. Passkeys also do
not sync between devices — the key is non-extractable and excluded from backups,
so losing the phone means recovering through each site's own process. Both are
stated in the wallet interface, because they are much easier to explain before
somebody relies on them.

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

`standing` distinguishes `unpaid` (never started) from `lapsed` (stopped
working). Telling a brand-new signup their plan has "lapsed" would be wrong.

## Signup: plan first, account second

The order is `/plans` → checkout (paid only) → `/auth/register` → `/subscribe`.
Somebody who picks Enterprise finds that out at the pricing page rather than
after filling in a registration form.

The plan can be chosen on the pricing page or on the registration form itself,
which offers the whole catalogue and defaults to Trial, plus a box for a
registration code.

**A form asks for a plan; it never grants one.** The selection is validated
against the catalogue by `choosePlan` and kept in the session
(`src/services/signup-intent-service.js`); every route then passes the
*session's* plan to `createSubscription`, overriding whatever the request
carried. Picking a paid plan on the registration form routes to `/checkout`
after second-factor verification rather than to `/subscribe`, so it still has
to be paid for or comped.

A code entered on the registration form is checked **before** `registerUser`,
so an invalid one re-renders the form rather than leaving a half-made account
that cannot have what it asked for.

Choosing a plan afresh clears any grant attached to the old one, so a code for
Basic cannot be carried sideways onto Enterprise. Redemption independently
returns the code's own plan, so even a tampered session cannot buy more than
the code is worth.

A paid plan with nothing settling it still creates the account — it simply
starts `incomplete`, which entitles Trial limits. Choosing Enterprise and
walking away from the card form must grant nothing, but it must not dead-end
either.

Card checkout is gated on `config.billing.checkoutEnabled`, derived from
`STRIPE_SECRET_KEY` rather than being its own switch, so it can never be on
while there is nothing behind it to take a payment.

## Billing

**Stripe is the source of truth.** `billingStatus` on our record is a cache of
what Stripe says, written only by a signature-verified webhook or by reading
the API back (`reconcileSubscription`). Stripe's own status values are stored
verbatim rather than translated, because a second vocabulary would only be a
second thing to keep in step. `trialing` therefore entitles in full — it is a
paid plan inside its trial window, not a free one.

**Test or live is decided by the key, never by the environment name.**
`config.billing.isTestMode` reads the `sk_test_`/`rk_test_` prefix, because the
two can legitimately disagree — a pre-production environment shown to
prospective customers runs a test key while being called `prod`. The dangerous
case is the reverse, so a test key announces itself on the checkout page and in
a startup banner rather than being inferred.

Checkout is **hosted**, so card details never reach this application and it
stays out of PCI scope. Line items are built inline from the plan catalogue
rather than from Stripe Price IDs, so pricing stays a one-file edit in
`plan-service.js` with no dashboard state to drift.

**The webhook route is mounted before the body parsers** in `app.js`. The
signature is computed over the exact bytes Stripe sent, so a parsed-then-
restringified body will not verify. That endpoint is public by necessity, and
the signature check is its entire security boundary: an unverified body is an
attacker telling us who has paid.

Payment happens *before* the account exists, so a paid checkout is parked in
`checkoutSessions` under a handle the browser carries, then claimed once — a
second subscription cannot spend the same payment. The return from Stripe is a
navigation hint, never evidence; `confirmCheckout` reads the session back from
Stripe when the webhook has not landed yet, which is the common case.

Webhooks arrive out of order and are retried. `applyBillingUpdate` ignores an
event older than the last one applied, compared **at whole-second resolution**
because Stripe timestamps to the second — comparing milliseconds discards
legitimate events that land in the same second as the record they update.

## Registration codes

`/admin/registration-codes` issues a code that grants a paid plan without
payment — for testers, and for a comped pilot. A code is worth what the plan is
worth, so it is handled like a credential:

- **hash only**, shown once at issue and never again
- **scoped to named environments** — a dev code is refused on prod, so leaking
  the test codes cannot cost revenue. `all` is rejected outright.
- limited redemptions, an expiry, and revocation that keeps prior history
- every issue, redemption, rejection and revocation on the evidence chain

Rejection is deliberately uniform — unknown, expired, spent, revoked and
wrong-environment all answer "not valid" — so the signup form cannot be used to
discover which codes exist.

A code can be entered at checkout or on the registration form. Either way it is
**checked there but spent at `/subscribe`**, the only place a subscription is
minted. Spending it earlier would burn a redemption for anyone
who abandoned the last form. A redeemed code sets `billingStatus: 'comped'`,
which entitles exactly as much as paying does.

## Organization identity

An organization's **name is a label, not an identity**. Names are free text and
scoped per subscription — `registerWorkspaceForSubscription` matches on name
only within your own subscription — so two subscribers can both be
"Cloudstrucc", and they always will be able to. Global uniqueness would be a
land grab, and real companies do share names.

Identity lives in two other things, in `organization-identity-service`:

- a **handle** (`cloudstrucc-a7f3`), assigned at workspace creation, globally
  unique, never reused. Assigned inside `registerWorkspaceForSubscription`
  because that is the only path that mints a workspace.
- an optional **verified domain**, proven by a TXT record at
  `_aegis-challenge.<domain>`. DNS rather than a file upload: publishing in the
  zone requires control of the zone, whereas a file only proves control of one
  web server.

Claiming is not owning. Two organizations may both have a *pending* claim on the
same domain — only publishing the record decides it — but a domain already
verified elsewhere is refused. A used token is discarded, and re-claiming issues
a fresh one so an abandoned claim cannot be completed by somebody who saw the
old value.

Unverified is not anonymous: every organization has `/orgs/<handle>`, a public
page that says plainly whether the domain is proven. Path-based rather than a
subdomain because **App Service serves only its own hostname** —
`<handle>.<app>.azurewebsites.net` would never resolve, while
`<app>.azurewebsites.net/orgs/<handle>` does, and is a valid did:web path form
for when per-organization keys exist.

## Root wallets

`root-wallet-service` holds the wallets that can recover administrative control
of an organization. They exist because control today is ultimately tied to an
email address and recovery runs through the platform administrator — meaning
Vanguard can restore access to a customer's organization, and so can anyone who
takes over their email.

**Nominating is not confirming.** A Wallet ID is an identifier, not a secret —
`wallet-id.js` says so — so a nomination stays `pending` until the wallet
presents the confirmation token from the QR, compared in constant time. Only
confirmed wallets count. The token is single-use, expires in 72 hours, and is
discarded once spent.

**One is the bar to operate; three is the bar to be safe.** An organization with
no confirmed root wallet cannot issue credentials. One to three is allowed but
raises a danger banner, because a single root wallet means one lost device
strands the organization. Ten is the ceiling — past a point another root wallet
is another device that can recover the organization, which is attack surface
rather than safety. Withdrawing is allowed at any count on purpose: a stolen
device has to be removable at once.

`ROOT_WALLET_POLICY_ENFORCED` gates the block. **On in `.env`, `.env.dev` and
`.env.qa`; off in `.env.local`**, so the suite runs against the unenforced
default and enforcement is tested explicitly. Turning it on stops issuance for
organizations with no root wallet, existing ones included.

**Every wallet deep link carries the environment's own scheme.** A dev build
registers `aegisid-dev`, so the bare `aegisid` the server used to emit opened
the production build — or, on iOS where a scheme is claimed exclusively,
nothing at all. `config.app.walletUrlScheme` maps `local`/`dev`/`qa`/`prod` to
`aegisid-local`/`aegisid-dev`/`aegisid-qa`/`aegisid`, overridable with
`WALLET_URL_SCHEME`, and every emitted link uses it. Keep it in step with
`aegisEnvironment(...)` in the Gradle build and `AEGIS_URL_SCHEME` in the iOS
project. Both wallets match *any* `aegisid*` scheme on the way in, so a link
pasted from another environment is still understood rather than rejected as
"not an Aegis link".

The wallet-facing endpoints (`/api/root-wallets/confirm`,
`/api/break-glass/authorise`, `/api/account-recovery/approve`) answer a browser
with a page and a wallet with JSON, chosen by `Accept`. Both wallet clients send
`Accept: application/json`; without that they were parsing HTML for a yes or no.

## Routine recovery, approved by root wallets

`approver-recovery-service`, at `/auth/recover/approvals`. The case break-glass
does not cover: an administrator who has lost their authenticator while the
organization's root wallets are all still there. Two of them approve and the
re-enrolment grant follows, with **no platform administrator anywhere in it**.

- **A token belongs to one wallet.** Each approval token names the wallet it was
  minted for and is spent by that wallet presenting its own Wallet ID, so two
  approvals mean two devices rather than one device scanning twice.
- **The person recovering never receives a token.** Approval links go to each
  root wallet holder's own registered address; the requester gets a status page
  and nothing else. That is the difference from the email path — a stolen inbox
  now reaches a page it cannot act on.
- **It replaces the weaker path rather than sitting beside it.** At three
  confirmed root wallets with enforcement on, `/auth/recover` stops accepting
  those administrators — silently, by never setting a `userId`, because
  answering differently would let the form count somebody's root wallets. The
  page points everybody at the approver flow instead.

Two is the approval threshold and three is where the older path closes: below
three an organization cannot reliably find two approvers, so taking it away
would lock people out rather than protect them.

## Break-glass recovery

The one way back for an organization that has lost every root wallet, in
`break-glass-service` and redeemed at `/admin/break-glass`.

Built so it can never become a master key. **The customer generates the code and
keeps it** — only a scrypt hash is stored, so nobody here holds it. **It is
inert until a root wallet authorises it**, which happens while wallets still
exist: that is the explicit permission, given in advance, because at the moment
of use there is no wallet left to ask. **Redeeming needs both the code and a
platform administrator**, plus a mandatory ticket reference.

The property this buys: *no administrator here can reach a customer's
organization on their own* — by construction, not by policy. There is no path
from an admin session to organization control that does not pass through a code
the customer holds and a permission their root wallet already gave. An attempt
with an unauthorised code is refused and recorded, and the redemption record
names the wallet whose authority it acted on.

## Platform administration

`/admin` is the index for every platform-wide setting — sign-in methods,
notification delivery, wallet administration, registration codes, account
recovery. Before it existed those pages were reachable only by typing the URL,
which is how two of them shipped broken.

**It is for subscribers, not for everyone who can sign in.** Two populations
have accounts: people who bought a plan and administer their own organizations,
and credential holders who exist only because an organization invited them. The
second group gets a `portal-account` subscription so they have somewhere to
land; `admin-access-service` filters those records out before looking at
workspaces, so an invited holder can never reach settings that decide how
everybody signs in.

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
