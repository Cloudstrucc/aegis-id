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

The wallet uses the hosted Aegis ID web app by default:

```text
https://vanguard-aegis-id-65067d.azurewebsites.net
```

That default is stored as `AEGIS_WEB_APP_BASE_URL` in `VanguardAegisWallet/Info.plist`. Change that value only when intentionally testing a local web app.

The simulator bridge still uses local ACA-Py admin URLs for DIDComm lab operations: `http://localhost:4011` for issuer admin and `http://localhost:6011` for holder admin. Those local admin URLs are simulator-lab controls and are not expected to work from a physical iPhone.

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
