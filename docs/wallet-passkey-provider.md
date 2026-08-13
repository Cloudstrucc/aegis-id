# The wallet as a FIDO2 passkey provider

Both wallets can hold passkeys for **any** site or application that supports
them — not only Aegis ID. The wallet registers itself with the operating system
as a credential provider, and from then on it appears alongside iCloud Keychain
or Google Password Manager when something asks for a passkey.

## What this is, and what it is not

| | Supported |
|---|---|
| Create a passkey for any site, on this device | Yes |
| Sign in to that site later, on this device | Yes |
| Sign in from a native app on the same device | Yes |
| Sign in on a **desktop** by scanning a QR code | **No** |
| Sync passkeys between the holder's devices | **No** |

The last two are not omissions.

**Cross-device sign-in is the hybrid transport** (formerly caBLE). It is
implemented inside iOS and Google Play services, and neither platform exposes an
API for a third-party application to act as a hybrid authenticator. No wallet on
either store can do it. A holder who scans a desktop passkey QR gets the
operating system's own authenticator, not this one.

**Passkeys do not sync.** The private key is generated in the Secure Enclave or
the Android keystore, is not extractable, and is excluded from backups. That is
deliberate — a copy on a second device is a second authenticator nobody
registered — but it means losing the phone loses the passkeys on it, and the
holder recovers through each site's own recovery, not through Aegis.

The interface says both of these plainly on the Passkeys screen. It is easier to
explain up front than to explain a failure later.

## How it works

Both platforms implement the same authenticator, once per language:

- `ios/VanguardAegisWallet/VanguardAegisWallet/Services/PasskeyAuthenticator.swift`
- `android/.../wallet/passkey/PasskeyAuthenticator.kt`

They generate a P-256 key pair per credential, build the CBOR attestation object
returned at registration, and sign `authenticatorData ‖ clientDataHash` at
assertion. Attestation is `none` — the wallet does not vouch for its own
hardware to a relying party it has never met, and every major browser accepts
that.

The AAGUID is sixteen zero bytes, which is the correct value for an
unattested credential: it says the authenticator declines to identify its make
and model, rather than impersonating one that does.

### iOS

A separate target, `AegisPasskeyProvider`, an `ASCredentialProviderExtension`
with `ProvidesPasskeys` set in its `NSExtensionAttributes`. Without that key iOS
treats it as a password provider and never routes a passkey request to it.

The extension is **a different process from the app**, so it sees nothing in the
app's sandbox. Both sides share:

- App Group `group.ca.vanguardcs.aegisid.wallet` — the passkey records
- Keychain group `$(AppIdentifierPrefix)ca.vanguardcs.aegisid.wallet.passkeys` — the keys

Every `.entitlements` file in the app carries both, and so does the extension's.
Dropping either from one side produces a wallet that lists passkeys and then
cannot use them.

`PasskeyIdentityIndex` republishes the credential list to
`ASCredentialIdentityStore` whenever it changes. Skipping that does not break
sign-in, but iOS then never *suggests* Aegis ID on a sign-in screen, and the
holder has to find it through the AutoFill menu.

The holder enables it at **Settings › General › AutoFill & Passwords**.

### Android

`AegisCredentialProviderService`, an `androidx.credentials.provider.CredentialProviderService`,
declared in the manifest with `BIND_CREDENTIAL_PROVIDER_SERVICE` and pointed at
`res/xml/credential_provider.xml`, which declares passkeys and nothing else.

**API 34+.** `CredentialProviderService` did not exist before Android 14. The
service is annotated `@RequiresApi` and the Passkeys screen says so on older
devices; everything else in the wallet works as normal there.

The service shows no interface and does no cryptography — it answers "here is
what I have and here is how to ask me for it". Every real answer is a
`PendingIntent` into `PasskeyConsentActivity`, which asks for a biometric and
then signs. The intent is `FLAG_MUTABLE` because the system writes the request
into it before sending; an immutable one arrives empty.

Keys are generated with `setUserAuthenticationRequired(true)`, so the device
being unlocked is not merely policy — the key is unusable without it.

The holder enables it at **Settings › Passwords & accounts › Passwords, passkeys
and data services**.

## Where the holder sees them

Settings › **Passkeys for other services** in both wallets. The list groups by
relying party and shows the account, when it was created, and when it was last
used.

Deleting is honest about what it does: the key is erased and cannot be
recovered, and **the site still believes the passkey exists** — the wallet has
no way to tell it otherwise. The holder has to remove it there too, or sign-in
with it will simply stop working with no explanation from either side.

## The signature counter

Every assertion increments a per-credential counter that travels in
`authenticatorData`. It is how a relying party detects a cloned authenticator: a
counter that goes backwards means two copies of a key that should exist once.
It is stored with the record and incremented on use, never derived from
anything a caller supplies.

## Signing and provisioning

The extension is a **second bundle id** — `<app bundle id>.passkeys` — and both
it and the app need the **App Groups** capability on their App IDs. Neither
exists the first time you build after this change, which is why the release
script passes `-allowProvisioningUpdates` on the archive as well as the export:
without it on the archive, the build fails at the step *before* the one that
could have created what it was missing.

    error: No profiles for 'ca.vanguardcs.aegisid.wallet.dev.passkeys' were found
    error: Provisioning profile "…" doesn't include the App Groups capability
    error: Provisioning profile "…" doesn't support the group.ca.vanguardcs.aegisid.wallet App Group

That is what those three errors mean, and `scripts/release-ios.sh` handles them.

### The AutoFill Credential Provider entitlement

`com.apple.developer.authentication-services.autofill-credential-provider` has
to be `true` in the entitlements of **the app as well as the extension**. That
is easy to miss because nothing local complains: the archive builds, the code
signs, and App Store Connect rejects the upload afterwards.

    ERROR: Missing Entitlement. The extension bundle 'VanguardAegisWallet.app' is
    missing entitlement 'com.apple.developer.authentication-services.autofill-credential-provider'. (90729)

All five entitlements files carry it — the four app configurations and the
extension's. Adding a new configuration means adding it there too.

If Apple's API declines to create the App Group from the command line — it
sometimes does for a group identifier that has never existed on the account —
open the project in Xcode once, select each target, and add **App Groups** and
**Keychain Sharing** under Signing & Capabilities. Xcode registers both on the
portal, and every later build from the script works.

## Two failures that look like a permission problem

Both surface to the relying party as the same flat message — *"the request is
not allowed by the user agent or the platform"* — because WebAuthn has one error
for "the authenticator declined" and no way to say why.

**iOS: `$(AppIdentifierPrefix)` in Swift.** It is a build setting. Xcode expands
it in `.entitlements` and `Info.plist` and **not** in source, where it stays a
literal string and every keychain call fails with `errSecMissingEntitlement`.
The group is published through `AEGIS_KEYCHAIN_ACCESS_GROUP` in both Info.plists
and read at runtime.

**Android: signing with an unauthorised operation.** Keys are generated
auth-per-use, so a `Signature` has to be passed through
`BiometricPrompt.CryptoObject` and the *same object* used afterwards — a fresh
one throws `UserNotAuthenticatedException`. A CryptoObject also cannot travel
with `DEVICE_CREDENTIAL`, so an assertion asks for a biometric specifically
while registration, which authorises nothing, still accepts either.

## Testing it

There is no way to unit-test this end to end without a relying party, so use a
real one:

1. Build and install the wallet on a device or simulator running iOS 17+ or
   Android 14+.
2. Enable Aegis ID as a credential provider in the OS settings above.
3. Open a site that supports passkeys — `https://webauthn.io` is the usual
   choice — **on that same device**.
4. Register. The OS sheet should offer Aegis ID; pick it, confirm, and the
   passkey appears under Settings › Passkeys for other services.
5. Sign out, sign in again, and confirm the assertion is accepted.

A registration that succeeds and an assertion the site rejects almost always
means the signature covered the wrong bytes — it is
`authenticatorData ‖ clientDataHash`, in that order.
