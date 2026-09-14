# Custom Domains And White-Label Branding — Implementation Plan

Status: **in progress — phases A and B shipped** · Owner: platform · Target: Enterprise plan feature

## What this delivers

An organization can serve Aegis ID from its own hostname and under its own
name and logo:

- Holders and administrators of Contoso open `https://id.contoso.com`, not
  `vanguard-aegis-id-0e75d1.azurewebsites.net`.
- Every URL the platform emits for that organization — invitation links, QR
  codes, emails, the public organization page, the OIDC issuer its connected
  apps talk to, `did:web` — uses that host.
- The header, footer, home page, sign-in and every "Vanguard Cloud Services"
  label on that host show the organization's own logo and name instead.
- The default hostname keeps working exactly as today for everyone else.

Out of scope for this iteration: per-organization email sending domains
(SPF/DKIM), wallet **universal links** on custom hosts (see §9), and letting
one organization run more than one hostname.

## Where we start from

Three things already exist and are reused rather than rebuilt:

| Exists today | Where | Reused for |
|---|---|---|
| DNS domain verification (`_aegis-challenge` TXT, 14-day claim, rate limited) | `organization-identity-service.js` | The precondition for binding a hostname. A host is never served for an organization that has not proven it. |
| Per-organization branding: palette, colours, `logoDataUrl` | `org-admin-service.js` `branding`, dashboard **Branding** blade | Extended with display name and applied site-wide on the custom host, not only inside the workspace. |
| Connected-app issuer computed from a passed-in base URL | `connected-app-service.js` (`options.publicBaseUrl`, one signing keystore) | Per-host `iss` with the same JWKS. |

What blocks the feature today is one line: `config.app.publicBaseUrl`, read
in 33 places, is the only base URL the platform knows.

## 1. Data model

Extend the organization identity record (`organization-identities.json`):

```js
{
  workspaceId, handle, domain, status: 'verified', ...
  hosting: {
    hostname: 'id.contoso.com',          // must equal `domain` or a subdomain of it
    status: 'pending-dns' | 'pending-tls' | 'active' | 'error' | 'disabled',
    cnameTarget: 'vanguard-aegis-id-0e75d1.azurewebsites.net',
    asuidToken: '…',                     // App Service ownership TXT value
    certificateThumbprint: null,
    lastError: null,
    activatedAt: null,
    updatedAt
  }
}
```

Extend `branding` in the org-admin state:

```js
branding: {
  ...existing palette fields,
  logoDataUrl,
  displayName: 'Contoso',            // replaces "Vanguard Cloud Services" on the host
  productName: 'Contoso ID',         // replaces "Aegis ID" pill; optional, defaults to "Aegis ID"
  faviconDataUrl: '',
  supportEmail: '',                  // footer + /support on the host; optional
  poweredByHidden: false             // Enterprise may hide "Powered by Aegis ID"
}
```

Nothing new on `/home` is needed: both records live in stores that are
already forwarded by the deploy script. Add a **hostname → workspaceId index**
in memory at startup and refresh it on every write, because host resolution
runs on every request and must not read a JSON file each time.

## 2. Host resolution middleware

`src/middleware/site-context.js`, mounted before routes:

```
req.site = {
  kind: 'platform' | 'organization',
  hostname,
  baseUrl: `https://${hostname}`,      // what every emitted URL is built from
  workspaceId, subscriptionId,          // organization hosts only
  branding                               // resolved: org branding or platform default
}
res.locals.site = req.site
```

Rules:

- Hostname matches an `active` hosting record → organization site.
- Hostname is the platform host (`APP_PUBLIC_BASE_URL`) → platform site.
- Anything else → 404 page that names the expected hostname (this is what a
  customer sees while their CNAME is still propagating, and it must not leak
  another organization's branding).
- `X-Forwarded-Host` is trusted only from App Service (already the case for
  `req.protocol`; keep `trust proxy` as configured).

**Base URL becomes per request.** Replace the 33 `config.app.publicBaseUrl`
reads with `req.site.baseUrl` where a request exists, and with an explicit
`baseUrl` argument in services (most already accept one — see
`connected-app-service.js`). Background jobs that emit URLs (credential
import, notification delivery) receive the organization's base URL from the
record they are working on: `hosting.status === 'active'` → custom host, else
platform host. A helper `baseUrlForWorkspace(workspaceId)` centralises that
and is the *only* place that decides.

## 3. What an organization host serves

| Path on `id.contoso.com` | Behaviour |
|---|---|
| `/` | The organization's public page (today `/orgs/<handle>`), branded — not the Aegis marketing home. |
| `/auth/*`, `/dashboard/*`, `/organizations/*` | Same routes, same policies. Sign-in is the platform's; the host only changes branding and base URL. |
| `/wallet/credential-invitations/*`, `/api/wallet/*` | Served, with emitted links on this host. |
| `/oauth2/*`, `/.well-known/openid-configuration`, `/oauth2/jwks` | Served with `iss = https://id.contoso.com/oauth2`. Same signing keys. |
| `/.well-known/did.json` | The organization's DID document — this is what makes `did:web:id.contoso.com` real. |
| `/.well-known/apple-app-site-association`, `/assetlinks.json` | Served, but see §9 — the apps do not list this host, so they are inert. |
| `/subscribe`, `/plans`, `/auth/register` (new subscriber), `/admin/*` | **Not served** on organization hosts — redirect to the platform host. A customer's domain is not a place to sell Aegis plans or administer the platform. |
| `/orgs/<other-handle>` | Redirect to the platform host. One organization's domain does not vouch for another. |

Cross-organization isolation is enforced by the existing authorization
service; the host adds a second check: a workspace route on an organization
host whose `workspaceId` is not the host's → 404, even for a user who is a
member of both.

## 4. OIDC issuer per host

- `iss` is derived from `req.site.baseUrl` at authorization time and stored on
  the authorization code / session, so the token endpoint (which may be hit
  from a server without a browser) signs with the issuer the flow started on.
- Discovery and JWKS are served on every host; JWKS content is identical.
- A connected app **belongs to one issuer**. When an organization activates a
  host, its existing connected apps keep the platform issuer until the
  administrator moves them (a per-app "Issuer" setting: platform / custom), so
  nothing breaks on activation. New connected apps created on the custom host
  default to it.
- `oidc-provider-service.js` (the wallet sign-in issuer, `…/oidc`) follows the
  same rule.

## 5. DNS, hostname and TLS provisioning

Flow, from the domain page after verification:

1. Administrator enters the hostname (must be the verified domain or under it)
   and presses **Use this domain**.
2. The page shows two records to add: `CNAME id → <app>.azurewebsites.net` and
   `TXT asuid.id → <asuid>` (App Service's ownership proof). Status
   `pending-dns`.
3. **Check** (rate limited like verification): resolve CNAME and TXT. When both
   are right, the platform calls Azure:
   - `PUT …/sites/{app}/hostNameBindings/{hostname}` (add hostname)
   - `PUT …/sites/{app}/…/managedCertificates` (free App Service Managed
     Certificate, CNAME-validated)
   - bind the certificate (SNI)
   Status `pending-tls` until the certificate is issued (minutes), then
   `active`. Polled by a short server-side job and by the page.
4. Deactivating removes the binding and the certificate; the record stays so
   re-activation is one click.

Authentication to Azure: the App Service's **system-assigned managed
identity**, granted `Website Contributor` on itself only. No credentials in
the app. The Business Expenses app is untouched; it stays on the platform host.

Limits to state in the UI: App Service supports hundreds of hostnames per app
and managed certificates cover one hostname each (no wildcard) — fine for one
host per organization. `*.azurewebsites.net` remains the platform host.

Local and dev: `hosting` provisioning is a no-op behind
`CUSTOM_HOSTING_PROVIDER=azure|none`; `none` marks the record `active`
immediately so the host middleware can be exercised with `/etc/hosts`.

## 6. Branding, site-wide

- `site-header.hbs`, `site-footer.hbs`, `home.hbs`, `auth-*.hbs`, `error.hbs`,
  `not-found.hbs`, `subscribe*.hbs` and the layout `<title>` read
  `site.branding.displayName`, `productName`, `logoDataUrl`, `faviconDataUrl`
  and palette variables instead of literals. On the platform host these
  resolve to the Vanguard defaults from config, so nothing changes there.
- Emails: the `deliverMessage` templates take a `branding` argument (name,
  logo, base URL) resolved by `baseUrlForWorkspace`, so an invitation sent by
  Contoso is signed Contoso and links to `id.contoso.com`.
- QR codes and `aegisid://` links carry `vanguard_web_app_url=https://id.contoso.com`
  — the wallets already store this per organization and use it for that
  organization's calls.
- "Powered by Aegis ID" in the footer, hideable on Enterprise.
- The Branding blade gains: display name, product name, favicon, support
  email, powered-by toggle, and a **preview on your domain** link.

## 7. Plan gating and limits

`plan-service.js`: `customDomain: false | true` per plan (Enterprise only),
enforced at the single point that activates hosting (`activateHosting`),
returning **402** like the credential ceiling. Branding beyond palette/logo
(display name, product name, hiding powered-by) is gated the same way; a
lapsed plan reverts the host to `disabled` and emitted URLs to the platform
host — existing credentials keep working, only the vanity host stops, matching
"a billing event must not revoke somebody's identity credential".

## 8. Security review points

- **Host header is untrusted input.** Resolution is an exact match against the
  index; no substring matching, no `Host` echoed into markup unescaped.
- **Cookies are per host** — sessions do not cross hosts, which is what we want.
- **Passkeys are bound to `rpId`.** A passkey registered on the platform host
  cannot be used on the organization host and vice versa. Announce this on
  activation and in the holder's sign-in page ("register a passkey for this
  site"). No attempt to share credentials across hosts.
- **CSRF / origins:** the passkey origin check (`auth.js` `getPasskeyRequestInfo`)
  already uses the request host; connected-app `allowedOrigins` are per app.
- **Open redirect:** the platform-host redirects in §3 are to a fixed
  configured base, never to a value from the request.
- **Impersonation:** a host can only be bound to a *verified* domain, and the
  public page on that host still shows the handle. Withdrawing verification
  (`revokeVerification`) also disables hosting.
- Audit: `organization.hosting.requested|activated|disabled|failed`, with the
  actor, on the evidence chain like domain verification.

## 9. Mobile apps — the honest limits

- **Universal links / App Links** on custom hosts: Apple's associated domains
  and Android's `assetlinks` are compiled into the app for named hosts; they
  cannot be added per customer at runtime. Custom-host organizations therefore
  get `aegisid://` scheme links (already supported everywhere). Their holders
  see the "Open in Aegis Wallet?" prompt rather than a silent hand-off. State
  this in the activation UI.
- **Passkey autofill (`webcredentials`)** is off in the shipped wallets anyway.
- The wallets need **no change**: `vanguard_web_app_url` per organization is
  already honoured for that organization's API calls.

## 10. Delivery plan

| Phase | Work | Size |
|---|---|---|
| **A. Base URL per request** — *done* | `site-context` middleware; the 33 `publicBaseUrl` reads replaced; `baseUrlForWorkspace`; `tests/site-context.test.js` forbids a new direct read. No behaviour change. | 2–3 days |
| **B. Branding site-wide** — *done* | `displayName`, `productName`, `faviconDataUrl`, `supportEmail`, `poweredByHidden` on org branding and the Branding blade; header, footer, layout title, home, sign-in, register, subscribe and not-found read `site.branding`; `deliverMessage` names the brand from `context.branding`. Platform host unchanged; organization values take effect on their host in C. | 2 days |
| **C. Host resolution + routes** | Hosting record, index, organization-host routing table (§3), per-host OIDC issuer (§4), DID document on host, isolation check, `CUSTOM_HOSTING_PROVIDER=none` for local. | 3–4 days |
| **D. Azure provisioning** | Managed identity + role, hostname binding, managed certificate, status polling, deactivate; DNS instructions page reusing the verification UI. | 2–3 days |
| **E. Plan gating, docs, e2e** | 402 enforcement, lapse handling, operator guide + help page, e2e journey on a custom host with `/etc/hosts`. | 1–2 days |

Roughly **two weeks** for one engineer. A and B are safe to ship on their own
and are worth doing first regardless — A removes the single-host assumption,
B is what customers ask for most visibly.

## 11. Acceptance

- Contoso verifies `contoso.com`, binds `id.contoso.com`, and within ten
  minutes `https://id.contoso.com/` serves their branded public page over a
  valid certificate.
- An invitation issued by Contoso links to `id.contoso.com`, the QR decodes to
  it, the email carries their name and logo, and the wallet redeems it.
- A Contoso connected app moved to the custom issuer completes sign-in with
  `iss = https://id.contoso.com/oauth2`; one left on the platform issuer keeps
  working unchanged.
- `curl https://id.contoso.com/orgs/<other-handle>` → 302 to the platform host.
- `curl -H "Host: unknown.example" https://<app>` → 404 with no branding.
- Deactivating hosting, or the plan lapsing, returns every emitted URL to the
  platform host without touching a credential.
- The platform host is pixel-identical to today throughout.
