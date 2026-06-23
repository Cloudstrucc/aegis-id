---
title: iOS TestFlight release
description: Prepare Vanguard Aegis ID Wallet builds for TestFlight distribution across production, dev, and QA.
order: 60
---

# Vanguard Aegis ID Wallet TestFlight Release Runbook

Use this path to get the Vanguard Aegis ID Wallet onto colleagues' iPhones for business testing.

## Recommended Channel

Use **TestFlight internal testing** first, not a public App Store release.

The wallet is currently a lab/testing shell for Aegis ID and ACA-Py interoperability flows. It can be useful for internal QA, but public App Store review should wait until the wallet engine, secure key storage, production DIDComm handling, revocation, privacy disclosures, and HTTPS-only service endpoints are ready.

## Current Local Build Status

- Xcode project: `ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj`
- Schemes: `VanguardAegisWallet`, `VanguardAegisWallet Dev`, `VanguardAegisWallet QA`
- Apple team configured in project: `GL46AP73ZQ`
- Production bundle identifier: `ca.vanguardcs.aegisid.wallet`
- Dev bundle identifier: `ca.vanguardcs.aegisid.wallet.dev`
- QA bundle identifier: `ca.vanguardcs.aegisid.wallet.qa`
- Simulator build: passing for Dev and QA
- iOS archive: requires Apple Developer/App Store Connect permissions and matching App IDs/profiles
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
4. Create or confirm App IDs for each environment you want to distribute.

Recommended bundle IDs:

```text
ca.vanguardcs.aegisid.wallet
ca.vanguardcs.aegisid.wallet.dev
ca.vanguardcs.aegisid.wallet.qa
```

## App Store Connect App Record

Create separate app records in App Store Connect if you want separate TestFlight channels/installable apps:

- Platform: iOS
- Production name: `Vanguard Aegis ID`
- Dev name: `Vanguard Aegis ID Dev`
- QA name: `Vanguard Aegis ID QA`
- Primary language: English
- Bundle ID: the matching environment bundle ID
- SKU examples: `vanguard-aegis-id-wallet`, `vanguard-aegis-id-wallet-dev`, `vanguard-aegis-id-wallet-qa`
- User access: Full Access unless the app should be scoped

## Xcode Project Settings

Open the project:

```bash
open ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj
```

In the `VanguardAegisWallet` target:

- Signing & Capabilities:
  - Team: Vanguard Cloud Services Apple Developer team
  - Bundle Identifier: selected by the scheme/build configuration
  - Automatically manage signing: enabled
- General:
  - Version: `0.1.0`
  - Build: increment for every upload, for example `2`, `3`, `4`

Environment mapping:

| Environment | Scheme | Bundle ID | Default web app |
| --- | --- | --- | --- |
| Production | `VanguardAegisWallet` | `ca.vanguardcs.aegisid.wallet` | `vanguard-aegis-id-65067d.azurewebsites.net` |
| Dev | `VanguardAegisWallet Dev` | `ca.vanguardcs.aegisid.wallet.dev` | `vanguard-aegis-id-dev-0e75d1.azurewebsites.net` |
| QA | `VanguardAegisWallet QA` | `ca.vanguardcs.aegisid.wallet.qa` | `vanguard-aegis-id-qa-0e75d1.azurewebsites.net` |

The wallet entitlements intentionally include multiple `webcredentials:` and `applinks:` domains for prod/dev/QA across the known tenant suffixes. Each listed Aegis web app must serve `/.well-known/apple-app-site-association` with the wallet bundle IDs before iOS will activate passkeys or universal links for that host.

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

Dev simulator build:

```bash
xcodebuild \
  -project ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj \
  -scheme "VanguardAegisWallet Dev" \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

QA simulator build:

```bash
xcodebuild \
  -project ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj \
  -scheme "VanguardAegisWallet QA" \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

iOS archive:

```bash
xcodebuild archive \
  -project ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj \
  -scheme "VanguardAegisWallet Dev" \
  -destination 'generic/platform=iOS' \
  -archivePath /tmp/VanguardAegisWallet-Dev.xcarchive \
  -allowProvisioningUpdates

xcodebuild archive \
  -project ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj \
  -scheme "VanguardAegisWallet QA" \
  -destination 'generic/platform=iOS' \
  -archivePath /tmp/VanguardAegisWallet-QA.xcarchive \
  -allowProvisioningUpdates
```

Export an App Store Connect IPA:

```bash
xcodebuild -exportArchive \
  -archivePath /tmp/VanguardAegisWallet-Dev.xcarchive \
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

## Public TestFlight Links For The Homepage

For non-technical business testers, App Store Connect can create a public TestFlight invitation link. Use separate links if you publish separate production, dev, and QA wallet apps.

1. Open the app record in App Store Connect.
2. Go to **TestFlight**.
3. Open the testing group that contains the build.
4. Enable **Public Link**.
5. Optionally set a tester limit.
6. Copy the public link.
7. Store the link in the matching Aegis ID web app environment.

Production:

```bash
az webapp config appsettings set \
  --resource-group rg-vanguard-aegis-id \
  --name vanguard-aegis-id-65067d \
  --settings IOS_TESTFLIGHT_PUBLIC_URL="https://testflight.apple.com/join/REPLACE_ME"
```

Dev:

```bash
az webapp config appsettings set \
  --resource-group rg-vanguard-aegis-id-dev \
  --name vanguard-aegis-id-dev-0e75d1 \
  --settings IOS_TESTFLIGHT_PUBLIC_URL="https://testflight.apple.com/join/REPLACE_DEV"
```

QA:

```bash
az webapp config appsettings set \
  --resource-group rg-vanguard-aegis-id-qa \
  --name vanguard-aegis-id-qa-0e75d1 \
  --settings IOS_TESTFLIGHT_PUBLIC_URL="https://testflight.apple.com/join/REPLACE_QA"
```

The deploy script also reads `IOS_TESTFLIGHT_PUBLIC_URL` from `.env`, `.env.dev`, or `.env.qa`. If you set the value directly in Azure, keep the env file blank unless you intentionally want the next deploy to overwrite it.

After the setting is applied, restart or redeploy the matching web app and open the anonymous homepage. The iOS download badge should link to TestFlight. Android remains controlled by `ANDROID_TESTING_URL`.

## Before External/Public Release

Do not submit this wallet broadly until these items are closed:

- Replace lab-only ACA-Py admin bridge behavior with production-safe wallet transport.
- Store keys and credentials outside `UserDefaults`; use Keychain/Secure Enclave-backed storage.
- Remove broad `NSAllowsArbitraryLoads` and use HTTPS endpoints.
- Add privacy policy URL and App Privacy answers.
- Add support/contact URL.
- Add screenshots for required device sizes.
- Decide whether the app is internal-only, unlisted, custom app distribution, or public App Store.
