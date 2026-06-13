#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

ISSUER_ADMIN_URL="${ISSUER_ADMIN_URL:-http://localhost:4011}"

post_json "$ISSUER_ADMIN_URL/out-of-band/create-invitation?auto_accept=true" '{
  "handshake_protocols": ["https://didcomm.org/didexchange/1.0"],
  "metadata": {},
  "my_label": "Cloudstrucc Aries Issuer",
  "use_did_method": "did:peer:2"
}'
