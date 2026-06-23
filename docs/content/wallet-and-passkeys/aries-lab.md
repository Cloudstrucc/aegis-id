# Aries Interoperability Lab

The Aries lab is intentionally separate from the Microsoft-native production path. Use it to test DIDComm, ACA-Py, the Vanguard Aegis ID mobile app, AnonCreds, mediator flows, and development-ledger behavior.

## Start Agents

Open Docker Desktop first. The Aries lab depends on local Docker containers; if Docker is not running, `/api/aries/status` will report the ACA-Py admin endpoints as unreachable.

```bash
cd aries-lab
cp .env.example .env
docker compose up -d acapy-mediator acapy-issuer acapy-verifier
```

The compose file defaults to `ghcr.io/openwallet-foundation/acapy-agent:1.6` through `ACAPY_IMAGE_TAG=1.6`. If a specific ACA-Py tag disappears or is not published in GHCR, update `ACAPY_IMAGE_TAG` in `aries-lab/.env` to another available tag such as `latest` or a known-good release tag.

The default local lab starts ACA-Py with `--no-ledger` so the issuer, verifier, and mediator can boot without a VON/Indy genesis file. Use this mode for admin API health checks, connection experiments, and non-ledger protocol work. AnonCreds schema and credential-definition publishing requires adding a ledger profile and genesis configuration.

The local admin endpoints are:

- Mediator admin: `http://localhost:3011`
- Issuer admin: `http://localhost:4011`
- Verifier admin: `http://localhost:5011`

The Node app checks these with:

```bash
curl http://localhost:3000/api/aries/status
```

Expected healthy result:

```json
{
  "track": "aries-interoperability-lab",
  "checks": [
    { "name": "issuer", "baseUrl": "http://localhost:4011", "ok": true, "status": 200 },
    { "name": "verifier", "baseUrl": "http://localhost:5011", "ok": true, "status": 200 },
    { "name": "mediator", "baseUrl": "http://localhost:3011", "ok": true, "status": 200 }
  ]
}
```

If you see `ECONNREFUSED`, Docker Desktop is not running or the ACA-Py containers are not started. If you see `TimeoutError`, check container logs and port mappings.

## Invitations

```bash
aries-lab/scripts/create-issuer-invitation.sh
aries-lab/scripts/create-verifier-invitation.sh
```

The helper scripts create Out-of-Band invitations through ACA-Py's current `/out-of-band/create-invitation` admin route. The older `/connections/create-invitation` route is not available as a POST endpoint in the pinned ACA-Py image.

For deterministic local testing with an ACA-Py holder stand-in:

```bash
aries-lab/scripts/start-holder-standin.sh
aries-lab/scripts/create-issuer-invitation.sh > /tmp/vanguard-issuer-invite.json
aries-lab/scripts/accept-invitation-with-holder.sh /tmp/vanguard-issuer-invite.json | jq
aries-lab/scripts/send-wallet-challenge.sh issuer | jq
```

To test the verifier path, create and accept a verifier invitation before sending a verifier challenge:

```bash
aries-lab/scripts/create-verifier-invitation.sh > /tmp/vanguard-verifier-invite.json
aries-lab/scripts/accept-invitation-with-holder.sh /tmp/vanguard-verifier-invite.json | jq
aries-lab/scripts/send-wallet-challenge.sh verifier | jq
```

Use a fresh invitation for each acceptance test. Reusing the same single-use OOB invitation can leave records at `request-sent` and produce `reuse-not-accepted` ACA-Py log noise.

## AnonCreds Flow

The commands below require a running ledger-backed profile. The default `--no-ledger` compose mode is intentionally lighter and will not publish schemas or credential definitions.

```bash
SCHEMA_RESPONSE="$(aries-lab/scripts/create-schema.sh)"
echo "$SCHEMA_RESPONSE"

aries-lab/scripts/create-credential-definition.sh "<schema-id>"
aries-lab/scripts/issue-credential.sh "<connection-id>" "<cred-def-id>" "<issuer-did>" "<schema-id>"
aries-lab/scripts/request-proof.sh "<connection-id>"
```

## Safety Notes

- `--admin-insecure-mode` is local-development only.
- Do not expose ACA-Py admin ports to the public internet.
- Use a tunnel only for wallet transport endpoints, not admin APIs.
- Replace wallet keys before any shared lab.
- Treat VON/Indy as a development ledger, not a production trust registry.
