# Authentication Adapters (SAML 2.0, Kerberos/SPNEGO, CBA)

Authentication adapters are inbound ("upstream") plugins that let an external
identity protocol front connected-app sign-in. They generalize the single,
Entra-only upstream path in `upstream-idp-service.js` into a registry of many
configured instances across several protocols. Aegis remains the policy decision
point: an adapter only supplies normalized claims; the issuing of tokens and the
enforcement of journeys stay inside Aegis.

Phase 1 ships three out-of-the-box protocols — the SSC ITC **M4** classic-protocol
baseline:

| Kind | Protocol | Model |
|---|---|---|
| `saml` | SAML 2.0 | SP-initiated SSO, signature + conditions verified with `@node-saml/node-saml`, attribute mapping |
| `kerberos` | Kerberos / SPNEGO | SPNEGO-terminating reverse proxy forwards the authenticated principal in a header |
| `cba` | Certificate / X.509 | Client-certificate auth, chain to configured trust anchors; revocation reported honestly (CRL/OCSP fetching stubbed) |

## Where things live

- `src/services/adapters/adapter-interface.js` — the contract + claim helpers.
- `src/services/adapters/{saml,kerberos,cba}-adapter.js` — protocol logic.
- `src/services/adapter-registry-service.js` — catalogue, per-org instance CRUD,
  deny-by-default validation, self-test, evidence logging.
- `src/services/adapter-signin-service.js` — bridges a designated active adapter
  into the connected-app OAuth flow (begin authorization, complete SAML POST,
  complete header-forwarded Kerberos/CBA, mint the connected authorization code).
- `src/routes/auth-adapters.js` — the `/admin/auth-adapters` admin surface.
- `src/routes/connected-oauth.js` — `/oauth2/authorize` fronting plus the
  adapter callback routes (see *Connected-app sign-in wiring* below).
- `views/pages/auth-adapters.hbs` — the operator UI (grid, create, self-test).
- `tests/auth-adapters.test.js` — unit coverage (see *Tests* below).

## Security properties

- **Deny-by-default.** An instance whose config does not validate is kept as a
  `draft` and cannot authenticate anyone. Only a validating (or a passing live
  self-test) instance becomes `active`.
- **Trusted-proxy boundary.** The Kerberos and certificate adapters refuse to
  activate without a trusted-proxy allowlist, and at runtime reject a forwarded
  header / certificate from any source outside it — a forwarded header is only as
  trustworthy as who may set it.
- **Secrets by reference.** Signing certificates and trust anchors are public
  material and stored as-is; anything key-shaped is refused and redacted.
- **Revocation honesty.** CBA reports revocation as *not checked* unless a CRL is
  configured, rather than implying a check that did not happen.
- **Evidence.** Every create, update, delete and self-test is written to the
  audit chain with the acting administrator.

## Self-test

Each adapter has a self-test reachable from the admin page:

- **SAML** — paste a signed `SAMLResponse` (full verify + map) or IdP metadata
  (parse entityID / SSO URL / signing cert), else a config sanity check.
- **Kerberos** — a sample principal (`user@REALM` or `DOMAIN\user`) is mapped to
  claims as if forwarded from a trusted proxy.
- **CBA** — paste a client certificate (PEM) to validate the chain and mapping.

## Connected-app sign-in wiring

A single active adapter may be designated the **sign-in default** (set/cleared
from the admin page; only an `active`, `firstFactor` instance is eligible). When
one is, it fronts connected-app sign-in ahead of the Entra upstream path:

- `/oauth2/authorize` checks `isAdapterSignInActive()` first. If a default
  adapter is set, it calls `beginAuthorization` and redirects — SAML to the IdP
  SSO URL, Kerberos/CBA to `/auth/adapters/<kind>/<id>/sso`.
- `POST /auth/adapters/saml/:id/acs` receives the signed SAML Response, verifies
  it and maps claims.
- `GET /auth/adapters/:kind/:id/sso` handles the Kerberos/CBA header-forwarded
  flow, reading the principal or client certificate from the trusted proxy.
- On success `finish` calls `createConnectedAuthorizationCode` with the mapped
  claims and redirects back to the relying party with `code` + `state`, exactly
  as the Entra path does. `oauth.adapter.redirected` and
  `oauth.adapter.completed` are written to the evidence chain.

The flow state is single-use, TTL-bound (`AUTH_ADAPTER_STATE_STORE_PATH`), and
the deny path (no/invalid forwarded principal or certificate) returns 401
without minting a code.

## Configuration & deploy

- Feature flag `ADAPTER_FRAMEWORK_ENABLED` — on by default off-prod; **off** in
  dev/qa/prod until a pilot turns it on, because it changes how people can
  authenticate.
- Stores: `AUTH_ADAPTER_STORE_PATH`, `AUTH_ADAPTER_STATE_STORE_PATH`. These are
  **new JSON stores**: on hosted environments they must live on the `/home` mount
  and are already added to `scripts/deploy-azure-webapp.sh` and the `.env.*`
  files, or a deploy would wipe them.

## Tests

`tests/auth-adapters.test.js` covers the framework at the unit level. It
redirects every `*_STORE_PATH` (adapters, states, audit) to a tmp dir **before**
requiring config, and disables the audit chain, so it never touches real state.
It is part of the root `npm test` suite.

Coverage:

- **SAML** — `validateConfig` (required fields), `mapClaims` (attribute mapping →
  normalized claims), `parseMetadata` (entityID / SSO URL / signing cert).
- **Kerberos** — trusted-proxy allowlist (`isTrustedProxy`), `parsePrincipal`
  (`user@REALM` and `DOMAIN\user`), and that `completeAuthorization` throws 403
  for an untrusted proxy.
- **CBA** — `validateConfig` (refuses without trust anchors / trusted proxy),
  header rejection from an untrusted proxy, and a real OpenSSL-built chain
  validated end to end (skipped if `openssl` is absent).
- **Registry** — draft-vs-active on create (invalid config parks as `draft`), and
  self-test promotion (a passing live test moves `draft` → `active`).

## Not yet (follow-ups)

- WS-Federation adapter and provider presets (Entra/Okta/Keycloak/Google/Apple)
  over these protocol adapters.
- The per-org Integrations-blade surfacing and the journey builder (DID-in-journey
  step) from the Phase-1 mockups.
- CBA CRL/OCSP fetching (the mode and URL are captured; fetching is stubbed and
  reported as not-checked).
