#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <connection_id>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

VERIFIER_ADMIN_URL="${VERIFIER_ADMIN_URL:-http://localhost:5011}"
CONNECTION_ID="$1"

post_json "$VERIFIER_ADMIN_URL/present-proof-2.0/send-request" "{
  \"connection_id\": \"$CONNECTION_ID\",
  \"presentation_request\": {
    \"indy\": {
      \"name\": \"Cloudstrucc Employee Access Proof\",
      \"version\": \"1.0\",
      \"requested_attributes\": {
        \"employeeId\": {\"name\": \"employeeId\"},
        \"email\": {\"name\": \"email\"},
        \"employmentStatus\": {\"name\": \"employmentStatus\"},
        \"assuranceLevel\": {\"name\": \"assuranceLevel\"}
      },
      \"requested_predicates\": {}
    }
  }
}"
