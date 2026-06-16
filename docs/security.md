# Security Notes

## Production Microsoft Track

- Require phishing-resistant MFA for issuer and verifier administration.
- Require YubiKey/passkey sign-in before employee credential issuance.
- Validate callback state and callback API keys.
- Do not log raw credentials, access tokens, private keys, PINs, or unnecessary personal data.
- Use Key Vault or a managed secret store for live credentials.
- Keep the default mock mode for local development.

## Aries Lab Track

- Keep ACA-Py admin APIs on localhost.
- Never use `--admin-insecure-mode` for a deployed/shared service.
- Use separate wallets and keys for mediator, issuer, and verifier.
- Keep lab DIDs and schemas out of the production trust model.
- Avoid using VON/Indy outside development testing.

## Subscription Data

The demo stores users in `data/users.json` and subscriptions in `data/subscriptions.json`. That keeps the first Azure App Service deployment simple, but production should move account, subscription, MFA, and organization data to a durable system with access controls, retention policy, and export/delete workflows.

## Subscriber Dashboard

- Subscriber dashboard, organization subscription, setup wizard, and OIDC demo pages require Passport.js authentication.
- Organization subscription is available only after email, SMS, or passkey second-factor verification.
- Treat local email/SMS development codes as a dev-only stand-in for a real provider such as Azure Communication Services, SendGrid, Twilio, or Microsoft Graph mail.
- Do not persist Azure client secrets or IdP client secrets in the local JSON workspace store.
- Add CSRF protection before accepting production form posts.
- Restrict metadata test URLs before enabling customer-supplied Keycloak, Okta, OIDC, or SAML endpoints in production.
- Store per-subscriber platform configuration in a tenant-isolated database for production SaaS use.
