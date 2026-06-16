# iOS Aries Wallet

The fastest way to test the Aries lab from an iPhone is to use an existing Aries/DIDComm wallet built for Out-of-Band invitations. The best-known open-source mobile wallet family is OpenWallet Foundation Bifold, which is a React Native wallet shell used by Aries/Credo ecosystems.

For Vanguard-owned UX and experiments, this repo now includes a native SwiftUI starter:

```text
ios/VanguardAegisWallet/
```

## What The Starter Does

- Scans Aries Out-of-Band QR codes.
- Parses ACA-Py `invitation_url` values.
- Saves imported invitations as local connection records.
- Provides a Vanguard-branded iOS wallet shell.

## What Still Needs A Real Aries Engine

- DIDComm message packing/unpacking.
- DIDExchange protocol execution.
- Holder key management.
- Credential issuance protocol.
- Presentation/proof protocol.
- Revocation and credential status.
- Keychain/Secure Enclave storage.
- Backup, recovery, lockout, and device migration.

## Recommended Build Path

1. Use an existing Aries-compatible wallet for immediate lab testing.
2. Use `ios/VanguardAegisWallet` to shape the Vanguard Cloud Services native user experience.
3. Add an Aries engine adapter behind the SwiftUI shell.
4. Move all secrets to Keychain-backed storage before handling real credentials.
5. Keep this separate from the Microsoft Entra Verified ID production path until the Aries protocol bridge is intentionally productized.
