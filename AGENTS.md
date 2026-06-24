# Aegis ID — Agent Operating Guide

Vanguard Aegis ID is a standalone identity, authorization, wallet challenge,
credential, and connected-app platform with companion iOS and Android apps.

This is the canonical repo-wide guidance file for coding agents.

## Output and workflow

- Be concise. No chatty narration.
- Implement directly unless design analysis is explicitly requested first.
- Compact context aggressively.
- Keep changes scoped. No unrelated cleanup.
- Reuse existing helpers and shared services before adding new abstractions.
- Prefer `apply_patch` for manual edits.

## Testing

- Do not run tests, lint, or build checks unless explicitly asked.
- If a change clearly needs a test, add it, but do not execute it unless asked.
- If verification is requested, run the smallest targeted scope possible.

## Product identity

Aegis ID is a standalone platform. It is not subordinate to Microsoft,
Keycloak, YubiKey, or any other vendor. Those are integrations.

Core capabilities:

- Aegis-issued OIDC/OAuth for connected apps
- upstream federation to enterprise IdPs
- downstream relying-party integrations
- wallet-backed challenge approval with immutable ledger evidence
- centralized RBAC and policy enforcement
- credential issuance, consent, and revocation
- hardware-backed assurance such as WebAuthn, passkeys, and YubiKey

## Architecture invariants

1. Aegis is the policy decision point.
2. Deny by default.
3. Authorization must be centralized.
4. Server-side enforcement is mandatory.
5. Wallet challenge approve and decline paths are both meaningful.
6. Integrations are adapters, not the product identity.

## Security rules

- Reuse the authorization service and policy helpers.
- Prefer shared middleware and registries over inline conditionals.
- Keep secrets masked by default.
- Protect admin-only features with the same RBAC system used elsewhere.
- Use official, well-supported libraries for auth and security-sensitive code.

## Stack

- Web: Node.js, Express, Handlebars, shared CSS/JS
- Mobile: `/ios`, `/android`
- Identity: Passport, Aegis OIDC/OAuth, upstream federation, WebAuthn/passkeys
- Credential/wallet: Aegis wallet challenges, Verified ID integration, Aries lab
- Docs: Markdown rendered in-app

## UX rules

- Authenticated surfaces should feel like enterprise software.
- Avoid oversized typography in dashboards, docs, and admin views.
- Avoid accidental overflow and horizontal scrolling.
- Keep tables responsive within their container.
- Keep modals and forms visually integrated with the product.

## Environments

- local
- dev
- qa
- prod

Tenants:

- Cloudstrucc default
- VanguardCS additional tenant

## Default feature workflow

1. inspect the existing implementation
2. identify the smallest correct integration point
3. implement using existing architecture
4. update docs if developer/operator workflow changed
5. add tests if useful, but do not run them unless asked

## Nested guidance

When working in these areas, also read the nearest nested `AGENTS.md`:

- `/src`
- `/views`
- `/public`
- `/ios`
- `/android`
- `/tests`
