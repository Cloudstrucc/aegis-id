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

The demo stores subscription data in `data/subscriptions.json`. That keeps the first Azure App Service deployment simple, but production should move subscription data to a durable system with access controls, retention policy, and export/delete workflows.
