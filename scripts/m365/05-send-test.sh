#!/usr/bin/env bash
# Step 5 of 5. Proves the setup the way the app will use it: signs in as the app registration
# (client credentials from the env file), sends one email as GRAPH_SENDER, and, when EMAIL_HELP
# is set, reads the newest message subject in the help inbox.
#
# Safe for an agent to run: it changes nothing in the tenant and needs no admin sign-in. It
# sends exactly one email, to the address given with --to. The secret and the token are never
# printed or put on a command line (other processes can read those); curl reads them from stdin.
#
# Reads: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET (step 2), GRAPH_SENDER, EMAIL_HELP,
# EMAIL_FROM, EMAIL_REPLY_TO, M365_DOMAIN, M365_APP_SLUG.
#
# Reading failures:
#   401 / AADSTS7000215  wrong or expired GRAPH_CLIENT_SECRET (check GRAPH_CLIENT_SECRET_EXPIRES)
#   403 ErrorAccessDenied the access policy does not cover this mailbox yet (step 4; can take an hour)
#   404 / ErrorInvalidUser the mailbox does not exist or has not replicated (step 3)
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/m365/05-send-test.sh --env <local|dev|qa|prod|path> --to <address> [--no-send]

  --to       where the test email goes (one message)
  --no-send  only get a token and read the help inbox
USAGE
}

ENV_NAME="" TO="" SEND=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_NAME="${2:-}"; shift 2 ;;
    --to) TO="${2:-}"; shift 2 ;;
    --no-send) SEND=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
require_cmd curl python3
m365_load "$ENV_NAME"
m365_print_plan
(( SEND == 0 )) || [[ "$TO" == *@* ]] || die "--to <address> is required (or --no-send)"
for k in GRAPH_TENANT_ID GRAPH_CLIENT_ID GRAPH_CLIENT_SECRET; do
  [[ -n "${!k:-}" ]] || die "$k is not in $M365_ENV_FILE. Run 02-app-registration.sh first."
done

json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

# Token: the form body, secret included, goes to curl on stdin.
body="$(python3 -I -c 'import os, urllib.parse as u; print(u.urlencode({"client_id": os.environ["GRAPH_CLIENT_ID"], "client_secret": os.environ["GRAPH_CLIENT_SECRET"], "scope": "https://graph.microsoft.com/.default", "grant_type": "client_credentials"}))')"
resp="$(printf '%s' "$body" | curl -sS -X POST --data-binary @- \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  "https://login.microsoftonline.com/$GRAPH_TENANT_ID/oauth2/v2.0/token")"
unset body
TOKEN="$(printf '%s' "$resp" | json 'd.get("access_token","")')"
if [[ -z "$TOKEN" ]]; then
  die "no token: $(printf '%s' "$resp" | json 'd.get("error_description","")[:300]')"
fi
roles="$(printf '%s' "$TOKEN" | python3 -I -c 'import sys,json,base64; p=sys.stdin.read().split(".")[1]; p+="="*(-len(p)%4); print(", ".join(json.loads(base64.urlsafe_b64decode(p)).get("roles",[])) or "none")')"
log "Token OK as the app; roles: $roles"

# graph <method> <url> [json-body]: the Authorization header comes from a file descriptor.
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT
graph() {
  local method="$1" url="$2" data="${3:-}" args=(-sS -o "$OUT" -w '%{http_code}' -X "$method" -H 'Content-Type: application/json')
  [[ -n "$data" ]] && args+=(--data-binary "$data")
  curl "${args[@]}" -H @<(printf 'Authorization: Bearer %s\n' "$TOKEN") "$url"
}
graph_error() { json '(d.get("error") or {}).get("code","") + ": " + (d.get("error") or {}).get("message","")[:300]' < "$OUT"; }

if (( SEND )); then
  msg="$(SUBJECT="Test from $M365_APP_NAME ($(date '+%Y-%m-%d %H:%M'))" TO="$TO" REPLY="${EMAIL_REPLY_TO:-}" FROM="$GRAPH_SENDER" python3 -I -c '
import json, os
m = {"subject": os.environ["SUBJECT"],
     "body": {"contentType": "Text", "content": "Sent by scripts/m365/05-send-test.sh as " + os.environ["FROM"] + ". If you can read this, the app can send."},
     "toRecipients": [{"emailAddress": {"address": os.environ["TO"]}}]}
reply = os.environ.get("REPLY", "").split("<")[-1].rstrip(">").strip()
if reply: m["replyTo"] = [{"emailAddress": {"address": reply}}]
print(json.dumps({"message": m, "saveToSentItems": True}))')"
  code="$(graph POST "https://graph.microsoft.com/v1.0/users/$GRAPH_SENDER/sendMail" "$msg")"
  [[ "$code" == 202 ]] || die "send as $GRAPH_SENDER failed ($code) $(graph_error)"
  log "Sent a test email as $GRAPH_SENDER to $TO (check junk too; a copy is in the mailbox's Sent Items)"
fi

if [[ -n "$EMAIL_HELP" ]]; then
  code="$(graph GET "https://graph.microsoft.com/v1.0/users/$EMAIL_HELP/mailFolders/inbox/messages?\$top=1&\$select=subject,receivedDateTime")"
  [[ "$code" == 200 ]] || die "reading $EMAIL_HELP failed ($code) $(graph_error)"
  log "Read $EMAIL_HELP: newest is $(json '(lambda v: repr(v[0]["subject"]) + " at " + v[0]["receivedDateTime"] if v else "(inbox empty)")(d.get("value", []))' < "$OUT")"
fi

cat <<NEXT
Done. The app's env needs (already in $M365_ENV_FILE except where noted):
  EMAIL_PROVIDER=graph
  EMAIL_FROM=$M365_DISPLAY_NAME <$GRAPH_SENDER>
  GRAPH_SENDER=$GRAPH_SENDER
  GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET
$( [[ -n "$EMAIL_HELP" ]] && echo "  EMAIL_HELP=$EMAIL_HELP" )
NEXT
