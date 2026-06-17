# Vanguard Aegis ID Wallet TestFlight Release Runbook

Use this path to get the Vanguard Aegis ID Wallet onto colleagues' iPhones for business testing.

## Recommended Channel

Use **TestFlight internal testing** first, not a public App Store release.

The wallet is currently a lab/testing shell for Aegis ID and ACA-Py interoperability flows. It can be useful for internal QA, but public App Store review should wait until the wallet engine, secure key storage, production DIDComm handling, revocation, privacy disclosures, and HTTPS-only service endpoints are ready.

## Current Local Build Status

- Xcode project: `ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj`
- Scheme: `VanguardAegisWallet`
- Apple team configured in project: `GL46AP73ZQ`
- Current bundle identifier in the working tree: `fp613`
- Simulator build: passing
- iOS archive: passing
- App Store Connect export/upload: blocked by Apple account permissions

The App Store Connect export failed with:

```text
No provider associated with App Store Connect user
Team "Frederick Pearson" does not have permission to create "iOS App Store" provisioning profiles.
No profiles for 'fp613' were found
```

## Apple Account Setup Needed

1. Use the correct Apple Developer Program organization account for Vanguard Cloud Services.
2. In App Store Connect, ensure the signing-in Apple ID has one of these roles:
   - Account Holder
   - Admin
   - App Manager
   - Developer
3. Confirm the Apple Developer team ID to use in Xcode.
4. Choose the permanent bundle ID before first TestFlight upload.

Recommended bundle ID:

```text
com.vanguardcs.aegiswallet
```

If App Store Connect already has an app record with another bundle ID, use that exact ID instead.

## App Store Connect App Record

Create the app in App Store Connect:

- Platform: iOS
- Name: `Vanguard Aegis ID`
- Primary language: English
- Bundle ID: the permanent bundle ID selected above
- SKU: `vanguard-aegis-id-wallet`
- User access: Full Access unless the app should be scoped

## Xcode Project Settings

Open the project:

```bash
open ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj
```

In the `VanguardAegisWallet` target:

- Signing & Capabilities:
  - Team: Vanguard Cloud Services Apple Developer team
  - Bundle Identifier: permanent App Store Connect bundle ID
  - Automatically manage signing: enabled
- General:
  - Version: `0.1.0`
  - Build: increment for every upload, for example `2`, `3`, `4`

## Local Validation Commands

Simulator build:

```bash
xcodebuild \
  -project ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj \
  -scheme VanguardAegisWallet \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

iOS archive:

```bash
xcodebuild archive \
  -project ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj \
  -scheme VanguardAegisWallet \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath /tmp/VanguardAegisWallet.xcarchive \
  -allowProvisioningUpdates
```

Export an App Store Connect IPA:

```bash
xcodebuild -exportArchive \
  -archivePath /tmp/VanguardAegisWallet.xcarchive \
  -exportOptionsPlist /tmp/VanguardAegisWalletExportOptions.plist \
  -exportPath /tmp/VanguardAegisWalletExport \
  -allowProvisioningUpdates
```

## Upload

Preferred first upload:

1. Open Xcode.
2. Window > Organizer.
3. Select the latest `VanguardAegisWallet` archive.
4. Click **Distribute App**.
5. Choose **App Store Connect**.
6. Choose **Upload**.
7. Let Xcode manage signing.
8. Complete upload.

After processing finishes in App Store Connect, add the build to a TestFlight internal testing group.

## Internal Tester Setup

In App Store Connect:

1. Open the app.
2. Go to **TestFlight**.
3. Create an internal group, for example `Vanguard QA`.
4. Add business colleagues as App Store Connect users or eligible internal testers.
5. Add the uploaded build to the group.
6. Send the TestFlight invitation.

Internal builds are available to testers through the TestFlight app for 90 days.

## Before External/Public Release

Do not submit this wallet broadly until these items are closed:

- Replace lab-only ACA-Py admin bridge behavior with production-safe wallet transport.
- Store keys and credentials outside `UserDefaults`; use Keychain/Secure Enclave-backed storage.
- Remove broad `NSAllowsArbitraryLoads` and use HTTPS endpoints.
- Add privacy policy URL and App Privacy answers.
- Add support/contact URL.
- Add screenshots for required device sizes.
- Decide whether the app is internal-only, unlisted, custom app distribution, or public App Store.
