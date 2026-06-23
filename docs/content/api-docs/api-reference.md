---
title: Connected Apps API Reference
summary: OIDC discovery, authorization, token, userinfo, and wallet challenge endpoints for relying-party applications.
order: 1
---

# Connected Apps API Reference

Use Connected Apps when an external application needs to trust Aegis ID as an OIDC/OAuth provider, issue app-scoped tokens, or request high-assurance wallet challenges for sensitive actions.

Replace `http://localhost:3000` with the Aegis ID environment you are testing: local, dev, QA, or production.

## Core Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/oauth2/.well-known/openid-configuration` | Discovery metadata for authorization, token, JWKS, userinfo, introspection, and revocation endpoints. |
| `GET` | `/oauth2/authorize` | Authorization-code sign-in endpoint for browser and mobile relying parties. |
| `POST` | `/oauth2/token` | Token exchange endpoint for `authorization_code`, `client_credentials`, and CIBA-style grants. |
| `GET` | `/oauth2/userinfo` | Returns released user claims for an access token. |
| `POST` | `/api/connected-apps/wallet-challenges` | Client-authenticated API for wallet challenges and immutable decision evidence. |

## Authorization URL

```text
http://localhost:3000/oauth2/authorize?client_id=aegis_client_id&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&response_type=code&scope=openid%20profile%20email&state=opaque&nonce=opaque
```

## Token Request

```bash
curl -X POST http://localhost:3000/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "client_id=aegis_client_id" \
  -d "client_secret=one_time_secret" \
  -d "code=aegis_code_value" \
  -d "redirect_uri=https://app.example.com/callback"
```

## Wallet Challenge Request

```bash
curl -X POST http://localhost:3000/api/connected-apps/wallet-challenges \
  -H "Content-Type: application/json" \
  -H "x-aegis-client-id: aegis_client_id" \
  -H "x-aegis-client-secret: one_time_secret" \
  -d '{
    "subject": "person@example.com",
    "action": "approve-expense",
    "resourceType": "expense",
    "resourceId": "EXP-2026-1048",
    "payload": { "amount": 1250.75, "currency": "CAD" },
    "requiredAssurance": "passkey"
  }'
```

## Certificate Fingerprint Authentication

```bash
curl -X POST http://localhost:3000/api/connected-apps/wallet-challenges \
  -H "x-aegis-client-id: aegis_client_id" \
  -H "x-aegis-certificate-sha256: certificate_sha256_fingerprint" \
  -H "Content-Type: application/json" \
  -d '{ "subject": "person@example.com", "action": "sign-contract" }'
```

## OpenAPI

The machine-readable OpenAPI document is available at:

```text
/developer/openapi.json
```

Use this file to generate client SDKs, API test collections, or security review evidence for connected relying-party applications.
