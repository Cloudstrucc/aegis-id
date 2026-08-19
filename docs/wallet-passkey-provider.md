# The wallet as a FIDO2 passkey provider

> **Neither wallet ships this in 1.0.** On Android it is disabled through
> `passkeyProviderEnabled` in `app/build.gradle.kts`, which sets
> `android:enabled="false"` on the service and hides the Passkeys screen behind
> `BuildConfig.PASSKEY_PROVIDER_ENABLED`. Registration works there; the
> assertion does not, which is worse than failing outright — see the Android
> section below.
>
> **iOS 1.0 ships without this.** The extension is built but not embedded, the
> app's autofill entitlement is removed and the Passkeys screen is hidden behind
> `AegisWalletEnvironment.providesPasskeysForOtherServices`, because the failure
> at the end of this page is unresolved. Nothing here was deleted — flipping the
> flag and restoring two `project.pbxproj` entries ships it. Android is
> unaffected.

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

## Android, exercised on a device

Driven end to end against `https://webauthn.io` on a Pixel 8 emulator (API 37,
Play services), with Aegis ID as the only enabled credential provider.

**Registration works.** The system offers Aegis ID, the consent activity parses
the request, the holder verifies, and the site reports success.

**Assertion does not.** The provider signs and returns, Chrome accepts the
response, and the relying party answers *"Could not verify authentication
signature"*. What has been ruled out by inspection: the signature covers
`authenticatorData ‖ clientDataHash` in that order; the coordinates are padded
to exactly 32 bytes; the COSE key is EC2/ES256/P-256; the bytes signed are the
bytes returned. The remaining suspect is the public key the relying party stored
at registration, which nothing verifies at registration time because attestation
is `none` — a wrong key there fails every assertion afterwards and nothing
earlier. Verify a captured registration and assertion against
`@simplewebauthn/server`, as was done for iOS, to localise it.

Two bugs were found and fixed on the way, both of which had made the feature
impossible rather than unreliable:

**Success was read as refusal.** `verifyHolder` collapsed "did the holder
verify" into "did a Signature come back". Registration authorises no operation,
so it passes no Signature and gets none back — every successful registration was
treated as a refusal. The holder watched the prompt accept their PIN and the
request cancel anyway. The two are now reported separately.

**Chrome needs more of the response than the spec strictly requires it to
read.** Its CredMan-to-Mojo converter reads `publicKeyAlgorithm`, `publicKey`
and `authenticatorData` as their own JSON fields rather than unpacking them from
the attestation object, and fails the whole registration with
`field missing or invalid: publicKeyAlgorithm` when they are absent. All three
are now in `AuthenticatorAttestationResponseJSON`.

**A holder with no biometric enrolled can create a passkey and never use it.**
Assertion asks for `BIOMETRIC_STRONG` alone, because a `CryptoObject` cannot
travel with `DEVICE_CREDENTIAL` — so on a device with a PIN and no fingerprint,
`canAuthenticate` returns `BIOMETRIC_ERROR_NONE_ENROLLED` and the request is
cancelled. Registration accepts either factor, so the passkey is created and
then permanently unusable. Fixing it means generating keys with a short
authentication validity window instead of per-use authorisation, which trades a
little of the key's strictness for the feature working at all for anyone who has
not enrolled a biometric. That is a security decision, so it is stated here
rather than made quietly.

Diagnosis goes through the provider's own trail, which mirrors iOS's
`PasskeyDiagnostics`:

```bash
adb logcat -s AegisPasskey
```

## What has been verified, and what has not

Registration on iOS currently reaches `handed to iOS` — the extension builds a
credential, hands it over, and iOS reports no expiry — and Safari still fails
the page with `NotAllowedError`. These have each been checked rather than
assumed, so they do not need checking again:

| Checked | How | Result |
|---|---|---|
| Attestation object and assertion | Generated with the shipped Swift code, verified with `@simplewebauthn/server` — the library this platform uses | Both verify |
| Credential shape | Against `ASPasskeyRegistrationCredential.h` | Matches the documented initializer |
| Extension packaging | `pluginkit -mv` on a simulator | Registered against the app |
| Built capability keys | `plutil -p` on the built `.appex` | `ProvidesPasskeys => true`, correct extension point and principal class |
| Relying party config | `PASSKEY_RP_ID` / `PASSKEY_ORIGIN` per tenant | `rpId` equals the origin host |
| Extension lifecycle | Device logs via the Passkeys screen | Biometric runs, no expiry reported |

The simulator does **not** offer third-party credential providers in AutoFill
settings, so the end-to-end path cannot be exercised there — only on a device.

What remains unknown is why Safari rejects a credential iOS accepted. That
reason exists only in the device log:

```bash
# with the iPhone connected
log stream --device --predicate 'subsystem CONTAINS "AuthenticationServices" OR process == "Safari"' --level debug
```

Reproduce the registration while that runs. The rejection is named there and
nowhere else — the DOMException the page receives is the same sentence for
every cause.

Worth running alongside it: register on `https://webauthn.io`. It separates a
wallet problem from a problem with this platform's own request, and it takes a
minute.

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
