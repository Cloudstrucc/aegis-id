# Email & SMS notifications

Every message Aegis ID sends to a person goes through one function —
`deliverMessage` in [`src/services/otp-delivery-service.js`](../../src/services/otp-delivery-service.js).
That means there is exactly **one** place the wording lives, one delivery log,
and one channel matrix. This document lists every message it can send, what it
is for, when it fires, and how to test it.

There are **seven** message types. There are no others: if a flow is not in the
table below, it does not send an email or SMS (see
[What does *not* send email](#what-does-not-send-email)).

## Delivery, in one paragraph

`deliverMessage({ type, email, phone, variables, context })` renders the
template for `type`, then sends it on **each channel the matrix permits and that
has a recipient**. The channel matrix is per message type, configured at
`/admin/notifications` (service
[`notification-settings-service.js`](../../src/services/notification-settings-service.js)).
The transport (SMTP / SMS provider) is configured there too. **Locally**
(`NODE_ENV=development`) the `filesystem` transport is on by default and writes
each message to `artifacts/mail/` instead of sending it. **dev, qa and prod
start fail-closed** — nothing is sent until an admin configures a real channel.
Codes and links are never returned in an HTTP response and never logged in
clear; the delivery log records only the type, masked recipient, and outcome.

The product name in every message (`${brand}`) comes from `context.branding`
— the platform's "Aegis ID", or an organization's own on its custom host.

## The seven messages

| Type | Subject | Purpose | Fires when | Channels (default) | Sent by |
|---|---|---|---|---|---|
| `mfa-otp` | Your {brand} sign-in code | Second-factor code after a password sign-in | A user signs in with a password and their preferred MFA is email/SMS | email + **sms** | [`auth-service.js`](../../src/services/auth-service.js) `createOtpChallenge` |
| `password-reset` | Reset your {brand} password | One-time link to set a new password | `/auth/forgot` — someone requests a reset | email | [`password-reset-service.js`](../../src/services/password-reset-service.js) |
| `email-verification` | Confirm your {brand} email address | Prove ownership of the address for a passwordless account | A passwordless enrolment, or an unverified account confirming its address | email | [`email-verification-service.js`](../../src/services/email-verification-service.js) |
| `account-reenrolment` | Set up a new passkey for your {brand} account | Link to register a new passkey after lock-out | An admin authorises a locked-out account at `/admin/account-recovery`, or two root wallets approve a recovery | email | [`account-reenrolment-service.js`](../../src/services/account-reenrolment-service.js) |
| `approver-recovery` | Approve a recovery for {org} | Ask a root-wallet holder to approve an admin's recovery | An administrator starts approver recovery at `/auth/recover/approvals`; one goes to **each** root wallet holder | email + **sms** | [`approver-recovery-service.js`](../../src/services/approver-recovery-service.js) |
| `approver-recovery-status` | Your {brand} recovery is waiting on your root wallets | Progress page for the person recovering (grants nothing) | Same flow as above — the one message that goes to the requester, not the approvers | email | [`approver-recovery-service.js`](../../src/services/approver-recovery-service.js) |
| `wallet-recovery` | Your {brand} wallet recovery code | Code to recover a wallet onto a new device | A holder recovers a wallet (`/auth/recover` wallet path) | email + **sms** | [`wallet-recovery-service.js`](../../src/services/wallet-recovery-service.js) via `deliverRecoveryCode` |

"Channels (default)" is what the matrix ships with; an admin can turn either
channel off per type, and each message only uses a channel that has a recipient
(no phone on file → no SMS even where SMS is allowed). SMS is off locally
unless a provider is configured.

## Template variables

Each template is a function of these (see the `TEMPLATES` object in
`otp-delivery-service.js`):

| Type | Variables |
|---|---|
| `mfa-otp` | `code` |
| `password-reset` | `resetUrl`, `expiresInMinutes` |
| `email-verification` | `verifyUrl`, `expiresInHours`, `displayName` |
| `account-reenrolment` | `reenrolUrl`, `expiresInMinutes`, `displayName` |
| `approver-recovery` | `approvalUrl`, `expiresInHours`, `organizationName`, `requesterEmail` |
| `approver-recovery-status` | `statusUrl`, `expiresInHours`, `organizationName`, `approvalsRequired` |
| `wallet-recovery` | `code`, `walletId` |

`brand` is supplied by `deliverMessage` from `context.branding`; templates never
take it as a caller variable.

## Making delivery work in dev, qa and prod

dev, qa and prod ship **fail-closed**: with no transport configured, choosing
"email code" at registration generates the code but sends nothing. Turn email
on one of two ways.

### Option A — deployment settings (recommended, survives deploys)

Set these as app settings on the environment (or in its gitignored `.env` /
`.env.dev` / `.env.qa`, which the deploy script pushes). When `SMTP_HOST` and
`SMTP_FROM_ADDRESS` are present they **take precedence** over
`/admin/notifications` and turn email on, so every environment is guaranteed to
send:

| Setting | Microsoft 365 | Gmail / Workspace |
|---|---|---|
| `SMTP_HOST` | `smtp.office365.com` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` | `587` |
| `SMTP_SECURE` | `false` (STARTTLS) | `false` |
| `SMTP_USERNAME` | a licensed mailbox | the sending account |
| `SMTP_PASSWORD` | an **app password** (secret) | an **app password** (secret) |
| `SMTP_FROM_ADDRESS` | that mailbox | that account |
| `SMTP_FROM_NAME` | `Vanguard Aegis ID` | `Vanguard Aegis ID` |

`SMTP_PASSWORD` is a secret — set it as an Azure app setting or in the
gitignored env file, never commit it. With these set, `/admin/notifications`
shows email as environment-managed and read-only; the per-message channel
matrix stays editable there. Redeploy after changing them:

```bash
for e in dev qa prod; do bash scripts/deploy-azure-webapp.sh --env "$e" --tenant vanguardcs || break; done
```

### Option B — the admin UI (runtime, per environment)

Sign in as a platform admin, open `/admin/notifications`, pick the Microsoft 365
or Gmail preset, enter the mailbox and app password, and **Test connection**.
This is stored on `/home` and survives deploys, but must be done per
environment and is overridden by Option A when that is set.

### Why nothing arrived before

No transport was configured, so email was fail-closed — the intended default,
so a fresh environment never silently sends from a wrong address. Locally the
`filesystem` transport is on instead, writing to `artifacts/mail/` rather than
sending; read the file, there is no inbox.

## Testing

### Fastest — render every template through the real delivery path

```bash
node scripts/dev/send-test-notifications.js            # all seven
node scripts/dev/send-test-notifications.js mfa-otp    # just one
```

Locally this writes each message to `artifacts/mail/`; read the newest with:

```bash
cat "$(ls -t artifacts/mail/*.txt | head -1)"
```

Point it at a real inbox (against a hosted environment with SMTP configured, or
locally after configuring one), or test SMS:

```bash
TEST_EMAIL=you@example.com node scripts/dev/send-test-notifications.js
TEST_PHONE=+16135550100  node scripts/dev/send-test-notifications.js mfa-otp
```

To see an organization's own branding on a message, uncomment the `context`
line in the script.

### End-to-end — trigger the real flows

These exercise the whole path, not just the template:

| Message | How to trigger |
|---|---|
| `mfa-otp` | Sign in at `/auth/login` with a password account whose MFA is email/SMS |
| `password-reset` | `/auth/forgot`, enter a registered email |
| `email-verification` | Register a passwordless account, or resend from the verify screen |
| `account-reenrolment` | `/admin/account-recovery`, authorise a locked-out account |
| `approver-recovery` + `approver-recovery-status` | `/auth/recover/approvals`, start a recovery for an org with confirmed root wallets |
| `wallet-recovery` | `/auth/recover`, recover a wallet by Wallet ID |

On a hosted environment, configure a channel first at `/admin/notifications`
(Microsoft 365 / Gmail / custom SMTP presets), or every send fails closed.

### Reading the delivery log

`/admin/notifications` shows the recent delivery log (type, masked recipient,
channel, outcome) — the audit of what actually went out, without the contents.

## What does *not* send email

Aegis ID is wallet- and in-app-first, so several things you might expect to be
emails are deliberately not:

- **Credential invitations** and **organization invitations** are delivered as
  QR codes and `aegisid://` deep links, redeemed in the wallet — not emailed.
  ("Invite a user", CSV import, re-invite.)
- **Wallet challenges** (approve a sign-in, a consent, a signature, an expense)
  arrive by the wallet polling the platform and appear as the challenge banner
  and the **Ledger**; there is no email step.
- **Consent requests**, **co-admin requests**, **evidence / identity
  verification**, and **admin review** surface in the dashboard and on the
  immutable ledger, not by email.

If any of these should also send an email, that is a new message type: add it to
`TEMPLATES` in `otp-delivery-service.js` **and** to `MESSAGE_TYPES` in
`notification-settings-service.js` (so it appears in the channel matrix), then
call `deliverMessage` from the flow. Nothing sends mail any other way.
