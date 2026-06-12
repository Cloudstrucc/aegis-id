#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <schema_id>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

ISSUER_ADMIN_URL="${ISSUER_ADMIN_URL:-http://localhost:4011}"
SCHEMA_ID="$1"

post_json "$ISSUER_ADMIN_URL/credential-definitions" "{
  \"schema_id\": \"$SCHEMA_ID\",
  \"support_revocation\": true,
  \"tag\": \"cloudstrucc-employee-v1\"
}"
