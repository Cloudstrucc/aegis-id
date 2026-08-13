# Aegis ID iOS Guidance

Use this guidance for work under `/ios`.

## Priorities

- keep wallet challenge flows explicit and trustworthy
- preserve approval and decline behavior
- keep passkey, WebAuthn, and YubiKey flows understandable
- preserve parity with the web platform where expected

## Passkey provider

`AegisPasskeyProvider` is a second target — an `ASCredentialProviderExtension`
that lets the wallet hold FIDO2 passkeys for **any** site, not just Aegis. See
[`docs/wallet-passkey-provider.md`](../docs/wallet-passkey-provider.md).

Two things that break it silently:

- **The extension is a different process.** It reads the App Group container and
  the shared keychain group, never the app's own sandbox. Every `.entitlements`
  file — all four app ones and the extension's — must carry both
  `group.ca.vanguardcs.aegisid.wallet` and the
  `…wallet.passkeys` keychain group. Drop one and the wallet lists passkeys it
  cannot use.
- **`ProvidesPasskeys` in the extension Info.plist.** Without it iOS treats the
  extension as a password provider and never sends it a passkey request.

Same-device only. Scanning a desktop passkey QR is the hybrid transport, which
is OS-owned with no third-party API — the interface says so rather than
appearing broken.

## Rules

- Do not fake security-sensitive flows.
- Be explicit about what is mock, lab, pilot, or production-ready.
- Preserve immutable decision history and organization context.
- Keep branding aligned with the product.
- Do not run tests unless explicitly asked.
