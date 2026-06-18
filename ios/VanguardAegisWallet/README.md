# Vanguard Aegis ID Wallet for iOS

Vanguard Aegis ID Wallet is a native SwiftUI starter project for the Aries interoperability lab in this repository.

It currently provides:

- Vanguard-branded SwiftUI app shell.
- QR scanner for Aries Out-of-Band invitation URLs.
- Manual invitation paste/import.
- OOB invitation parser for ACA-Py `/out-of-band/create-invitation` URLs.
- Local connection list with lab state tracking.
- Simulator-only Lab Bridge for accepting invitations through the local holder stand-in.
- Mock credential offer and acceptance transactions.
- Wallet challenge send/accept transactions over the local ACA-Py connection.
- OIDC web-app challenge fetch and accept flow for `/demo/oidc-wallet`.
- Optional wallet passkey registration and challenge approval using `AuthenticationServices`.
- URL scheme hooks for `aegisid://` and `aegisid://`.

Verified ID and YubiKey are web-app assurance methods in this demo. Microsoft Authenticator presents Verified ID credentials, and the browser performs YubiKey/FIDO2 WebAuthn step-up. The iOS wallet receives the downstream Aegis wallet challenge, signs the high-value action, and records the ledger event.

It does not yet implement the full Aries wallet engine. The Lab Bridge calls local ACA-Py admin APIs from the simulator. A production Aries wallet still needs DIDComm transport, DIDExchange state machines, key management, secure storage, credential exchange, proof presentation, revocation handling, and protocol test coverage.

## Open And Build

```bash
open ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj
```

From the command line:

```bash
xcodebuild \
  -project ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj \
  -scheme VanguardAegisWallet \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

## iOS Environments

The project has separate shared schemes and bundle identifiers so production, dev, and QA builds can be installed on the same iPhone.

| Environment | Xcode scheme | Bundle ID | Display name | Aegis web app |
| --- | --- | --- | --- | --- |
| Production | `VanguardAegisWallet` | `ca.vanguardcs.aegisid.wallet` | `Aegis ID` | `https://vanguard-aegis-id-65067d.azurewebsites.net` |
| Dev | `VanguardAegisWallet Dev` | `ca.vanguardcs.aegisid.wallet.dev` | `Aegis ID Dev` | `https://vanguard-aegis-id-dev-65067d.azurewebsites.net` |
| QA | `VanguardAegisWallet QA` | `ca.vanguardcs.aegisid.wallet.qa` | `Aegis ID QA` | `https://vanguard-aegis-id-qa-65067d.azurewebsites.net` |

The matching associated-domain entitlements are:

```text
VanguardAegisWallet.entitlements       -> vanguard-aegis-id-65067d.azurewebsites.net
VanguardAegisWallet-Dev.entitlements   -> vanguard-aegis-id-dev-65067d.azurewebsites.net
VanguardAegisWallet-QA.entitlements    -> vanguard-aegis-id-qa-65067d.azurewebsites.net
```

Before testing wallet passkeys in dev or QA, deploy the matching Aegis ID web app so these endpoints return the matching bundle ID:

```text
https://vanguard-aegis-id-dev-65067d.azurewebsites.net/.well-known/apple-app-site-association
https://vanguard-aegis-id-qa-65067d.azurewebsites.net/.well-known/apple-app-site-association
```

The root `.env.dev` and `.env.qa` files set `IOS_APP_BUNDLE_ID` to the dev/QA bundle identifiers so the web app publishes the correct Apple association document.

Simulator builds:

```bash
xcodebuild \
  -project ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj \
  -scheme "VanguardAegisWallet Dev" \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build

xcodebuild \
  -project ios/VanguardAegisWallet/VanguardAegisWallet.xcodeproj \
  -scheme "VanguardAegisWallet QA" \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Device/TestFlight archive builds:

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

## Complete Simulator Test Process

Use this flow when testing the wallet side of Vanguard Cloud Services - Aegis ID from the iOS Simulator.

1. Start the Express app:

   ```bash
   cd /Users/frederickpearson/repos/aegis-id
   npm install
   cp .env.example .env
   npm run dev
   ```

2. Start the Aries lab:

   ```bash
   cd /Users/frederickpearson/repos/aegis-id/aries-lab
   cp .env.example .env
   docker compose up -d acapy-mediator acapy-issuer acapy-verifier
   ```

3. Start the local holder stand-in:

   ```bash
   cd /Users/frederickpearson/repos/aegis-id
   ./aries-lab/scripts/start-holder-standin.sh
   ```

4. Build and run this iOS app in Simulator.

5. Create an org issuer invitation from the web app:

   - Open `/dashboard/<subscription-id>`.
   - In **Issuing organization**, select **Create Org Issuer Invitation**.
   - Scan the Vanguard Aegis ID Wallet QR or copy the generated deep link into the simulator.

6. In the simulator app, paste or scan the invitation, open **Connections**, open the org issuer connection, then tap **Accept invitation in lab**.

When the invitation contains Vanguard Cloud Services org metadata, the simulator wallet registers the accepted holder/issuer connection back to the Express app. That makes the org available as an OIDC wallet challenge sender.

After that, the simulator wallet can test mock credential issuance, local DIDComm challenges, and web-app wallet challenge flows triggered after Verified ID or YubiKey assurance.

## Lab Credential And Challenge Flow

With an accepted issuer connection:

1. Tap **Issue mock credential**.
2. Tap **Accept credential** in the Wallet transactions section.
3. Tap **Send wallet challenge**.
4. Tap **Accept challenge** in the Wallet transactions section.

The transaction list should show invitation, mock credential, and challenge events. The challenge acceptance sends a basic message back through the holder stand-in.

## OIDC Web App Challenge Demo

Start the Express app and open the example relying-party app:

```bash
cd /Users/frederickpearson/repos/aegis-id
npm run dev
```

Open:

```text
http://localhost:3000/demo/oidc-wallet
```

After OIDC login succeeds in the browser:

1. Choose the issuing org that should send the challenge.
2. Send the wallet challenge from the browser.
3. Open the accepted org issuer connection in the simulator wallet.
4. Tap **Fetch OIDC challenges**.
5. Tap **Accept challenge** on the pending OIDC wallet challenge.
6. The browser redirects to the protected app after the wallet callback succeeds.

The production wallet uses the hosted Aegis ID web app by default:

```text
https://vanguard-aegis-id-65067d.azurewebsites.net
```

That value is supplied by the selected Xcode build configuration as `AEGIS_WEB_APP_BASE_URL`; do not edit `Info.plist` directly for environment switching.

The simulator bridge still uses local ACA-Py admin URLs for DIDComm lab operations: `http://localhost:4011` for issuer admin and `http://localhost:6011` for holder admin. Those local admin URLs are simulator-lab controls and are not expected to work from a physical iPhone.

## Wallet Passkey Approval Assurance

Wallet passkeys are optional. Use them only when an organization requires extra assurance for approvals, revocations, admin promotion, contract decisions, or expense decisions.

1. Deploy Aegis ID to HTTPS.
2. Confirm the web app serves:

   ```text
   https://vanguard-aegis-id-65067d.azurewebsites.net/.well-known/apple-app-site-association
   ```

3. In Xcode, keep the app bundle ID and associated domain entitlement aligned:

   ```text
   ca.vanguardcs.aegisid.wallet
   webcredentials:vanguard-aegis-id-65067d.azurewebsites.net
   ```

4. In the iOS wallet, open **Settings > Wallet passkey assurance**.
5. Enter the wallet subject email and tap **Register passkey**.
6. When a Ledger item shows **Passkey required**, tap **Verify Passkey And ...** to complete Face ID/Touch ID/device passcode and submit the signed wallet approval.

For local simulator testing, passkey behavior depends on the simulator and associated-domain state. Real-device testing is the better validation path once TestFlight is configured.

## Platform Coverage From The Wallet Perspective

| Platform | What the web app tests | What the iOS wallet participates in |
| --- | --- | --- |
| Microsoft Entra Verified ID | Mock or live issuance/presentation request creation | Mock QR handoff only today; live Microsoft wallet testing should use Microsoft Authenticator |
| Keycloak OIDC | Metadata discovery and claim mapping in the setup wizard | OIDC + wallet challenge demo can represent the step-up pattern after Keycloak login |
| Keycloak SAML | SAML metadata reachability and claim mapping | Same step-up pattern after SAML login; wallet challenge is separate from SAML assertion validation |
| Okta OIDC | Metadata discovery and group/claim mapping | Same OIDC + wallet challenge pattern after Okta login |
| Okta SAML | SAML metadata reachability and group/claim mapping | Same step-up pattern after Okta SAML login |
| Generic OIDC / SAML | Standards-based OIDC or SAML metadata validation | Same wallet challenge can be used after any upstream IdP completes browser SSO |

For a physical iPhone, ensure `aries-lab/.env` uses your Mac LAN IP instead of `localhost`, then restart Docker Compose and regenerate the invitation. The current Lab Bridge defaults are simulator-oriented and use localhost admin APIs.

## Engine Integration Options

The next implementation step is to connect the SwiftUI shell to an Aries engine. Practical options:

- Embed or bridge a mature Aries/Credo engine through a local service boundary.
- Use this SwiftUI shell as the native UX and call a Vanguard-controlled Aries wallet service for lab flows.
- Build a native DIDComm/Aries engine in Swift, starting with DIDExchange and OOB, then credential exchange and presentation exchange.

For production, do not store keys or credentials in `UserDefaults`. Move wallet secrets into Keychain/Secure Enclave-backed storage and add backup/recovery policy before using real credentials.

## TestFlight Release

For business-colleague testing on physical iPhones, use the TestFlight runbook in [TESTFLIGHT_RELEASE.md](TESTFLIGHT_RELEASE.md).
