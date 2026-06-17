# iOS Aries Wallet

The Vanguard Aegis ID mobile app is the wallet experience for this lab. It gives the product a Vanguard-owned UX for invitations, organization context, wallet challenges, and local ledger review.

The native SwiftUI starter lives at:

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

1. Use `ios/VanguardAegisWallet` to shape the Vanguard Cloud Services native user experience.
2. Add an Aries engine adapter behind the SwiftUI shell.
3. Move all secrets to Keychain-backed storage before handling real credentials.
4. Keep this separate from the Microsoft Entra Verified ID production path until the Aries protocol bridge is intentionally productized.
