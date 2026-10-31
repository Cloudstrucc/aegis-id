#!/usr/bin/env bash
# Step 2 of 5. Creates (or reuses) the Entra app registration the app sends mail with, grants it
# Microsoft Graph application permissions with admin consent, and writes GRAPH_TENANT_ID,
# GRAPH_CLIENT_ID and a new GRAPH_CLIENT_SECRET into the env file.
#
# Who runs it: a person signed in to `az` as a Global Administrator or Privileged Role
# Administrator of the tenant that owns M365_DOMAIN (admin consent needs one of those). An agent
# may run it with --dry-run only: it changes the tenant and creates a credential.
#
# What it grants, as APPLICATION permissions on Microsoft Graph:
#   Mail.Send       always: the app sends as GRAPH_SENDER.
#   Mail.ReadWrite  only when EMAIL_HELP is set: the app reads the help mailbox and files mail.
# Both are tenant-wide until step 4 restricts the app to this app's mailboxes. Do not stop
# between this step and step 4 on a tenant with people's mail in it.
#
# Idempotent: it finds the app by GRAPH_CLIENT_ID, then by M365_APP_NAME, before creating one,
# and only adds permissions that are missing. A secret is made only when the env file has none,
# or with --new-secret (rotation). Old secrets are left in place; delete them in the Entra admin
# centre once the app runs on the new one. The secret is never printed.
#
# One registration can serve every environment: run this for dev, and for prod it finds the same
# app by name and only writes the ids (copy GRAPH_CLIENT_SECRET across, or use --new-secret to
# give prod its own).
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/m365/02-app-registration.sh --env <local|dev|qa|prod|path> [--new-secret] [--years N] [--dry-run]

  --env         which env file to read and write (.env.local, .env.dev, .env.qa, .env) or a path
  --new-secret  add a fresh client secret even if GRAPH_CLIENT_SECRET is set (rotation)
  --years N     secret lifetime in years (default 2; Entra caps it at 2)
  --dry-run     print what would happen; no az calls that change anything
USAGE
}

ENV_NAME="" NEW_SECRET=0 YEARS=2 DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) ENV_NAME="${2:-}"; shift 2 ;;
    --new-secret) NEW_SECRET=1; shift ;;
    --years) YEARS="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
require_cmd python3
m365_load "$ENV_NAME"
m365_print_plan

GRAPH_API=00000003-0000-0000-c000-000000000000
MAIL_SEND=b633e1c5-b582-4048-a93e-9f11b44c7e96       # Mail.Send (application)
MAIL_READWRITE=e2a3a72e-5f79-4c64-b1b1-878b674786c9  # Mail.ReadWrite (application)
ROLES=("$MAIL_SEND")
[[ -n "$EMAIL_HELP" ]] && ROLES+=("$MAIL_READWRITE")

if (( DRY_RUN )); then
  log "Dry run. Would: find or create \"$M365_APP_NAME\" (single tenant, no redirect URI)"
  echo "    grant Mail.Send$([[ -n "$EMAIL_HELP" ]] && echo ' and Mail.ReadWrite') (application) with admin consent"
  if [[ -z "${GRAPH_CLIENT_SECRET:-}" || $NEW_SECRET -eq 1 ]]; then
    echo "    create a ${YEARS}-year client secret and write it to $M365_ENV_FILE"
  else
    echo "    keep the existing GRAPH_CLIENT_SECRET"
  fi
  exit 0
fi

require_cmd az
TENANT="$(az account show --query tenantId -o tsv 2>/dev/null)" || die "not signed in: run az login --tenant $M365_DOMAIN"
if [[ -n "${GRAPH_TENANT_ID:-}" && "$GRAPH_TENANT_ID" != "$TENANT" ]]; then
  die "az is signed in to tenant $TENANT but GRAPH_TENANT_ID is $GRAPH_TENANT_ID. Run: az login --tenant $GRAPH_TENANT_ID"
fi
# The domain must belong to this tenant, or the mailboxes in step 3 cannot exist here.
if ! az rest --method get --url "https://graph.microsoft.com/v1.0/domains/$M365_DOMAIN" --query isVerified -o tsv 2>/dev/null | grep -qi true; then
  die "$M365_DOMAIN is not a verified domain on tenant $TENANT. Sign in to the right one (az login --tenant $M365_DOMAIN) or add the domain first (step 1)."
fi
log "Tenant $TENANT owns $M365_DOMAIN"

APP_ID="${GRAPH_CLIENT_ID:-}"
if [[ -n "$APP_ID" ]] && ! az ad app show --id "$APP_ID" --query appId -o tsv >/dev/null 2>&1; then
  die "GRAPH_CLIENT_ID in $M365_ENV_FILE is not an app on this tenant. Remove the line to create a new app, or sign in to the tenant it belongs to."
fi
if [[ -z "$APP_ID" ]]; then
  found="$(az ad app list --display-name "$M365_APP_NAME" --query "[].appId" -o tsv)"
  [[ "$(printf '%s\n' "$found" | grep -c .)" -le 1 ]] || die "more than one app is named \"$M365_APP_NAME\"; set GRAPH_CLIENT_ID to the one you mean"
  APP_ID="$found"
fi
if [[ -z "$APP_ID" ]]; then
  APP_ID="$(az ad app create --display-name "$M365_APP_NAME" --sign-in-audience AzureADMyOrg --query appId -o tsv)"
  log "Created app registration \"$M365_APP_NAME\" ($APP_ID)"
else
  log "Using app registration $APP_ID"
fi

# The service principal is what admin consent and the Exchange access policy attach to.
az ad sp show --id "$APP_ID" --query id -o tsv >/dev/null 2>&1 || {
  az ad sp create --id "$APP_ID" --query id -o tsv >/dev/null
  log "Created its service principal"
}

have="$(az ad app show --id "$APP_ID" --query "requiredResourceAccess[?resourceAppId=='$GRAPH_API'].resourceAccess[].id" -o tsv)"
for role in "${ROLES[@]}"; do
  if ! grep -qx "$role" <<<"$have"; then
    az ad app permission add --id "$APP_ID" --api "$GRAPH_API" --api-permissions "$role=Role" >/dev/null 2>&1
    log "Added permission $role"
  fi
done
# Consent can fail for a minute after the service principal is created; retry a few times.
for attempt in 1 2 3 4 5; do
  if az ad app permission admin-consent --id "$APP_ID" >/dev/null 2>&1; then log "Admin consent granted"; break; fi
  (( attempt == 5 )) && die "admin consent failed. Grant it in entra.microsoft.com > App registrations > $M365_APP_NAME > API permissions, then run this again."
  sleep 15
done

M365_NEW_VALUE="$TENANT" set_env_value "$M365_ENV_FILE" GRAPH_TENANT_ID
M365_NEW_VALUE="$APP_ID" set_env_value "$M365_ENV_FILE" GRAPH_CLIENT_ID
if [[ -z "${GRAPH_CLIENT_SECRET:-}" || $NEW_SECRET -eq 1 ]]; then
  label="${M365_ENV_NAME:-$(basename "$M365_ENV_FILE")} $(date +%Y-%m-%d)"
  # Captured, never echoed: it goes from az straight into the gitignored env file.
  M365_NEW_VALUE="$(az ad app credential reset --id "$APP_ID" --append --display-name "$label" --years "$YEARS" --query password -o tsv)"
  [[ -n "$M365_NEW_VALUE" ]] || die "az did not return a secret"
  export M365_NEW_VALUE
  set_env_value "$M365_ENV_FILE" GRAPH_CLIENT_SECRET
  M365_NEW_VALUE="$(python3 -I -c "import datetime as d; print((d.date.today()+d.timedelta(days=365*$YEARS)).isoformat())")" \
    set_env_value "$M365_ENV_FILE" GRAPH_CLIENT_SECRET_EXPIRES
  unset M365_NEW_VALUE
  log "New client secret \"$label\" written to $M365_ENV_FILE (expires in $YEARS years; GRAPH_CLIENT_SECRET_EXPIRES records the date)"
fi
log "Wrote GRAPH_TENANT_ID and GRAPH_CLIENT_ID to $M365_ENV_FILE"
echo "Next: pwsh scripts/m365/03-mailboxes.ps1 -Env ${ENV_NAME}"
