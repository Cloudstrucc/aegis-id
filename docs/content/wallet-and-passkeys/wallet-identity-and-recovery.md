---
title: Wallet Identity, Wallet ID and Recovery
description: How holders register a wallet, how credential invitations bind to it, and how a wallet is recovered on a new device.
category: Wallet and passkeys
---

# Wallet Identity, Wallet ID and Recovery

Every Aegis ID wallet has a **Wallet ID** — a shareable identifier the holder gives
to an organization administrator so credentials can be issued to that specific
wallet. This guide covers registration, the three ways an invitation binds to a
wallet, contact changes, and recovery.

Design rationale: [`docs/plans/wallet-identity-and-onboarding-plan.md`](../../plans/wallet-identity-and-onboarding-plan.md).
Step-by-step manual verification: [`docs/wallet-e2e-test-guide.md`](../../wallet-e2e-test-guide.md).

## Wallet ID

```
AEG-XXXX-XXXX-XXXX-XXXX
```

- 16 significant characters in **Crockford Base32**, which omits `I`, `L`, `O`
  and `U` so the value can be read aloud or retyped without ambiguity.
- The final character is a **mod-37 check symbol**. Every single-character typo
  and every adjacent transposition is rejected before the value reaches the
  server.
- Parsing is case- and dash-insensitive: `aeg4k7p2m9xqt3bh5j6` resolves to the
  same wallet as `AEG-4K7P-2M9X-QT3B-H5J6`.
- It is **an identifier, not a secret**. It travels inside invitation QR codes.
  Possession alone proves nothing, because sensitive operations also require the
  wallet's device key.

The same format logic exists in three places — `src/services/wallet-id.js`,
`WalletIdentity.swift`, and `WalletIdFormat.kt` — and all three are tested
against the shared vectors in `tests/fixtures/wallet-id-vectors.json`.

## First-run setup

1. The holder installs the app and enters their **email** (required) and
   **mobile number** (optional).
2. The app generates a **device key** that never leaves the device.
3. `POST /api/wallet/register` mints the Wallet ID.
4. The app shows the Wallet ID, then **ten single-use recovery codes**, once.
   Setup cannot be completed until the holder confirms they have saved them.

Installs that predate the Wallet ID have wallet data but no identity, so they are
routed through this same flow on next launch. Existing connections and
transactions are preserved.

## How invitations bind to a wallet

An administrator issuing a credential chooses one of three bindings.

| Mode | Bound on | Credential email | Assurance |
|---|---|---|---|
| **Wallet ID** | The Wallet ID on the invite | **Any** per-organization address | Highest |
| **Email** | The email registered on the wallet | Must equal the registered email | Medium |
| **Phone** | The phone registered on the wallet | Must equal the registered phone | Medium |

**Wallet ID binding is what supports holders who work with several
organizations.** A contractor can register their wallet as `me@personal.ca` and
still accept a credential a federal agency issued to `contractor@agency.gc.ca`,
because the binding is the Wallet ID, not the address.

Email and phone bindings must match the contact **registered on the wallet** — a
free-text address that belongs to no wallet cannot be accepted. These are shown
with a **Lower assurance** badge in the people table.

The wallet also checks the `wallet_id` in the QR before contacting the server, so
an invitation meant for someone else fails immediately with a clear message.

## Changing the wallet email or phone

The wallet's registered contact is what email- and phone-bound invitations match
on, so changing it is **challenge gated**:

1. `POST /api/wallet/:walletId/contact/challenge` stages the change.
2. The holder approves it in the wallet.
3. Only then is the value applied.

A pending, declined, or expired challenge never mutates the wallet. This is also
what closes the *change the email, then recover the wallet* takeover path.

## Recovery

Recovery is **not a backup restore**. The device key is non-exportable by design,
and credentials already live server-side. Recovery means: prove you hold Wallet
ID X, then **re-bind it to a new device key**.

Two consequences follow: **nothing sensitive is ever backed up** (there is no
seed phrase to leak), and **the Wallet ID never changes**, so the holder does not
have to re-share it with any organization.

| Tier | Evidence required | Restores |
|---|---|---|
| **0 — Synced passkey** | A platform passkey assertion | Same scope as Tier 1 |
| **1 — Self-service** | A recovery code **and** a contact one-time code | Low and medium assurance. **High assurance stays suspended**, and high-value operations are paused for 24 hours |
| **2 — Organization attested** | An administrator re-verifies the holder in person | **That organization's** credentials, including high assurance |
| **Hard stop** | — | No codes and no connected organization: the holder must enrol again |

Both factors are mandatory in Tier 1. A stolen recovery code without the one-time
code is refused, and a one-time code without a recovery code cannot complete a
recovery.

After any recovery:

- the previous device key is **revoked** and recorded in the wallet's key history;
- **contact changes are frozen for seven days**;
- **passkeys must be registered again** — they cannot move between devices;
- every step is written to the tamper-evident evidence ledger.

### Approving a Tier-2 recovery

Administrators holding the **Approve wallet recovery** privilege see a
**Wallet recovery** panel in the organization dashboard. The privilege is
deliberately separate from credential issuance so it can be granted and audited
on its own.

Re-verify the person the same way you did at onboarding — in person, or with
government photo ID plus a liveness check. Approving on the strength of a phone
call or an email alone is how wallets get taken over. Approval restores **only
your organization's** credentials; other organizations approve their own.

## Credential assurance levels

What a Tier-1 recovery suspends is driven by each credential's assurance level.

| Setting | Purpose |
|---|---|
| `CREDENTIAL_ASSURANCE_MODE` | `derive` (default) infers the level from the credential's assurance claim; `explicit` uses only the level the issuer supplies |
| `CREDENTIAL_ASSURANCE_HIGH_SIGNALS` | Claim values that count as high assurance. Default: `fido2, yubikey, hardware, passkey, webauthn, high` |
| `CREDENTIAL_ASSURANCE_HIGH_ROLE_PATTERN` | Roles whose credentials default to high assurance. Default: `admin` |
| `CREDENTIAL_ASSURANCE_DEFAULT` | Level used when nothing matches. Default: `medium` |

An explicitly supplied level always wins. Derivation only considers an assurance
value the issuer actually provided, so the sample claim default does not silently
mark every credential as high assurance.

## Delivery of recovery codes

One-time codes are sent to the wallet's registered contact. Configure delivery at
**/admin/notifications**:

- **Email (SMTP)** with presets for **Microsoft 365 / Exchange Online**
  (`smtp.office365.com:587`, STARTTLS) and **Gmail / Google Workspace**
  (`smtp.gmail.com:587`, STARTTLS), plus a custom option for on-premises relays.
  Gmail requires an **App Password**; Microsoft 365 needs SMTP AUTH enabled, or
  an app password when MFA is on.
- **SMS** via any provider that accepts a JSON POST, with a Twilio preset.

Secrets are never returned to the browser, and saving with a blank password keeps
the stored value. **Save and test SMTP** verifies credentials without sending
mail.

**In production, if no channel is configured, recovery fails closed** with a 503
rather than returning the code — returning it would let anyone who can reach the
API recover any wallet. Outside production the code is returned in the API
response so local testing needs no mail server.

## API summary

| Endpoint | Purpose |
|---|---|
| `POST /api/wallet/register` | Mint a Wallet ID for a device |
| `GET /api/wallet/:walletId/profile` | Wallet profile |
| `POST /api/wallet/:walletId/recovery-codes/regenerate` | New code set (invalidates the old one) |
| `POST /api/wallet/:walletId/contact/challenge` | Stage an email or phone change |
| `POST /api/wallet/contact/challenges/:id/resolve` | Approve or decline it |
| `POST /api/wallet/organization-invitations/:id/accept` | Join an organization |
| `POST /api/wallet/credential-invitations/:id/accept` | Accept a credential |
| `GET /api/wallet/credential-invitations/:id/status` | Poll invitation status |
| `POST /api/wallet/recovery/start` | Begin recovery, send the one-time code |
| `POST /api/wallet/recovery/:id/verify-otp` | Verify the one-time code |
| `POST /api/wallet/recovery/:id/redeem-code` | Tier 1 |
| `POST /api/wallet/recovery/:id/request-attestation` | Tier 2 |
| `POST /api/wallet/recovery/:id/complete` | Bind the new device key |
| `POST /api/wallet/recovery/:id/cancel` | "This wasn't me" |

## Organization invitations no longer require ACA-Py

Organization invitations are `aegisid://org-invite` deep links accepted directly
through the product API. They previously ran through the Aries lab, which meant
scanning hung wherever no ACA-Py holder agent was deployed. Set
`ARIES_ORG_INVITATION_MODE=aries-lab` to restore the DIDComm path for
interoperability testing.
