#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

ISSUER_ADMIN_URL="${ISSUER_ADMIN_URL:-http://localhost:4011}"

post_json "$ISSUER_ADMIN_URL/schemas" '{
  "schema_name": "cloudstrucc-employee",
  "schema_version": "1.0.0",
  "attributes": [
    "employeeId",
    "displayName",
    "email",
    "department",
    "role",
    "assuranceLevel",
    "employmentStatus"
  ]
}'
