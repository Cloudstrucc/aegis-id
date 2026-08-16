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

**It is not embedded in 1.0.** Registration still fails on a device, so the app
ships with no autofill entitlement, no `.appex` and the Passkeys screen hidden
behind `AegisWalletEnvironment.providesPasskeysForOtherServices`. The target and
every line of the implementation are still here; turning it back on is that
flag, the app entitlement, and two `project.pbxproj` entries — the embed build
file and the target dependency. The notes below apply the moment it is.

Two things that break it silently:

- **The extension is a different process.** It reads the App Group container and
  the shared keychain group, never the app's own sandbox. Every `.entitlements`
  file — all four app ones and the extension's — must carry both
  `group.ca.vanguardcs.aegisid.wallet` and the
  `…wallet.passkeys` keychain group. Drop one and the wallet lists passkeys it
  cannot use.
- **`ProvidesPasskeys` in the extension Info.plist.** Without it iOS treats the
  extension as a password provider and never sends it a passkey request.
- **`com.apple.developer.authentication-services.autofill-credential-provider`
  on the app *and* the extension.** Nothing local complains without it — the
  archive builds and signs, and App Store Connect rejects the upload with 90729.

Same-device only. Scanning a desktop passkey QR is the hybrid transport, which
is OS-owned with no third-party API — the interface says so rather than
appearing broken.

## Rules

- Do not fake security-sensitive flows.
- Be explicit about what is mock, lab, pilot, or production-ready.
- Preserve immutable decision history and organization context.
- Keep branding aligned with the product.
- Do not run tests unless explicitly asked.
