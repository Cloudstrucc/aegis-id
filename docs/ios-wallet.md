# The iOS wallet

`ios/VanguardAegisWallet/` — SwiftUI, and the holder's half of Aegis ID. It is a
shipping application at version **1.0**, not a lab shell: an organization issues
a credential, it arrives here, and the holder approves or declines what follows.

## Build configurations

One per environment, so all four install side by side and each talks only to the
web app it was compiled against.

| Scheme | Configuration | Bundle id | Talks to |
|---|---|---|---|
| VanguardAegisWallet | Release | `ca.vanguardcs.aegisid.wallet` | prod |
| VanguardAegisWallet QA | Debug-QA / Release-QA | `…wallet.qa` | qa |
| VanguardAegisWallet Dev | Debug-Dev / Release-Dev | `…wallet.dev` | dev |
| VanguardAegisWallet Local | **Debug-Local** | `…wallet.dev` | `http://localhost:3000` |

**The Local scheme's configuration is `Debug-Local`, not `Debug`.** Building
`-configuration Debug` produces a wallet pointed at *production*, so a test
registration writes to the prod store instead of a local server. It looks like a
local build and is not.

```bash
xcodebuild -project ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj \
  -scheme "VanguardAegisWallet Local" -configuration Debug-Local \
  -sdk iphonesimulator -destination 'name=iPhone 16 Pro' build
```

## Releasing

```bash
scripts/release-ios.sh --env dev --env qa       # TestFlight
scripts/release-ios.sh --env prod               # App Store
```

`--env` is repeatable. Credentials come from an untracked `.env.ios`
(`ASC_KEY_ID`, `ASC_ISSUER_ID`) with the `.p8` at
`~/.appstoreconnect/private_keys/`. They are per Apple **team**, not per
environment, which is why there is one file rather than three. See
[`store-submission.md`](store-submission.md) for the store side.

`MARKETING_VERSION` is `1.0` across all sixteen configurations and is kept in
step with `versionName` in the Android Gradle build.

## What it does

- **Wallet ID and setup.** First run registers the device and mints a Wallet ID —
  an identifier, not a secret. Ten single-use recovery codes are shown once.
- **Invitations.** Scanned as a QR on the Scan tab, or pasted as an
  `aegisid://` link on the Home tab. The second is the one that works when the
  invitation arrived on the same phone.
- **Many organizations, one wallet.** Each sees only what it issued and the
  approvals it asked for.
- **Wallet challenges.** Approve and decline are both real answers and both are
  recorded.
- **Ledger.** The holder's own append-only history.
- **Getting started.** A help screen reachable from setup, the Home hero and
  Settings, carrying the web app address and opening it in an in-app browser.

Keys are generated on the device, are not extractable, and are excluded from
backups — which is why recovery rotates the key rather than restoring it. See
[`wallet-identity-and-recovery.md`](wallet-identity-and-recovery.md).

## Deep links

Every environment registers its own URL scheme — `aegisid-local`, `aegisid-dev`,
`aegisid-qa`, `aegisid` — and the server emits links in the scheme of the
environment serving them. Keep `AEGIS_URL_SCHEME` in the Xcode project in step
with `config.app.walletUrlScheme` on the server and `aegisEnvironment(...)` in
the Gradle build. The wallet accepts any `aegisid*` scheme on the way in, so a
link pasted from another environment is understood rather than rejected.

## Passkeys for other services

**Not in 1.0.** The extension is built but not embedded and the Passkeys screen
is hidden — see [`wallet-passkey-provider.md`](wallet-passkey-provider.md) for
what is unresolved and how to turn it back on.

## The Aries lab

`/aries-lab` is a lab, never the product path. The wallet's credentials and
challenges go through the Aegis ID service directly; the Aries protocols apply
only to lab connections. See [`aries-lab.md`](aries-lab.md).
