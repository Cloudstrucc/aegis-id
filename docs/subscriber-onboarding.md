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

The Microsoft wizard is designed for the Vanguard Cloud Services tenant pilot.

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

## Local Platform Test Examples

The root [README](../README.md) contains a full platform test matrix with example wizard values. For quick local validation without real external identity providers, use the built-in mock metadata endpoints:

| Platform card | Protocol | Metadata input | Expected wizard result |
| --- | --- | --- | --- |
| Microsoft Entra Verified ID | Verified ID mock | Test mode `Mock request` | `Mock Verified ID request created` |
| Keycloak | OIDC | Base URL `http://localhost:3000/demo/metadata/keycloak`, realm `vanguard` | `OIDC discovery valid` |
| Keycloak | SAML | Metadata URL `http://localhost:3000/demo/metadata/generic/saml` | `SAML metadata found` |
| Okta | OIDC | Issuer URL `http://localhost:3000/demo/metadata/okta/oauth2/default` | `OIDC discovery valid` |
| Okta | SAML | Metadata URL `http://localhost:3000/demo/metadata/generic/saml` | `SAML metadata found` |
| Generic OIDC / SAML | OIDC | Metadata URL `http://localhost:3000/demo/metadata/generic/oidc` | `OIDC discovery valid` |
| Generic OIDC / SAML | SAML | Metadata URL `http://localhost:3000/demo/metadata/generic/saml` | `SAML metadata found` |

For browser SSO plus wallet step-up testing, use:

```text
http://localhost:3000/demo/oidc-wallet
```

That relying-party demo represents the pattern Keycloak, Okta, or a generic OIDC/SAML provider would use after primary SSO: OIDC or SAML completes first, then Aegis ID sends a Vanguard Aegis ID wallet challenge before allowing app access.

The challenge sender is an issuing organization, not just a raw connection. To make an org available:

1. Subscribe and open `/dashboard/<subscription-id>`.
2. In **Issuing organization**, create an org issuer invitation.
3. Accept that invitation in the Vanguard Cloud Services iOS simulator wallet.
4. The wallet registers the completed issuer connection back to the org.
5. The OIDC wallet demo can then select that org as the challenge sender.

## Security Notes

- Do not treat local JSON stores as production storage.
- Do not persist client secrets in subscriber setup data.
- Add authentication before exposing subscriber dashboards publicly.
- Add tenant isolation before running this as a multi-tenant SaaS.
- Restrict metadata test URLs in production to avoid SSRF risk.
- Use Azure Key Vault or another secret manager before live customer onboarding.
