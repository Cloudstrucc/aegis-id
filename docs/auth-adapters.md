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
| `cba` | Certificate / X.509 | Client-certificate auth, chain to configured trust anchors, CRL/OCSP revocation |

## Where things live

- `src/services/adapters/adapter-interface.js` — the contract + claim helpers.
- `src/services/adapters/{saml,kerberos,cba}-adapter.js` — protocol logic.
- `src/services/adapter-registry-service.js` — catalogue, per-org instance CRUD,
  deny-by-default validation, self-test, evidence logging.
- `src/routes/auth-adapters.js` — the `/admin/auth-adapters` admin surface.
- `views/pages/auth-adapters.hbs` — the operator UI (grid, create, self-test).

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

## Configuration & deploy

- Feature flag `ADAPTER_FRAMEWORK_ENABLED` — on by default off-prod; **off** in
  dev/qa/prod until a pilot turns it on, because it changes how people can
  authenticate.
- Stores: `AUTH_ADAPTER_STORE_PATH`, `AUTH_ADAPTER_STATE_STORE_PATH`. These are
  **new JSON stores**: on hosted environments they must live on the `/home` mount
  and are already added to `scripts/deploy-azure-webapp.sh` and the `.env.*`
  files, or a deploy would wipe them.

## Not yet (follow-ups)

- Wiring an adapter into the connected-app `/oauth2/authorize` upstream selection
  (today that path is Entra-specific; the adapters are reachable from the admin
  self-test surface and ready to plug in).
- WS-Federation adapter and provider presets (Entra/Okta/Keycloak/Google/Apple)
  over these protocol adapters.
- The per-org Integrations-blade surfacing and the journey builder (DID-in-journey
  step) from the Phase-1 mockups.
- CBA CRL/OCSP fetching (the mode and URL are captured; fetching is stubbed and
  reported as not-checked).
