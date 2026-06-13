# Aries Interoperability Lab

The Aries lab is intentionally separate from the Microsoft-native production path. Use it to test DIDComm, ACA-Py, Bifold/Credo-compatible wallets, AnonCreds, mediator flows, and development-ledger behavior.

## Start Agents

Open Docker Desktop first. The Aries lab depends on local Docker containers; if Docker is not running, `/api/aries/status` will report the ACA-Py admin endpoints as unreachable.

```bash
cd aries-lab
cp .env.example .env
docker compose up -d acapy-mediator acapy-issuer acapy-verifier
```

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

## AnonCreds Flow

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
