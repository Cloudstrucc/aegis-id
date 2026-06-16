#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

HOLDER_ADMIN_URL="${HOLDER_ADMIN_URL:-http://localhost:6011}"
INVITATION_SOURCE="${1:-/tmp/cloudstrucc-issuer-invite.json}"

usage() {
  cat >&2 <<'USAGE'
Usage:
  aries-lab/scripts/accept-invitation-with-holder.sh <invitation-json-file-or-url>

Examples:
  aries-lab/scripts/accept-invitation-with-holder.sh /tmp/cloudstrucc-issuer-invite.json
  aries-lab/scripts/accept-invitation-with-holder.sh /tmp/cloudstrucc-verifier-invite.json
  aries-lab/scripts/accept-invitation-with-holder.sh 'http://10.0.0.240:4010?oob=...'
  aries-lab/scripts/accept-invitation-with-holder.sh 'cloudstrucc-wallet://invite?oob=...&endpoint=...'
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

INVITATION_URL="$(
  node -e '
    const fs = require("fs");
    const source = process.argv[1] || "";

    if (/^(https?:|cloudstrucc-wallet:)/.test(source)) {
      process.stdout.write(source);
      process.exit(0);
    }

    const input = JSON.parse(fs.readFileSync(source, "utf8"));
    const url =
      input.invitation_url ||
      input.invitationUrl ||
      input.requestUrl ||
      input.url ||
      input.iosWalletInvitation?.invitationUrl ||
      input.iosWalletInvitation?.requestUrl ||
      input.iosWalletInvitation?.iosDeepLinkUrl ||
      "";

    if (!url) {
      throw new Error("No invitation URL found in JSON file.");
    }

    process.stdout.write(url);
  ' "$INVITATION_SOURCE"
)"

node -e '
  const raw = process.argv[1];
  const url = new URL(raw);
  const encoded = url.searchParams.get("oob");

  if (!encoded) {
    throw new Error("Invitation URL does not contain an oob query parameter.");
  }

  let normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = normalized.length % 4;
  if (remainder > 0) {
    normalized += "=".repeat(4 - remainder);
  }

  const invitation = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  process.stdout.write(JSON.stringify(invitation));
' "$INVITATION_URL" |
  curl -sS -X POST "$HOLDER_ADMIN_URL/out-of-band/receive-invitation?auto_accept=true&use_existing_connection=true" \
    "${json_header[@]}" \
    --data-binary @-
