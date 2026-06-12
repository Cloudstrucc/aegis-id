#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

VERIFIER_ADMIN_URL="${VERIFIER_ADMIN_URL:-http://localhost:5011}"

post_json "$VERIFIER_ADMIN_URL/connections/create-invitation" '{
  "metadata": {},
  "my_label": "Cloudstrucc Aries Verifier"
}'
