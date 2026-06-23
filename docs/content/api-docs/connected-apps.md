# Connected Apps

Connected Apps let an organization register relying-party applications that use Vanguard Aegis ID as an OIDC/OAuth provider and as a high-assurance wallet challenge API.

This is different from the generic OIDC/SAML integration wizard. That wizard connects Aegis ID to an external identity provider. Connected Apps let external applications connect to Aegis ID.

## What Connected Apps Provide

- OIDC discovery at `/oauth2/.well-known/openid-configuration`
- Authorization-code flow for browser and mobile sign-in
- Client-credentials flow for server-to-server calls
- CIBA-style backchannel authentication for decoupled wallet sign-in
- Client secrets for pilot and standard app integrations
- Certificate fingerprint authentication for certificate-backed clients
- Wallet challenge API for approvals, signatures, role changes, and other high-value decisions
- Per-app authentication, API, and wallet event logs
- CSV export for connected-app logs
- Admin-managed callback URIs, grant types, scopes, JWT claims, branding, and onboarding mode

## RBAC Model

Connected Apps use the central authorization service.

Required policies:

- `connectedApps.view`: view app registrations and logs
- `connectedApps.manage`: create and update app registrations
- `connectedApps.credentials.manage`: generate secrets, revoke secrets, and import certificates
- `connectedApps.logs.export`: export connected-app logs to CSV
- `developerApiDocs.view`: view internal API documentation and OpenAPI JSON
- `api.connectedApps.oauth`: use public OAuth/OIDC endpoints
- `api.connectedApps.client`: use client-authenticated connected-app APIs

The route-level guard is mandatory. Mutating routes must call `authorize(...)`; the route security tests fail if a new mutating route is not explicitly protected.

## Admin Journey

1. Sign in as an organization admin.
2. Open the organization workspace.
3. Open the `Connected apps` blade.
4. Register a relying-party app.
5. Add callback URIs and allowed origins.
6. Choose grant types:
   - `authorization_code` for user sign-in
   - `client_credentials` for server-to-server APIs
   - `urn:openid:params:grant-type:ciba` for decoupled wallet sign-in
7. Choose the sign-in challenge policy:
   - no sign-in wallet challenge
   - wallet approval at sign-in
   - wallet plus passkey at sign-in
   - verified credential at sign-in
8. Choose claims to release in tokens.
9. Generate a one-time client secret or import a certificate PEM.
10. Give the relying party the OIDC discovery URL.
11. Use the app logs and wallet challenge ledger to audit activity.

## Relying-Party OIDC Setup

Use the discovery document:

```text
https://<aegis-host>/oauth2/.well-known/openid-configuration
```

Use authorization-code flow:

```text
GET /oauth2/authorize
  ?client_id=<client-id>
  &redirect_uri=<registered-callback>
  &response_type=code
  &scope=openid profile email
  &state=<opaque-state>
  &nonce=<opaque-nonce>
```

Exchange the code:

```bash
curl -X POST https://<aegis-host>/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "client_id=<client-id>" \
  -d "client_secret=<client-secret>" \
  -d "code=<authorization-code>" \
  -d "redirect_uri=<registered-callback>"
```

If the connected app requires a sign-in wallet challenge, the authorization code is created in a `pending_challenge` state. The relying party exchanges the code only after the wallet decision completes. Until then, the token endpoint returns an OAuth-style error:

```json
{
  "error": "authorization_pending",
  "error_description": "Wallet challenge approval is pending."
}
```

If the wallet declines the challenge, the token endpoint returns `access_denied`. If the challenge expires, it returns `expired_token`.

## Upstream Entra Federation

Connected Apps can optionally use Aegis ID as an OIDC broker in front of Microsoft Entra ID. In that pattern, the relying application still trusts Aegis ID. Aegis validates the connected-app request, redirects the user to Entra for workforce sign-in, validates the upstream ID token, maps the user to an Aegis subject, applies Aegis policy, and then issues Aegis tokens back to the relying application.

Enable the broker by setting:

```env
CONNECTED_APP_UPSTREAM_IDP_MODE=entra
CONNECTED_APP_UPSTREAM_ENTRA_TENANT_ID=<entra-tenant-id>
CONNECTED_APP_UPSTREAM_ENTRA_CLIENT_ID=<entra-app-client-id>
CONNECTED_APP_UPSTREAM_ENTRA_CLIENT_SECRET=<entra-app-secret>
CONNECTED_APP_UPSTREAM_ENTRA_REDIRECT_URI=https://<aegis-host>/oauth2/upstream/entra/callback
CONNECTED_APP_UPSTREAM_ENTRA_SCOPES=openid profile email
CONNECTED_APP_UPSTREAM_ENTRA_ISSUER=https://login.microsoftonline.com/<entra-tenant-id>/v2.0
CONNECTED_APP_UPSTREAM_ENTRA_AUTHORIZATION_ENDPOINT=https://login.microsoftonline.com/<entra-tenant-id>/oauth2/v2.0/authorize
CONNECTED_APP_UPSTREAM_ENTRA_TOKEN_ENDPOINT=https://login.microsoftonline.com/<entra-tenant-id>/oauth2/v2.0/token
CONNECTED_APP_UPSTREAM_ENTRA_JWKS_URI=https://login.microsoftonline.com/<entra-tenant-id>/discovery/v2.0/keys
```

Detailed implementation runbooks:

- [Entra upstream OIDC broker build book](/developer/docs/integrations/entra-upstream-oidc-broker)
- [Power Pages and Aegis ID OIDC build book](/developer/docs/integrations/power-pages-aegis-oidc)

## Client Credentials

For service-to-service access:

```bash
curl -X POST https://<aegis-host>/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=<client-id>" \
  -d "client_secret=<client-secret>" \
  -d "scope=aegis.wallet_challenge"
```

For certificate-backed clients, import a certificate PEM in the Connected Apps blade and send its SHA-256 fingerprint:

```bash
curl -X POST https://<aegis-host>/api/connected-apps/wallet-challenges \
  -H "x-aegis-client-id: <client-id>" \
  -H "x-aegis-certificate-sha256: <certificate-sha256-fingerprint>" \
  -H "Content-Type: application/json" \
  -d '{"subject":"person@example.com","action":"approve-expense"}'
```

## CIBA-Style Backchannel Wallet Sign-In

For applications that want a decoupled sign-in or approval experience, enable the `urn:openid:params:grant-type:ciba` grant type and call:

```bash
curl -X POST https://<aegis-host>/oauth2/backchannel-authentication \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=<client-id>" \
  -d "client_secret=<client-secret>" \
  -d "login_hint=person@example.com" \
  -d "scope=openid profile email" \
  -d "action=sign-in" \
  -d "binding_message=Sign in to the protected portal"
```

Aegis returns a polling handle and creates a wallet challenge:

```json
{
  "auth_req_id": "aegis_authreq_...",
  "expires_in": 300,
  "interval": 5,
  "aegis_challenge_id": "challenge-uuid"
}
```

Poll the token endpoint with the returned `auth_req_id`:

```bash
curl -X POST https://<aegis-host>/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:openid:params:grant-type:ciba" \
  -d "client_id=<client-id>" \
  -d "client_secret=<client-secret>" \
  -d "auth_req_id=<auth-req-id>"
```

While the wallet decision is pending, Aegis returns `authorization_pending`. When approved, Aegis returns app-scoped tokens that include `wallet_challenge_id` and an `acr` value representing the assurance method. Declined, expired, or replayed challenges are rejected.

## Wallet Challenge API

Connected Apps can request a wallet challenge:

```bash
curl -X POST https://<aegis-host>/api/connected-apps/wallet-challenges \
  -H "x-aegis-client-id: <client-id>" \
  -H "x-aegis-client-secret: <client-secret>" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "person@example.com",
    "action": "approve-expense",
    "resourceType": "expense",
    "resourceId": "EXP-2026-1048",
    "payload": {
      "amount": 1250.75,
      "currency": "CAD"
    },
    "requiredAssurance": "passkey"
  }'
```

The API writes a connected-app log entry and a wallet challenge ledger record.

## Security Notes

- Client secrets are displayed once after creation.
- Secrets are hashed at rest.
- Certificate PEMs are stored so the admin can audit what was imported, but UI responses only expose the fingerprint.
- Connected Apps are organization-scoped.
- Logs are organization and app scoped.
- OAuth tokens are signed with a local RS256 signing key and exposed through JWKS.
- Sign-in wallet challenges are one-time decisions. Accepted, declined, and expired challenges cannot be replayed.
- CIBA-style requests return OAuth-shaped pending, denied, and expired responses so relying parties can integrate cleanly.
- Production deployments should move stores and signing keys to managed persistence and managed secrets.

## Test Expectations

The test suite should cover:

- App creation requires `connectedApps.manage`.
- Secrets and certificates require `connectedApps.credentials.manage`.
- Authorization code exchange rejects invalid client credentials.
- Client credentials flow issues a signed JWT.
- Sign-in challenge policy blocks token issuance until the wallet challenge is accepted.
- CIBA-style backchannel requests create a wallet challenge and poll to a final token or OAuth error.
- Accepted wallet challenges cannot be replayed.
- Wallet challenge API requires a valid connected app credential.
- New mutating routes fail route-security tests if they omit `authorize(...)`.
