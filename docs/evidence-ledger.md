# Evidence Ledger (Feature A) — tamper-evident audit trail

The Aegis evidence ledger turns the audit log into a **hash-chained, optionally
signed, optionally anchored** record so that any edit or deletion is detectable
and pinpointable. It implements the "immutable evidence ledger" described in the
product overview. Design rationale lives in
[`docs/plans/ledger-and-indy-integration-plan.md`](plans/ledger-and-indy-integration-plan.md) §5.A.

## What it does

Every audit event (`writeAuditEvent`) becomes a chained record:

```
payloadHash = sha256(canonical(id, type, data, createdAt))
hash        = sha256(seq . prevHash . payloadHash)
```

- **Hash-chain** — each record links to the previous one; editing/deleting any
  record breaks every later hash.
- **Signature** (optional) — the record `hash` is signed (Ed25519 locally, Azure
  Key Vault in production) for non-repudiation.
- **Anchor** (optional) — the signed head is periodically written to write-once
  storage (local files in dev, an Azure immutable Blob in production) so a stolen
  signing key can't silently rewrite-and-resign the whole chain.

Chaining is **on by default**; signing and anchoring are **off by default** and
enabled per environment.

## Configuration

See `.env.example` for the full list. Key flags:

| Variable | Default | Notes |
|---|---|---|
| `AUDIT_CHAIN_ENABLED` | `true` | Hash-chaining |
| `AUDIT_SIGNING_ENABLED` | `false` | Turn on signatures |
| `AUDIT_SIGNING_MODE` | `local` | `local` (dev key on disk) or `keyvault` (prod) |
| `AUDIT_ANCHOR_MODE` | `none` | `none`, `local-file`, or `azure-blob` |

## Verify integrity

**CLI (primary, no auth needed):**

```bash
node scripts/verify-audit-chain.js
```

Exit code `0` = intact, `1` = broken (prints the failing `seq` + reason), `2` = error.
Point it at any store with `AUDIT_STORE_PATH=/path/to/audit-events.json`.

**HTTP (admin-only):** `GET /api/audit/verify` → `{ ok, count }` or `{ ok:false, brokenAtSeq, reason }`.

## Manual local test

```bash
# isolate a demo store + dev signing key + local WORM anchor
export AUDIT_STORE_PATH=/tmp/demo-audit.json
export AUDIT_SIGNING_ENABLED=true
export AUDIT_SIGNING_LOCAL_KEY_PATH=/tmp/demo-key.json
export AUDIT_ANCHOR_MODE=local-file
export AUDIT_ANCHOR_DIR=/tmp/demo-heads
rm -f "$AUDIT_STORE_PATH"

# write a few events
node -e "const a=require('./src/services/audit-service');(async()=>{await a.writeAuditEvent('wallet.challenge.approved',{challengeId:'c1'});await a.writeAuditEvent('document.signed',{docId:'memo'});await a.writeAuditEvent('access.revoked',{subject:'contractor-42'});})()"

node scripts/verify-audit-chain.js        # → ✓ intact, 3 records

# tamper with the file, then re-verify
node -e "const fs=require('fs'),p=process.env.AUDIT_STORE_PATH,r=JSON.parse(fs.readFileSync(p));r[2].type='access.retained';fs.writeFileSync(p,JSON.stringify(r,null,2))"
node scripts/verify-audit-chain.js        # → ✗ payload-tampered at seq 2 (exit 1)
```

## Identity-lifecycle evidence helpers

`src/services/identity-evidence.js` provides typed wrappers used by the
Entra-federation + passkey flows (plan §5.F/§5.H): `recordIdentityProofed`,
`recordAuthenticatorBound`, `recordWalletEnrolled`, `recordIdentityAuthenticated`,
and `recordTaaAcceptance`. Each writes a well-known, chained event type.

## Tests

- `tests/evidence-chain.test.js` — chain math + tamper/deletion/reorder detection
- `tests/audit-service-chain.test.js` — write/sign/verify, redaction, tamper, forged signature, anchoring, legacy migration
- `tests/identity-evidence.test.js` — typed lifecycle helpers

## Production notes (not wired locally)

- `AUDIT_SIGNING_MODE=keyvault` and `AUDIT_ANCHOR_MODE=azure-blob` are interface
  stubs; wiring them to Azure Key Vault + an immutable-Blob container is a
  production task (plan §5.A.3, Phases 1–2). They intentionally throw if invoked
  locally so tests never require Azure credentials.
- The chain is linear and serialized in-process; multi-instance Azure App Service
  scaling needs a shared sequence (Postgres) — see plan §5.A.5 / open decision #5.
