# Sign in with the Aegis wallet, from Microsoft Entra

**Status: draft for review. Nothing here is built yet.**

The ask is one sentence — *let an Entra tenant treat the Aegis wallet as a
passkey or as an MFA option* — but Entra offers three different doors, and only
one of them is the thing most people mean. This plan says which door does what,
which one to build first, and what in this repo is already there versus
genuinely missing.

---

## 1. What Entra actually allows

| | Workforce Entra ID | Entra External ID (CIAM) |
|---|---|---|
| **Second factor (MFA)** | **External authentication method (EAM)**. Documented, GA-path, driven by a Conditional Access policy. **This is the headline demo.** | CA exists in external tenants; whether EAM is offered there has to be confirmed in a live tenant (see §6). |
| **First factor ("sign in with…")** | Not reachable by EAM. Only by domain federation, which replaces sign-in for a whole verified domain — far too blunt for a demo. | **Custom OIDC identity provider.** Gives a literal *Sign in with Aegis ID* button on the sign-in page. Preview feature. |
| **A real passkey** | Wallet registers as a FIDO2 credential with Entra. No Aegis server integration at all — but **blocked in the wallets**, see Track C. | Same, and Entra refuses passkey registration for guest and B2B users. |

Three tracks, and they are independent — A and B can ship in either order.

- **Track A — EAM (workforce, MFA).** The wallet becomes a second factor that a
  Conditional Access policy can require. This is the demo that will land with an
  enterprise audience, and it is the one with a published contract to build
  against.
- **Track B — custom OIDC IdP (External ID, first factor).** The wallet becomes
  a sign-in button for a customer-facing app. This is the one that *looks* like
  "passkey" to an audience.
- **Track C — real FIDO2 passkey.** No *platform* work, but **blocked in the
  wallets today**. `docs/wallet-passkey-provider.md` is explicit: neither wallet
  ships the credential provider in 1.0, and on both platforms the end-to-end
  path is unfinished — iOS registration is rejected by Safari with a bare
  `NotAllowedError` after the extension hands the credential over, and on
  Android registration succeeds but the *assertion* is rejected. The
  cryptography verifies against `@simplewebauthn/server` on both. Until those
  two are closed, Track C cannot be demonstrated at all.

The sharpest demo would be A and C side by side — the same wallet satisfying a
Conditional Access MFA requirement *and* holding a passkey, two mechanisms doing
different jobs. A is reachable now; C is not.

---

## 2. What Entra requires of us (Track A)

EAM is OIDC's implicit flow, used in one narrow way. The contract:

**Entra → us.** An HTTP `POST` to our `authorization_endpoint`, form-encoded:

| Parameter | Value |
|---|---|
| `scope` | `openid` |
| `response_type` | `id_token` |
| `response_mode` | `form_post` |
| `client_id` | the app registration's application ID |
| `redirect_uri` | `https://login.microsoftonline.com/common/federation/externalauthprovider` |
| `nonce`, `state` | echo both back |
| `id_token_hint` | an **already-expired**, Entra-signed JWT naming the user |
| `claims` | a JSON blob requesting `acr` and `amr` |

**Us → Entra.** An HTML form that `POST`s `id_token` and `state` to that
`redirect_uri`. Our `id_token` must carry:

- `iss` — character-for-character the issuer in our discovery document
- `aud` — Entra's `client_id`
- `sub` — **the `sub` from the `id_token_hint`, unchanged**
- `nonce` — as sent
- `acr` — one of the values Entra requested (`possessionorinherence`)
- `amr` — an array with **exactly one** value

Failure is `error=access_denied` posted to the same place. Entra abandons the
attempt after ~5 minutes.

### The claim we are allowed to make

`amr` is not decoration — Entra uses it to check the second factor is a
*different type* from the first. The repo already models exactly this
distinction in `resolveChallengeAssurance` (`src/services/wallet-challenge-service.js`):

| Aegis assurance | `amr` | Entra's type |
|---|---|---|
| `wallet` — approved from a registered wallet, device key | `hwk` | possession |
| `passkey` — approval gated on passkey with user verification | `fido` | possession |

So the `amr` is **derived from the challenge that was actually answered**, never
a constant. An organization with `walletApprovalPasskeyPolicy: 'required'`
genuinely gets the stronger claim; one without does not. Hard-coding `fido`
would be asserting a verification that did not happen.

---

## 3. What already exists here

More than I expected. The connected-app OAuth provider is most of an EAM
provider already:

| Need | Where it is | State |
|---|---|---|
| OIDC discovery document | `connected-app-service.js:getDiscovery` | ✅ `/oauth2/.well-known/openid-configuration` |
| JWKS endpoint | `getJwks`, `/oauth2/jwks` | ⚠️ see §4 |
| RS256 signing | `getActiveSigningKey`, `signTokenSet` | ✅ |
| Wallet challenge gating a sign-in | `maybeCreateSignInChallenge` | ✅ |
| Wallet approve **and decline** | `wallet-challenge-service` | ✅ |
| Evidence on the ledger | `logConnectedAppEvent` | ✅ |
| Deny-by-default policy for public endpoints | `authorization-service.js` → `api.connectedApps.oauth` | ✅ pattern to copy |
| Validating an Entra-issued token | `upstream-idp-service.js` (`createRemoteJWKSet`, `jwtVerify`) | ✅ reusable, *opposite direction* |

Note the last one: the repo already federates **to** Entra. EAM is the same
machinery pointed the other way, and `upstream-idp-service.js` is the file to
read first.

The **other** OIDC provider — `src/routes/oidc-provider.js` — signs with
`alg: 'none'` and publishes no JWKS. It is the wallet demo, not a basis for
this. Do not build on it.

---

## 4. The four real gaps

These are the things that will fail a live integration, in the order they will
bite.

**1. `x5c` is missing from our JWKS, and Entra requires it.**
`getActiveSigningKey` generates a bare RSA keypair and exports a JWK with
`kid`/`alg`/`use`. Entra's documentation is explicit: *"The JWK `x5c` parameter
must be present to provide X.509 representations of provided keys."* A raw RSA
JWK is a valid JWKS and still fails EAM. We need a certificate, not just a key.
Two options:

- *Self-signed cert alongside the key.* Node cannot mint X.509 on its own, so it
  means a dependency (`@peculiar/x509`). Smallest change.
- *Azure Key Vault certificate.* `@azure/keyvault-keys` is already a dependency
  and `did-web-service.js` already signs through Key Vault. This gives `x5c`
  naturally and makes rollover an operation rather than a code path.

Recommend Key Vault, consistent with how did:web keys are already handled.

**2. `sub` must be echoed, not derived.**
Everything in the connected-app provider derives `sub` from the Aegis account
(`normalizeSubject` on the email). EAM requires the `sub` of the
`id_token_hint`. Entra will reject anything else. The Aegis identity goes in a
private claim, not in `sub`.

**3. `form_post` auto-submit versus our CSP.**
The response is an HTML form posted back to Microsoft. The usual trick is an
inline `<script>` that submits on load — and our CSP is `script-src 'self'`,
which blocks it. Either add a small served script under `/public`, or render a
form with a real "Continue" button. The button is arguably better for a demo
anyway: the audience sees the hand-off.

**4. Five minutes, and a human holding a phone.**
Entra abandons the attempt after ~5 minutes. The wallet challenge TTL defaults
to 900s. The EAM path must use a TTL inside Entra's window and fail cleanly —
`error=access_denied` — rather than leaving the browser on a spinner Entra has
already given up on.

### One more, about the security boundary

The EAM authorize endpoint is public by necessity, exactly like the Stripe
webhook. Its entire security boundary is the `id_token_hint` signature check: an
unvalidated hint is an attacker telling us which user to approve. Validate
issuer, audience (`aud` must be *our* client ID), signature against Entra's
`common` JWKS — and **skip `exp`**, because the hint is issued expired on
purpose. That exception needs a comment in the code saying why, or someone will
"fix" it later.

---

## 5. Build plan

### Phase 0 — prove the contract (half a day, no product code)
Register the multitenant app in Entra. Point the EAM at a throwaway endpoint
that logs the request and immediately posts back `error=access_denied`. Confirm
a Conditional Access policy with **Require multifactor authentication** actually
routes to it. This surfaces the two errors everyone hits — `IDSTS50161`
(authorization endpoint not registered as a reply URL) and `AADSTS900491`
(admin consent not granted) — before any of our code is in the way.

### Phase 1 — the provider endpoints
New `src/services/entra-eam-service.js` and `src/routes/entra-eam.js`:

- `POST /eam/authorize` — validate `id_token_hint`, resolve the Entra user to an
  Aegis account, raise a wallet challenge, show the approval page
- `GET /eam/authorize/:challengeId/status` — the poll the existing sign-in page
  already does
- `POST /eam/complete` — mint the `id_token`, render the form post

Discovery: `/eam/.well-known/openid-configuration`, issuer `https://<host>/eam`.
Entra's rules permit a path prefix before `/.well-known/...` as long as the
issuer matches it exactly. A separate issuer from `/oauth2` keeps the EAM
contract (implicit, `id_token` only) from distorting the relying-party one.

Two new deny-by-default policies in `authorization-service.js`, mirroring
`api.connectedApps.oauth`: one `external` for the Entra-facing endpoints, one for
the wallet's answer.

### Phase 2 — identity resolution
Match the Entra user to an Aegis account. `oid` + `tid` are the stable pair
Microsoft recommends; `preferred_username` is display-only and must not be the
join key. Store the mapping on the organization — it is organization-scoped
configuration, so it belongs under `/orgs/:handle/settings/`, not `/admin`.

**An unmatched user is refused, never provisioned.** This is the same rule the
repo already states for Entra sign-in — *"it must never auto-provision an
account"* — and EAM is the same hazard wearing a different hat.

### Phase 3 — administration and evidence
An organization-scoped settings page for the EAM connection: Entra tenant ID,
client ID, the discovery URL to paste into Entra, enable/disable. Every
authorize, approve, decline, refusal and timeout onto the evidence chain through
`logConnectedAppEvent`, carrying the Entra `tid`/`oid` and the wallet ID.

### Phase 4 — Track B, External ID
Register Aegis as a custom OIDC identity provider in the external tenant. This
one uses the **authorization-code** flow, which the connected-app provider
already speaks — so Track B may need no new protocol code at all, just a
connected app configured for the external tenant's redirect URI and a user flow
pointed at it. Confirm in a live tenant before committing to that: the feature
is in preview and the public reports of it conflict.

### Phase 5 — Track C, passkey
**The Entra half is configuration; the wallet half is unfinished work, and it is
the long pole.**

Entra, perhaps fifteen minutes: opt in to passkey profiles, **Enforce
attestation = No** and **Enforce key restrictions = No** (the wallet attests
`none` and reports an all-zero AAGUID, which is the correct value for an
unattested credential and cannot meaningfully appear in an allow-list), allow
self-service set-up, then register at Security info. Worth doing now with a
security key or Microsoft Authenticator, because it proves the policy
independently of the wallet.

The wallet, unbounded: ship the provider — `providesPasskeysForOtherServices`
on iOS, `passkeyProviderEnabled` on Android — **and first close the two
end-to-end failures**, which are the real work. Neither is a flag flip.

Note also that Entra refuses passkey registration for guest and B2B
collaboration users, so the demo account must be a member of the tenant.

---

## 6. Open questions — these need a live tenant, not more reading

1. **Does EAM exist in External ID tenants?** The EAM documentation is written
   for workforce. If it does, Track B gains an MFA story too; if not, External ID
   is first-factor only and we should say so rather than imply otherwise.
2. **Is the custom OIDC IdP still preview, and does it work?** Microsoft's own
   Q&A threads contradict each other on whether the Custom tab works in external
   tenants. Thirty minutes in a tenant settles it.
3. ~~**AAGUID allow-listing.**~~ **Answered.** Entra accepts an unattested
   third-party provider as long as the passkey profile has **Enforce
   attestation** off and **Enforce key restrictions** off; no FIDO metadata
   service entry is needed. Microsoft says outright to treat AAGUID lists as a
   policy guide rather than a security control when attestation is off — which
   is the only honest reading for an authenticator reporting sixteen zero bytes.
   So Track C is not a certification project. It is a wallet bug-fixing project.
4. **Which tenant hosts the multitenant app registration?** It is a published
   artefact of the product, not a per-environment one — the same shape as the
   App Store Connect credentials, which live in `.env.ios` for exactly that
   reason.

## 7. Prerequisites

- Microsoft Entra ID **P1** for Conditional Access
- An Entra tenant for the multitenant app registration, with `openid` and
  `profile` delegated Graph permissions, no published scopes, and the EAM
  `authorization_endpoint` added as a reply URL
- Admin consent in each tenant that uses the method
- A publicly reachable HTTPS Aegis — dev or qa is sufficient

## 8. What I'd cut if this has to be small

Phases 0 to 1 alone make a demo: a Conditional Access policy that visibly routes
to Aegis and a wallet approval that satisfies it. Phases 2–3 are what make it a
product. Phase 5 is not a shortcut to either — it reads like the cheapest item
on this list and is in fact the only one with an open bug on both platforms.
