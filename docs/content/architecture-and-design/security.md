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

Wallet passkey registrations are stored in `data/wallet-passkeys.json` by default. The store contains WebAuthn credential public keys, counters, device metadata, and last-used timestamps, not private keys. For production, move this to durable storage, add deletion/export workflows, and define retention for passkey-backed wallet approval evidence.

## Subscriber Dashboard

- Subscriber dashboard, organization subscription, setup wizard, and OIDC demo pages require Passport.js authentication.
- Organization subscription is available only after email, SMS, or passkey second-factor verification.
- Wallet passkeys are optional approval assurance for the mobile wallet. Enforce them only where organization policy requires stronger proof for approvals, revocations, role changes, or other high-value actions.
- Treat local email/SMS development codes as a dev-only stand-in for a real provider such as Azure Communication Services, SendGrid, Twilio, or Microsoft Graph mail.
- Do not persist Azure client secrets or IdP client secrets in the local JSON workspace store.
- Add CSRF protection before accepting production form posts.
- Restrict metadata test URLs before enabling customer-supplied Keycloak, Okta, OIDC, or SAML endpoints in production.
- Store per-subscriber platform configuration in a tenant-isolated database for production SaaS use.

## Production Certification And Legal Evidence

Aegis ID is currently a pilot implementation and lab architecture. Do not represent it as a certified government digital-signature service, qualified trust service, or regulated identity proofing service until the target jurisdiction, assurance level, controls, audits, and certifications are formally assessed.

For production legal-signature or government use, define the jurisdiction and signature tier first:

- General electronic signature evidence: capture signer intent, consent, identity context, document hash, wallet challenge payload, time, IP/device context where appropriate, and immutable audit records.
- High-assurance organizational approvals: require organization policy, wallet passkey evidence, role/claims state at signing time, revocation state, and tamper-evident retention.
- Regulated or government-recognized digital signatures: use the required trust framework, certificate authority, qualified trust service provider, or government PKI for that jurisdiction, then let Aegis ID add wallet approval and workflow evidence around it.

Before production launch for regulated customers, complete a control program covering at least ISO 27001/SOC 2 readiness, privacy impact assessment, threat modeling, secure SDLC, penetration testing, durable tenant-isolated storage, key and secret management, retention/legal hold, incident response, and documented NIST 800-63 IAL/AAL/FAL mapping.
