# End-to-End Test Guide — Account, Organization, Credential, Recovery

Manual verification for the wallet identity work on branch `feature/wallet-identity`.
Everything here runs **locally**; nothing needs Azure, Docker, or ACA-Py.

Design rationale: [`docs/plans/wallet-identity-and-onboarding-plan.md`](plans/wallet-identity-and-onboarding-plan.md).

---

## 0. Start clean

```bash
cd /Users/frederickpearson/repos/aegis-id
git checkout feature/wallet-identity
npm test                       # expect 127 passing
APP_ENV=local npm start        # http://localhost:3000
```

To start from an empty state, move the data directory aside first:

```bash
mv data data.backup.$(date +%s) 2>/dev/null; mkdir -p data
```

Useful throughout — the evidence ledger must stay intact after every journey:

```bash
node scripts/verify-audit-chain.js
```

---

## Journey 1 — New account and organization (web)

**Deliberately stop Docker first.** Before this work, workspace creation threw
`TypeError: fetch failed` and the wallet QR hung on "accepting invitation through
the local holder". Both are now gone.

1. Open http://localhost:3000, create an account, verify, sign in.
2. Subscribe an organization (e.g. `VCS-613`).

**Expect**
- You land straight in the organization, **not** on "Register your organization to continue".
- No 500, no `fetch failed`.
- The onboarding QR is an `aegisid://org-invite?...` link (**not** a DIDComm `oob=` URL).
- The admin who registered the org **already holds a credential** — check the people table.

```bash
# confirm the workspace and admin credential exist
node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync('data/org-admin.json'))[0].credentials.map(c=>({email:c.holderEmail,status:c.status,mode:c.bindingMode})),null,2))"
```

---

## Journey 2 — Wallet setup and Wallet ID

### 2a. Via API (fastest)

```bash
curl -s -X POST http://localhost:3000/api/wallet/register \
  -H 'content-type: application/json' \
  -d '{"email":"holder@example.com","phone":"613-555-0100","devicePublicKey":"demo-device-key-1"}'
```

Save the returned `walletId` (format `AEG-XXXX-XXXX-XXXX-XXXX`).

```bash
export WID="AEG-...."   # paste yours
curl -s "http://localhost:3000/api/wallet/$WID/profile"
```

**Check the typo protection** — change one character and confirm it is rejected:

```bash
node -e "const w=require('./src/services/wallet-id');const id=process.env.WID;
console.log('as issued :', w.isValidWalletId(id));
console.log('one typo  :', w.isValidWalletId(id.slice(0,-1)+(id.slice(-1)==='0'?'1':'0')));"
```

### 2b. Via the iOS app

```bash
cd ios/VanguardAegisWallet
xcodebuild -project VanguardAegisWallet.xcodeproj -scheme VanguardAegisWallet \
  -destination 'platform=iOS Simulator,name=iPhone 16' build
```

Point the app at your machine (`AEGIS_WEB_APP_BASE_URL` in Info.plist) and run it.

**Expect** the app opens on **Set up your wallet**, not the tab bar:
1. Welcome → **Get started**
2. Enter email (required) and mobile (optional) — **no `identity@vanguardcs.ca` prefill**
3. Wallet ID displayed large, with Copy
4. **10 recovery codes shown once** — *Finish setup* stays disabled until you tick "I have saved these codes"
5. Tabs become available only after setup

Save those 10 codes; Journey 5 needs one.

---

## Journey 3 — Credential issuance and the multi-org case

This is the binding model. Mode 1 is the one that unblocks holders who work with
several organizations.

1. In the dashboard, **Issue credential**.
2. Set **Holder email** to something *different* from the wallet email — e.g. `contractor@agency.gc.ca`.
3. Paste the **Wallet ID** from Journey 2.
4. Issue, then open the invite modal and **leave it open**.

**Accept as the wallet** (second terminal):

```bash
curl -s -X POST http://localhost:3000/api/wallet/credential-invitations/CRED_ID/accept \
  -H 'content-type: application/json' \
  -d "{\"organizationId\":\"WORKSPACE_ID\",\"walletId\":\"$WID\"}"
```

**Expect**
- The modal **closes by itself** within ~3 seconds and the row refreshes.
- Status → **active**, consent → **granted** (it used to stick on "consent requested").
- The credential email differs from the wallet email and it still worked.

**Now the negative case** — issue a second credential to the same Wallet ID, then
try to accept with a *different* wallet:

```bash
curl -s -X POST http://localhost:3000/api/wallet/register -H 'content-type: application/json' \
  -d '{"email":"someone.else@example.com","devicePublicKey":"demo-device-key-2"}'
# use that second walletId against the first credential
```

**Expect** `This invitation is for a different wallet.` and the credential stays `invited`.

**Mode 2 (email) and Mode 3 (phone)** — issue with *no* Wallet ID:
- Email invite to `holder@example.com` (the registered wallet email) → accepts.
- Email invite to `stranger@example.com` (no wallet) → **rejected**.
- Both show a **"Lower assurance"** badge in the people table.

---

## Journey 4 — Organization connect from the wallet

Take `invitation_id` from the org QR's query string.

```bash
curl -s -X POST http://localhost:3000/api/wallet/organization-invitations/INVITATION_ID/accept \
  -H 'content-type: application/json' -d "{\"walletId\":\"$WID\"}"
```

**Expect** `{"ok":true,"status":"connected",...}` — **with Docker still stopped**.
Run it a second time: it is idempotent (`acceptedAt` unchanged, no duplicate row).
Reload the dashboard — the workspace shows connected without the reload dance.

---

## Journey 5 — Contact change (challenge gated)

```bash
# 1. request the change
curl -s -X POST "http://localhost:3000/api/wallet/$WID/contact/challenge" \
  -H 'content-type: application/json' -d '{"field":"email","value":"new@example.com"}'

# 2. BEFORE approving, confirm nothing changed
curl -s "http://localhost:3000/api/wallet/$WID/profile"

# 3. approve it
curl -s -X POST http://localhost:3000/api/wallet/contact/challenges/CHALLENGE_ID/resolve \
  -H 'content-type: application/json' -d '{"decision":"approve"}'

# 4. now it has changed
curl -s "http://localhost:3000/api/wallet/$WID/profile"
```

**Expect** the email only changes after step 3. Declining (`"decision":"decline"`)
leaves it untouched.

---

## Journey 6 — Recovery: new phone, Tier 1 (recovery code)

Simulates losing the device. The Wallet ID **must survive**.

```bash
# 1. start — outside production the OTP is returned so no SMS provider is needed
curl -s -X POST http://localhost:3000/api/wallet/recovery/start \
  -H 'content-type: application/json' -d "{\"walletId\":\"$WID\"}"
# → { "request": { "id": "..." }, "otp": "123456" }

export RID="..."   # request id
export OTP="..."

# 2. ATTACK CHECK — a recovery code without the OTP must be refused
curl -s -X POST http://localhost:3000/api/wallet/recovery/$RID/redeem-code \
  -H 'content-type: application/json' -d '{"code":"ONE-OF-YOUR-CODES"}'
# → "Verify the code sent to your registered contact first."

# 3. verify the OTP
curl -s -X POST http://localhost:3000/api/wallet/recovery/$RID/verify-otp \
  -H 'content-type: application/json' -d "{\"otp\":\"$OTP\"}"

# 4. redeem a real code
curl -s -X POST http://localhost:3000/api/wallet/recovery/$RID/redeem-code \
  -H 'content-type: application/json' -d '{"code":"ONE-OF-YOUR-CODES"}'

# 5. bind the new device
curl -s -X POST http://localhost:3000/api/wallet/recovery/$RID/complete \
  -H 'content-type: application/json' -d '{"devicePublicKey":"new-phone-key-1"}'
```

**Expect from step 5**
- `walletId` is **unchanged** — the holder never re-shares it.
- `restoreScope: "low-medium"`, `suspendsHighAssurance: true` — high-assurance credentials stay suspended.
- `coolingOffUntil` ~24h ahead, `contactFrozenUntil` ~7 days ahead.

**Then confirm the two follow-on guards:**

```bash
# the old device key is revoked and recorded
node -e "const w=JSON.parse(require('fs').readFileSync('data/wallets.json'))[0];console.log({current:w.devicePublicKey,history:w.deviceKeyHistory})"

# change-email-then-recover is blocked by the contact freeze
curl -s -X POST "http://localhost:3000/api/wallet/$WID/contact/challenge" \
  -H 'content-type: application/json' -d '{"field":"email","value":"attacker@evil.test"}'
# → 423, contact changes frozen
```

Reusing the same recovery code again must fail — codes are single use.

---

## Journey 7 — Recovery: Tier 2 (organization attested)

For a holder with **no** recovery codes.

```bash
curl -s -X POST http://localhost:3000/api/wallet/recovery/start \
  -H 'content-type: application/json' -d '{"email":"holder@example.com"}'
curl -s -X POST http://localhost:3000/api/wallet/recovery/$RID/verify-otp \
  -H 'content-type: application/json' -d "{\"otp\":\"$OTP\"}"
curl -s -X POST http://localhost:3000/api/wallet/recovery/$RID/request-attestation \
  -H 'content-type: application/json' -d '{"organizationId":"WORKSPACE_ID"}'
```

The request now sits awaiting the organization. Approve it server-side:

```bash
node -e "require('./src/services/wallet-recovery-service').approveOrgAttestation(process.env.RID,{approvedBy:'admin@vcs.ca',method:'in-person'}).then(r=>console.log(r))"
curl -s -X POST http://localhost:3000/api/wallet/recovery/$RID/complete \
  -H 'content-type: application/json' -d '{"devicePublicKey":"new-phone-key-2"}'
```

**Expect** `restoreScope: "org"`, `suspendsHighAssurance: false`, `coolingOffUntil: null`
— and only **that** organization's credentials are in scope.

**Hard stop** — a wallet with no codes and no connected org:

```bash
curl -s "http://localhost:3000/api/wallet/SOME_WID/recovery-options"
# → { "hardStop": true, ... }  → re-enrolment required, no self-service path
```

---

## Journey 8 — Evidence ledger

Every journey above should be recorded and the chain must still verify.

```bash
node scripts/verify-audit-chain.js
node -e "console.log([...new Set(JSON.parse(require('fs').readFileSync('data/audit-events.json')).map(e=>e.type))].sort().join('\n'))"
```

**Expect** `✓ Evidence ledger intact` plus events including `wallet.registered`,
`wallet.organization.accepted`, `wallet.credential.accepted`, `wallet.contact.changed`,
`wallet.recovery.initiated`, `wallet.recovery.code.redeemed`, `wallet.recovery.completed`.

**Tamper test** — edit one record and prove it is detected:

```bash
node -e "const fs=require('fs'),p='data/audit-events.json',r=JSON.parse(fs.readFileSync(p));r[1].type='tampered';fs.writeFileSync(p,JSON.stringify(r,null,2))"
node scripts/verify-audit-chain.js    # → ✗ payload-tampered at seq 1, exit 1
```

Restore your backup afterwards.

---

## Automated suites

```bash
npm test                                                    # 127 Node tests
cd android/VanguardAegisWallet && ./gradlew :app:testDebugUnitTest   # 6 Kotlin tests
cd ios/VanguardAegisWallet && xcodebuild -project VanguardAegisWallet.xcodeproj \
  -scheme VanguardAegisWallet -destination 'generic/platform=iOS Simulator' build
```

---

## What is intentionally not covered

- **Azure**: nothing here deploys. Use `scripts/deploy-azure-webapp.sh --env dev` when you choose to.
- **Real SMS/email**: OTPs are echoed by the API outside production (decision #3, self-asserted phone).
- **Key Vault signing / WORM anchoring**: production stubs; local runs use the dev signer and file anchor.
- **Live Indy networks**: CANdy and Sovrin need genesis, an endorser, and TAA acceptance.
