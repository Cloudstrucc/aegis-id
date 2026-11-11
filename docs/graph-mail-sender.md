# Sending mail through Microsoft Graph

Every outbound message the platform sends — sign-in codes, password reset
links, email verification, account re-enrolment grants, root wallet approval
requests, wallet recovery codes — goes through `deliverMessage` in
[`src/services/otp-delivery-service.js`](../src/services/otp-delivery-service.js)
and out over one transport.

On Microsoft 365, that transport should be Graph rather than SMTP.

## Why not SMTP

The sender is a shared mailbox, and a shared mailbox has no licence. Exchange
Online refuses SMTP AUTH for an unlicensed mailbox whatever the password is,
with `535 5.7.139`. Licensing it to get round that buys three problems: a
monthly cost per environment, a password sitting in an app setting, and a
Conditional Access exclusion if MFA is enforced. Microsoft is also retiring
SMTP AUTH client submission.

Graph app-only has none of those. The mailbox stays unlicensed, nothing holds a
user password, and the application's reach is fenced to one mailbox by Exchange
itself rather than by trusting the application to address its mail correctly.

The SMTP path is still there and still works. Graph is checked first, so an
environment with both configured uses Graph.

## What to set up

### 1. The mailbox

```bash
pwsh ./scripts/create-noreply-mailbox.ps1 \
  -MailboxAddress no-reply-aegis-id@vanguardcs.ca \
  -ReplyToAddress help-aegis-id@vanguardcs.ca
```

It creates the shared mailbox, hides it from the address list, and adds a mail
flow rule that bounces anything sent to it with a message pointing at the
operator address. `-WhatIfOnly` reports without changing anything.

### 2. The app registration

In Entra ID → App registrations → New registration. No redirect URI; this
application never signs a person in.

- **API permissions** → Microsoft Graph → *Application* permissions →
  `Mail.Send`. Then **Grant admin consent**. Application, not delegated: there
  is no signed-in user at the moment a sign-in code is sent.
- **Certificates & secrets** → New client secret. Copy it now; it is shown
  once.

Nothing else. `Mail.Send` alone is the point — the platform never reads a
mailbox, so it never asks to.

### 3. Fence it to the one mailbox

Granting `Mail.Send` as an application permission grants it for **every**
mailbox in the tenant. This is the step that takes it back:

```powershell
Connect-ExchangeOnline

New-ApplicationAccessPolicy `
  -AppId <application (client) id> `
  -PolicyScopeGroupId no-reply-aegis-id@vanguardcs.ca `
  -AccessRight RestrictAccess `
  -Description 'Aegis ID platform sender'

# Prove it. The first answers Granted, any other mailbox answers Denied.
Test-ApplicationAccessPolicy -Identity no-reply-aegis-id@vanguardcs.ca -AppId <application (client) id>
Test-ApplicationAccessPolicy -Identity help-aegis-id@vanguardcs.ca    -AppId <application (client) id>
```

Do not skip this. Without it the client secret in the environment can send as
anybody in the tenant.

The policy can take up to an hour to take effect, and `Test-…` reports the
intent before the cache catches up — so a 403 from Graph shortly after creating
it usually means "wait", not "wrong".

### 4. Point the environment at it

In `.env.local` for localhost, and as app settings on dev, qa and prod (the
deploy script forwards all five):

```
GRAPH_MAIL_TENANT_ID=<directory (tenant) id>
GRAPH_MAIL_CLIENT_ID=<application (client) id>
GRAPH_MAIL_CLIENT_SECRET=<the client secret>
GRAPH_MAIL_FROM_ADDRESS=no-reply-aegis-id@vanguardcs.ca
GRAPH_MAIL_FROM_NAME=Vanguard Aegis ID
```

`GRAPH_MAIL_FROM_ADDRESS` falls back to `SMTP_FROM_ADDRESS` when left blank, so
an environment that already names its sender need not name it twice.

With all four of tenant, client, secret and from-address present, Graph becomes
authoritative: it overrides the stored settings, turns email on, and the fields
at `/admin/notifications` become read-only with a callout saying so. The
per-message channel matrix on that page is still editable, because which kinds
of message may go over email is a policy decision, not a transport one.

**This is what makes localhost send real mail.** Without it, `local` runs the
`filesystem` transport and writes messages to `artifacts/mail/` instead —
useful, and what the end-to-end harness reads, but not an inbox.

### 5. Check it

`/admin/notifications` → **Test connection** acquires a token and reports
whether Entra accepted the credentials. That is all that can be checked without
sending: reading the mailbox back would need `User.Read.All`, and widening the
permission so a test button can be more confident is the wrong trade.

To check delivery, sign in and press **Send email code**.

## How it sends

[`src/adapters/notify/notification-adapter.js`](../src/adapters/notify/notification-adapter.js)
posts raw MIME to `/users/{from}/sendMail` rather than a Graph message
resource. A message resource carries one body and ours carry two — the plain
text part is what a text-only client, a screen reader in plain-text mode and
most spam filters read. `MailComposer` builds the `multipart/alternative`, and
nodemailer is already a dependency, so this adds nothing to install.

Tokens are cached per application until a minute before they expire. Asking for
a new one per message would make a sign-in code wait on a second round trip to
a second service, and Entra rate-limits the endpoint.

## When it fails

| What you see | What it is |
|---|---|
| `Microsoft Graph refused the client credentials: AADSTS7000215` | Wrong or expired client secret. |
| `Microsoft Graph refused the client credentials: AADSTS650057` / consent | `Mail.Send` was added but admin consent was not granted. |
| `rejected the message (403)` | The `ApplicationAccessPolicy` does not cover this mailbox — or it was created in the last hour. This is the failure that looks like a permissions bug and is a scoping one. |
| `rejected the message (404)` | `GRAPH_MAIL_FROM_ADDRESS` is not a mailbox in this tenant. |
| Nothing is sent and nothing fails | The transport is still `filesystem`. Check `artifacts/mail/` and whether all four `GRAPH_MAIL_*` values reached the process. |

Every attempt, successful or not, is on the delivery log at
`/admin/notifications` and on the evidence chain as `notification.dispatched`.
Neither records the message body or the code.
