# Connected Apps

Connected Apps let an organization register relying-party applications that use Vanguard Aegis ID as an OIDC/OAuth provider and as a high-assurance wallet challenge API.

This is different from the generic OIDC/SAML integration wizard. That wizard connects Aegis ID to an external identity provider. Connected Apps let external applications connect to Aegis ID.

## What Connected Apps Provide

- OIDC discovery at `/oauth2/.well-known/openid-configuration`
- Authorization-code flow for browser and mobile sign-in
- Client-credentials flow for server-to-server calls
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
7. Choose claims to release in tokens.
8. Generate a one-time client secret or import a certificate PEM.
9. Give the relying party the OIDC discovery URL.
10. Use the app logs and wallet challenge ledger to audit activity.

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
- Production deployments should move stores and signing keys to managed persistence and managed secrets.

## Test Expectations

The test suite should cover:

- App creation requires `connectedApps.manage`.
- Secrets and certificates require `connectedApps.credentials.manage`.
- Authorization code exchange rejects invalid client credentials.
- Client credentials flow issues a signed JWT.
- Wallet challenge API requires a valid connected app credential.
- New mutating routes fail route-security tests if they omit `authorize(...)`.

