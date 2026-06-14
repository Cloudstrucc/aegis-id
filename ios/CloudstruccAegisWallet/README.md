# Cloudstrucc Aegis Wallet for iOS

Cloudstrucc Aegis Wallet is a native SwiftUI starter project for the Aries interoperability lab in this repository.

It currently provides:

- Cloudstrucc-branded SwiftUI app shell.
- QR scanner for Aries Out-of-Band invitation URLs.
- Manual invitation paste/import.
- OOB invitation parser for ACA-Py `/out-of-band/create-invitation` URLs.
- Local connection list with state tracking.
- URL scheme hooks for `cloudstrucc-wallet://` and `aegisid://`.

It does not yet implement the full Aries wallet engine. A production Aries wallet still needs DIDComm transport, DIDExchange state machines, key management, secure storage, credential exchange, proof presentation, revocation handling, and protocol test coverage.

## Open And Build

```bash
open ios/CloudstruccAegisWallet/CloudstruccAegisWallet.xcodeproj
```

From the command line:

```bash
xcodebuild \
  -project ios/CloudstruccAegisWallet/CloudstruccAegisWallet.xcodeproj \
  -scheme CloudstruccAegisWallet \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

## Lab Flow

Start the ACA-Py lab from the repo root:

```bash
cd aries-lab
docker compose up -d acapy-mediator acapy-issuer acapy-verifier
```

Create an issuer invitation:

```bash
cd /Users/frederickpearson/repos/aegis-id
./aries-lab/scripts/create-issuer-invitation.sh | jq -r .invitation_url
```

For a physical iPhone, ensure `aries-lab/.env` uses your Mac LAN IP instead of `localhost`, then restart Docker Compose and regenerate the invitation.

## Engine Integration Options

The next implementation step is to connect the SwiftUI shell to an Aries engine. Practical options:

- Embed or bridge a mature Aries/Credo engine through a local service boundary.
- Use this SwiftUI shell as the native UX and call a Cloudstrucc-controlled Aries wallet service for lab flows.
- Build a native DIDComm/Aries engine in Swift, starting with DIDExchange and OOB, then credential exchange and presentation exchange.

For production, do not store keys or credentials in `UserDefaults`. Move wallet secrets into Keychain/Secure Enclave-backed storage and add backup/recovery policy before using real credentials.
