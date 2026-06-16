#!/usr/bin/env bash
set -euo pipefail

AGENT="${1:-issuer}"
CONNECTION_ID="${2:-}"

case "$AGENT" in
  issuer)
    ADMIN_URL="${ISSUER_ADMIN_URL:-http://localhost:4011}"
    ;;
  verifier)
    ADMIN_URL="${VERIFIER_ADMIN_URL:-http://localhost:5011}"
    ;;
  *)
    echo "Unknown agent '$AGENT'. Use 'issuer' or 'verifier'." >&2
    exit 1
    ;;
esac

if [[ -z "$CONNECTION_ID" ]]; then
  CONNECTION_ID="$(
    curl -s "$ADMIN_URL/connections" |
      jq -r '.results[] | select(.rfc23_state=="completed" or .state=="active") | .connection_id' |
      tail -n 1
  )"
fi

if [[ -z "$CONNECTION_ID" ]]; then
  echo "No completed $AGENT connection found at $ADMIN_URL." >&2
  echo "Create a fresh $AGENT invitation and accept it with the holder before sending a challenge." >&2
  exit 1
fi

echo "Sending trust ping from $AGENT connection $CONNECTION_ID" >&2
curl -sS -X POST "$ADMIN_URL/connections/$CONNECTION_ID/send-ping" \
  -H "Content-Type: application/json" \
  -d "{\"comment\":\"Cloudstrucc $AGENT wallet challenge\"}"
echo

echo "Sending basic message from $AGENT connection $CONNECTION_ID" >&2
curl -sS -X POST "$ADMIN_URL/connections/$CONNECTION_ID/send-message" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"Cloudstrucc $AGENT wallet challenge: confirm DIDComm channel is live.\"}"
echo
