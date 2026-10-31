# Microsoft 365 mail setup: no-reply sender and help inbox

These scripts set up an app to **send mail as a shared no-reply mailbox** and, optionally,
**read a shared help mailbox** through Microsoft Graph, on Exchange Online. They are the
commands the Wateridge Raccoon Raiders setup was done with, turned into re-runnable scripts
that read everything from the project's env file. You can copy the folder into another
project as it is.

The domain and every name come from the env file of the environment you pass, so one tenant can
host several apps and domains, for example `vanguardcs.ca` and `cloudstrucc.com`, without them
colliding.

## For an agent reading this

- **A person runs steps 1 to 4.** They sign in as a tenant admin in a browser and change the
  tenant's security, and step 2 creates a credential. Hand the person the commands. Don't run
  steps 1 to 4 yourself unless you pass `-DryRun` / `--dry-run`, which signs in to nothing and
  changes nothing. A dry run is how you check that the env file is complete.
- **Step 5 is safe for you to run.** It signs in as the app, not as a person, changes nothing in
  the tenant, and sends one email to the address given with `--to`.
- **Never print, log or commit `GRAPH_CLIENT_SECRET`.** Step 2 writes it straight into the
  gitignored env file, and refuses if the file isn't gitignored.
- Every step can be re-run. Each one skips what already exists. Exchange takes 15 to 60
  minutes to replicate new mailboxes, groups and policies, so "not found" or "Denied" right
  after creating something means wait and run it again. It does not mean the script is wrong.

## What gets built

| Thing | Where | Why |
|---|---|---|
| Shared mailbox `GRAPH_SENDER` | Exchange | The app sends as this address. No licence, no password. |
| Shared mailbox `EMAIL_HELP` (optional) | Exchange | People write to it; the app reads it; owners reply as it from Outlook. |
| App registration `M365_APP_NAME` | Entra | The app's identity: Graph **application** permissions `Mail.Send` (+ `Mail.ReadWrite` when there is a help inbox), admin-consented, and a client secret. |
| Security group `M365_SENDER_GROUP` | Exchange | A hidden, mail-enabled security group whose members are this app's mailboxes. |
| Application Access Policy | Exchange | Restricts the app to the group's members. Without it, `Mail.Send` reaches **every mailbox in the tenant**. |

Graph is used instead of SMTP AUTH because there's no stored user password, and Microsoft is
switching basic SMTP authentication off.

## Prerequisites (once per machine)

```bash
brew install --cask powershell   # pwsh, for the Exchange steps
brew install azure-cli           # az, for the app registration
```

The Exchange module installs itself on first use (`Install-Module ExchangeOnlineManagement
-Scope CurrentUser`). Run every command from the project root, the folder that holds the
`.env*` files.

## Env file keys

`--env dev` reads `.env.dev`, `qa` reads `.env.qa`, `local` reads `.env.local`, `prod` reads
`.env`. A literal path also works. The app itself only needs the keys marked **app**.
The `M365_*` keys are only for these scripts.

| Key | Required | Example | Meaning |
|---|---|---|---|
| `M365_DOMAIN` | yes* | `vanguardcs.ca` | Domain every address below lives on. *Defaults to `GRAPH_SENDER`'s domain. |
| `M365_APP_SLUG` | yes | `aegis` | Short lowercase name. Used in default addresses and the group name, so two apps on one tenant don't collide. |
| `M365_ADMIN_UPN` | no | `fpearson@cloudstrucc.com` | Admin to sign in to Exchange as. Without it, a picker opens. |
| `M365_MAILBOX_OWNERS` | no | `a@x.ca,b@x.ca` | People who can open the mailboxes in Outlook. Defaults to `M365_ADMIN_UPN`. |
| `M365_DISPLAY_NAME` | no | `Aegis` | Sender name recipients see. Defaults to the name in `EMAIL_FROM`, else the slug. |
| `M365_APP_NAME` | no | `Aegis Mailer` | Entra app registration name. Defaults to `<display name> Mailer`. |
| `M365_SENDER_GROUP` | no | `aegis-mail-senders@vanguardcs.ca` | Scope group. Defaults to `<slug>-mail-senders@<domain>`. |
| `M365_DMARC_RUA` | no | `dmarc@vanguardcs.ca` | DMARC report address. If it's on the domain and free, step 3 adds it to the no-reply mailbox. |
| `GRAPH_SENDER` | **app** | `aegis-noreply@vanguardcs.ca` | Mailbox the app sends as. Defaults to `<slug>-noreply@<domain>` on prod and `<slug>-<env>-noreply@<domain>` elsewhere. |
| `EMAIL_FROM` | **app** | `Aegis <aegis-noreply@vanguardcs.ca>` | Its address **must equal** `GRAPH_SENDER`; Graph refuses otherwise. The scripts check this. |
| `EMAIL_HELP` | **app**, optional | `aegis-help@vanguardcs.ca` | The help inbox. Leave it unset for send-only. |
| `GRAPH_TENANT_ID` `GRAPH_CLIENT_ID` `GRAPH_CLIENT_SECRET` | **app** | (written by step 2) | The app's credentials. |
| `GRAPH_CLIENT_SECRET_EXPIRES` | no | (written by step 2) | When the secret stops working. Rotate before then with `02 … --new-secret`. |

Use **one mailbox per environment** (the defaults already do), so a test on dev never emails real
people from the address they recognise. One app registration and one group serve all of them.

Example `.env.dev` block for a project on `vanguardcs.ca`:

```bash
M365_DOMAIN=vanguardcs.ca
M365_APP_SLUG=aegis
M365_ADMIN_UPN=fpearson@vanguardcs.ca
EMAIL_PROVIDER=graph
EMAIL_FROM=Aegis <aegis-dev-noreply@vanguardcs.ca>
GRAPH_SENDER=aegis-dev-noreply@vanguardcs.ca
EMAIL_HELP=aegis-dev-help@vanguardcs.ca
```

For `cloudstrucc.com`, change `M365_DOMAIN` and the addresses. If the two domains are on
**different tenants**, sign in to the right tenant at each step (`az login --tenant
cloudstrucc.com`; for Exchange, `M365_ADMIN_UPN` decides the tenant). Each tenant gets its own
app registration, so keep a separate env file per tenant.

## The steps

```bash
pwsh scripts/m365/01-check-domain.ps1 -Env dev          # domain on the tenant? prints DNS records (MX, SPF, DKIM, DMARC)
scripts/m365/02-app-registration.sh --env dev           # Entra app + Mail.Send (+Mail.ReadWrite) + consent + secret -> env file
pwsh scripts/m365/03-mailboxes.ps1 -Env dev             # shared mailboxes + owner access
pwsh scripts/m365/04-restrict-app.ps1 -Env dev          # security group + access policy + Granted/Denied test
scripts/m365/05-send-test.sh --env dev --to you@example.com   # token as the app, send one email, read help inbox
```

1. **Domain.** Adding a domain to the tenant can't be scripted, because Microsoft issues a
   verification TXT record only in the admin centre: admin.microsoft.com → Settings → Domains →
   Add domain. Step 1 then confirms the domain and prints the records it needs next to what DNS
   says now. It also creates the domain's DKIM keys so the two CNAMEs can be published. Once
   they resolve, run it again with `-EnableDkim`. Gmail and Yahoo expect DKIM and DMARC.
2. **App registration.** `az login --tenant <domain>` first, as an admin who can grant consent.
   It reuses an app already named `M365_APP_NAME`, so running it for dev and then for prod gives
   one registration. A new secret is created only when the env file has none, or when you pass
   `--new-secret`. To share dev's secret with prod, copy `GRAPH_CLIENT_SECRET` across.
3. **Mailboxes.** Creates the mailboxes and grants the owners access. The help mailbox accepts
   outside mail; owners can **Send As** it, and keep sent copies in its own Sent Items.
4. **Restrict.** Run this straight after step 2. Until it runs, the secret can reach every
   mailbox in the tenant. Expect `Granted` for the app's mailboxes and `Denied` for the admin.
   `-TestOnly` re-runs only the test.
5. **Prove it.** Then set `EMAIL_PROVIDER=graph` and deploy the app.

## Adding a mailbox later

Add the address to the env file, then run step 3 and step 4 again. Step 4 adds the new mailbox
to the group, so the existing policy covers it and nothing else changes. If you're adding a help
inbox to a send-only setup, also run step 2 again: it adds `Mail.ReadWrite` and re-consents.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `not a security principal` from step 4 | The group or mailbox is new and still replicating. | Wait 15–30 min and run it again. (A bare shared mailbox as the scope never works; the script scopes to the group for that reason.) |
| `Denied` for `GRAPH_SENDER` right after step 4 | The policy isn't applied yet. | Wait up to an hour, then run `-TestOnly`. |
| `AADSTS7000215` / 401 in step 5 or the app | The secret is wrong or expired. | `02 … --new-secret`, then redeploy. |
| `ErrorAccessDenied` / 403 on send | The mailbox isn't in the group, or the policy hasn't applied. | Step 4. |
| A literal `<client-id>` was used and PowerShell complained about `<` | That was a placeholder. | The scripts read `GRAPH_CLIENT_ID` from the env file, so nothing is pasted. |
| An `@` came out as `＠` (full-width) in a pasted command | Copy-paste from a rich-text source. | Run the script, don't paste the command. |
| Mail lands in junk | DKIM is off, or there is no DMARC record. | Step 1 with `-EnableDkim`; add the `_dmarc` TXT record. |

## Provenance

This mirrors what was run by hand for the Raiders on 2026-09-21 (dev, `cloudstrucc.com`) and
2026-10-25 (prod `noreply@` and `help@`, club domain). Those runs found two things the scripts
now handle: a policy needs a group, not a shared mailbox, as its scope, and the help inbox
needed `Mail.ReadWrite` and group membership on top of `Mail.Send`.
