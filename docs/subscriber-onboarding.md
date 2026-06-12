# Subscriber Onboarding Wizard

After subscribing, a user is redirected to a dashboard at:

```text
/dashboard/<subscription-id>
```

The dashboard shows each platform Aegis ID can connect to:

- Microsoft Entra Verified ID / Azure
- Keycloak
- Okta
- Generic OIDC / SAML

Each platform has an interactive wizard that saves setup progress and can run a connection test.

## Microsoft Entra Verified ID Wizard

The Microsoft wizard is designed for the Cloudstrucc Inc. tenant pilot.

Steps:

1. **Tenant**  
   Capture tenant display name, Azure tenant ID, primary verified domain, and setup mode.

2. **DID Organization**  
   Capture issuer authority DID, DID method, linked domain, and Key Vault reference.

3. **App Registration**  
   Capture application client ID, secret reference, credential manifest URL, and callback key reference.

4. **Claims**  
   Capture credential type, required claims, optional claims, and a sample test subject.

5. **Test**  
   Run a mock request or a live Microsoft Entra Verified ID request.

## Live Verified ID Test

The live test creates both:

- an issuance request
- a presentation request

The one-time Azure client secret field is used only for the test request and is not persisted to local JSON storage.

For production, store the secret in:

- Azure Key Vault
- App Service configuration
- a managed secret store used by your deployment platform

The live test needs:

- Azure tenant ID
- app registration client ID
- one-time client secret or configured `AZURE_CLIENT_SECRET`
- issuer authority DID
- credential manifest URL
- credential type
- public callback base URL

## Federation Wizards

The Keycloak, Okta, and Generic OIDC / SAML wizards save provider metadata and claim mappings. Their test step validates either:

- OpenID Connect discovery metadata
- SAML metadata

The current implementation does metadata reachability and shape validation. It does not yet perform a full browser SSO login, token exchange, SAML assertion validation, or SCIM sync.

## Security Notes

- Do not treat local JSON stores as production storage.
- Do not persist client secrets in subscriber setup data.
- Add authentication before exposing subscriber dashboards publicly.
- Add tenant isolation before running this as a multi-tenant SaaS.
- Restrict metadata test URLs in production to avoid SSRF risk.
- Use Azure Key Vault or another secret manager before live customer onboarding.
