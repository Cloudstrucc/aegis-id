#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 4 ]]; then
  echo "Usage: $0 <connection_id> <cred_def_id> <issuer_did> <schema_id>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

ISSUER_ADMIN_URL="${ISSUER_ADMIN_URL:-http://localhost:4011}"
CONNECTION_ID="$1"
CRED_DEF_ID="$2"
ISSUER_DID="$3"
SCHEMA_ID="$4"

post_json "$ISSUER_ADMIN_URL/issue-credential-2.0/send" "{
  \"connection_id\": \"$CONNECTION_ID\",
  \"filter\": {
    \"indy\": {
      \"cred_def_id\": \"$CRED_DEF_ID\",
      \"issuer_did\": \"$ISSUER_DID\",
      \"schema_id\": \"$SCHEMA_ID\"
    }
  },
  \"credential_preview\": {
    \"@type\": \"issue-credential/2.0/credential-preview\",
    \"attributes\": [
      {\"name\":\"employeeId\",\"value\":\"CS-10027\"},
      {\"name\":\"displayName\",\"value\":\"Cloudstrucc Pilot User\"},
      {\"name\":\"email\",\"value\":\"pilot@cloudstrucc.com\"},
      {\"name\":\"department\",\"value\":\"Architecture\"},
      {\"name\":\"role\",\"value\":\"Identity Pilot\"},
      {\"name\":\"assuranceLevel\",\"value\":\"FIDO2_YUBIKEY\"},
      {\"name\":\"employmentStatus\",\"value\":\"active\"}
    ]
  }
}"
