# Aegis ID iOS Guidance

Use this guidance for work under `/ios`.

## Priorities

- keep wallet challenge flows explicit and trustworthy
- preserve approval and decline behavior
- keep passkey, WebAuthn, and YubiKey flows understandable
- preserve parity with the web platform where expected

## Rules

- Do not fake security-sensitive flows.
- Be explicit about what is mock, lab, pilot, or production-ready.
- Preserve immutable decision history and organization context.
- Keep branding aligned with the product.
- Do not run tests unless explicitly asked.
