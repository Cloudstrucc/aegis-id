# Shipping the iOS wallet as a FIDO2 passkey provider

> **Read [`wallet-passkey-provider.md`](wallet-passkey-provider.md) first.** It
> describes the feature, how it works on both platforms, and everything that has
> already been eliminated. This document is only the plan for finishing iOS and
> turning it on.

## Where this actually stands

**The implementation exists.** It is not a greenfield feature and this is not a
plan to write one. 1,240 lines of Swift are already in the repository and
building:

| Piece | File | Lines |
|---|---|---|
| Authenticator — key generation, CBOR attestation, assertion signing | `VanguardAegisWallet/Services/PasskeyAuthenticator.swift` | 332 |
| The extension itself — `ASCredentialProviderViewController` | `AegisPasskeyProvider/CredentialProviderViewController.swift` | 318 |
| Consent and verification interface | `AegisPasskeyProvider/PasskeyPromptViews.swift` | 158 |
| "Passkeys for other services" screen | `Features/Settings/PasskeysView.swift` | 174 |
| Shared record store (App Group + keychain group) | `Services/PasskeyStore.swift` | 152 |
| On-device trail for diagnosis | `Services/PasskeyDiagnostics.swift` | 64 |
| Republishing to `ASCredentialIdentityStore` | `Services/PasskeyIdentityIndex.swift` | 42 |

A separate target `AegisPasskeyProvider` exists in the Xcode project, with
`ProvidesPasskeys` in its extension attributes, its own bundle id
(`<app bundle id>.passkeys`), the App Group and keychain group, and the AutoFill
entitlement. The release script already handles the provisioning this needs.

**Three things turn it off**, and all three are one-line reverts:

1. `AegisWalletEnvironment.providesPasskeysForOtherServices = false`
   (`Services/AegisWalletEnvironment.swift:34`) hides the Passkeys screen.
2. The **Embed Foundation Extensions** build phase has an empty `files` list, so
   the built `.appex` is not copied into the app.
3. The four app `.entitlements` files no longer carry
   `com.apple.developer.authentication-services.autofill-credential-provider`.
   Only the extension's does.

**One thing blocks it**, and it is not any of those. On a device, registration
reaches `handed to iOS` — the extension builds a credential, hands it over, and
iOS reports the request had *not* expired — and Safari then fails the page with
a bare `NotAllowedError`. WebAuthn has one error for "the authenticator
declined" and no way to say why, so the page cannot tell us anything more.

So the work is: **find out why, fix that, revert the three switches, verify on a
device, ship.** Phases 1–5 below. Everything before Phase 2 is diagnosis, and
Phase 1 cannot be skipped — the three candidate causes in Phase 2 call for
different fixes, and picking one without the log is guessing.

### What has already been ruled out

Do not re-run these. Each was checked rather than assumed, and
`wallet-passkey-provider.md` records how:

- the attestation object and the assertion both verify against
  `@simplewebauthn/server`, the same library this platform uses
- the credential shape matches `ASPasskeyRegistrationCredential.h`
- the extension is registered against the app (`pluginkit -mv`)
- the built `.appex` carries `ProvidesPasskeys`, the right extension point and
  the right principal class (`plutil -p`)
- `rpId` equals the origin host for every tenant
- the extension's lifecycle runs: the biometric prompt appears, and
  `completeRegistrationRequest` reports no expiry

Two failures *were* found and fixed on the way, so neither is a candidate any
more: `$(AppIdentifierPrefix)` does not expand in Swift (the keychain group is
published through `AEGIS_KEYCHAIN_ACCESS_GROUP` in both Info.plists and read at
runtime), and republishing the identity store before answering the system held
the request open long enough for iOS to time the extension out.

---

## Phase 1 — Name the rejection

**This needs a physical iPhone connected to a Mac by cable.** The iOS Simulator
does not offer third-party credential providers in AutoFill settings at all, so
the end-to-end path cannot be exercised there — which is why this has not been
closed already.

Half a day, almost all of it waiting for a build.

1. Revert the three switches (Phase 3 below) on a branch, so the provider is
   installed and selectable. Build the Dev scheme to the device.
2. Enable it at **Settings › General › AutoFill & Passwords**, with Aegis ID as
   the only enabled provider. Turning off iCloud Keychain matters: with both
   on, iOS may satisfy the request itself and the extension is never asked.
3. With the phone connected, start the system log on the Mac:

```bash
log stream --device --predicate 'subsystem CONTAINS "AuthenticationServices" OR process == "Safari"' --level debug
```

4. Reproduce the registration on `https://webauthn.io` **on the phone**. Use
   webauthn.io rather than Aegis ID first: it separates a wallet problem from a
   problem with this platform's own WebAuthn request, and it costs a minute.
5. Capture the window from the extension launching to the page's error.

The rejection is named in that log and nowhere else. Save the capture to
`artifacts/` and attach it to whatever tracks this work — the next person
should not have to borrow a phone to find out what was already known.

Read the wallet's own side alongside it. `PasskeyDiagnostics` records each step
and the Passkeys screen displays the trail, so the two can be lined up: the
extension's last entry before Safari's complaint is the point of failure.

**If the log does not name it**, two cheap discriminators, in this order:

- **Register from a native app rather than Safari.** A WebAuthn request from
  `ASAuthorizationController` in a small test app goes through the same
  extension but not through Safari's own validation. Working there and failing
  in Safari localises it to Safari; failing in both puts it in the extension or
  in iOS.
- **Register against a different relying party** with a different `rpId` shape —
  one with a subdomain, one without. An `rpId`/origin mismatch Safari computes
  differently from us would show as one working and the other not.

---

## Phase 2 — Fix what Phase 1 names

Scope depends entirely on the answer. The three candidates, most to least
likely, each with what the log would say and what the fix is:

**The credential is well-formed but Safari rejects the registration for a
reason of its own** — most likely. Chrome on Android needed `publicKeyAlgorithm`,
`publicKey` and `authenticatorData` as their own response fields rather than
unpacked from the attestation object, and failed the whole registration when
they were missing; Safari may want something analogous that
`ASPasskeyRegistrationCredential`'s four-argument initializer does not carry.
The fix is in `completeRegistration` in `CredentialProviderViewController.swift`
and nowhere else. **Half a day to a day.**

**The extension answers correctly but too late.** `completeRegistrationRequest`
returning `expired == false` says iOS had not given up, not that Safari had not.
The biometric prompt sits inside the window, so a slow verification could put
the answer past the page's own timeout. The fix is to move
`verifyHolder` ahead of anything else that can block and to keep the identity
store refresh after the answer — half of which is already done. **A day.**

**An entitlement or association is missing in a way nothing local reports.**
This class is characteristic: the archive builds, the code signs, and the
failure appears only at runtime or at upload. All five entitlements files are
supposed to carry the AutoFill key, and the App Group and keychain group have to
be on both the app and the extension on the developer portal as well as in the
files. **A day, mostly provisioning.**

Do not start any of these before Phase 1. Two of the three would look plausible
against the same symptom.

---

## Phase 3 — Turn it back on

Half a day, and a revert rather than a rewrite. Nothing was deleted.

1. `providesPasskeysForOtherServices = true` in `AegisWalletEnvironment.swift`,
   and update the comment above it — it currently explains why the feature is
   off, which would then be wrong in a way that outlives anyone who remembers.
2. Put `AegisPasskeyProvider.appex` back in the **Embed Foundation Extensions**
   phase's `files` list (`project.pbxproj`, the build file reference is already
   there with `RemoveHeadersOnCopy`).
3. Add `com.apple.developer.authentication-services.autofill-credential-provider`
   to all four app `.entitlements` files — not just the one you are building.
   App Store Connect rejects the upload with error 90729 if the *app* is missing
   it, which is after the archive has already succeeded.

Provisioning needs the second bundle id and the App Groups capability on both
App IDs. `scripts/release-ios.sh` passes `-allowProvisioningUpdates` on the
archive as well as the export, which is what makes that work from the command
line. If Apple's API declines to create a group identifier that has never
existed on the account, open the project in Xcode once and add **App Groups**
and **Keychain Sharing** to each target under Signing & Capabilities; every
later scripted build then works.

---

## Phase 4 — Verify on a device

A day. There is no way to unit-test this end to end without a relying party, so
use real ones. On a physical device running iOS 17 or later:

1. **`https://webauthn.io`** — register, confirm the passkey appears under
   Settings › Passkeys for other services, sign out, sign in again. Both halves
   have to pass; a registration that succeeds and an assertion that is rejected
   almost always means the signature covered the wrong bytes, and it is
   `authenticatorData ‖ clientDataHash` in that order.
2. **A second relying party** with a different `rpId` shape, to catch anything
   webauthn.io is lenient about.
3. **Aegis ID itself**, through `/auth/login` with a passkey. This is the case
   the product cares about and the one most likely to differ: `PASSKEY_RP_ID`
   and `PASSKEY_ORIGIN` are per tenant, so run it against dev and against a
   tenant with a custom domain. A passkey with user verification completes a
   sign-in on its own — `sign-in-methods-service.js`, `satisfiesSecond` — so a
   provider that registers but cannot assert locks somebody out of an account
   whose only second factor it is.
4. **The signature counter.** Assert twice and confirm the counter in
   `authenticatorData` increases. A counter that goes backwards is how a
   relying party detects a cloned authenticator, and a provider that always
   sends zero will eventually be refused by one that checks.
5. **Deletion.** Remove a passkey in the wallet and confirm the screen still
   says plainly that the site believes it exists — the wallet has no way to tell
   it otherwise, and a holder who is not told that finds out at the next sign-in.

The simulator is useful for everything except the end-to-end path. Keep using
it for the Passkeys screen and the diagnostics trail.

---

## Phase 5 — Ship it

Half a day.

- `bash scripts/release-ios.sh --env dev` first, and confirm App Store Connect
  accepts the upload. The missing-entitlement rejection happens at upload, not
  at build, so this is the real check that Phase 3 was complete.
- Then `--env qa`, then `--env prod`.
- Update `wallet-passkey-provider.md`: remove the "neither wallet ships this in
  1.0" banner for iOS, and move the iOS part of "what has been verified, and
  what has not" into what the fix turned out to be. Leave the Android section
  alone — it is a separate, still-open failure.
- Update `entra-wallet-integration-plan.md`, where **Track C** is recorded as
  blocked in both wallets. iOS unblocking it is half of what Track C needs.

---

## What this does not cover

**Android.** A different and still-open failure: registration works, the
assertion is rejected by the relying party with "Could not verify authentication
signature", and the remaining suspect is the public key stored at registration —
which nothing verifies at registration time, because attestation is `none`.
Closing iOS does not close Android, and the fixes will not be the same.

**Cross-device sign-in.** Scanning a passkey QR on a desktop is the hybrid
(caBLE) transport, implemented inside iOS with no third-party API. No wallet on
the App Store can do it. This is a platform limit, not a phase.

**Syncing between the holder's devices.** The private key is generated in the
Secure Enclave, is not extractable, and is excluded from backups. Losing the
phone loses the passkeys on it, and the holder recovers through each site's own
process. Also deliberate, also not a phase.

Both are stated on the Passkeys screen, because they are much easier to explain
before somebody relies on them.

## Rough shape

| Phase | Work | Needs |
|---|---|---|
| 1 — Name the rejection | Half a day | **A physical iPhone, cabled.** Blocking. |
| 2 — Fix it | Half a day to a day | Depends on Phase 1 |
| 3 — Turn it back on | Half a day | Apple Developer portal access |
| 4 — Verify on a device | A day | The same device |
| 5 — Ship | Half a day | App Store Connect |

Three to four days of work, and none of it can start without the device. That
is the whole reason this is still open: every question that remains has its
answer in a log that only a real iPhone produces.
