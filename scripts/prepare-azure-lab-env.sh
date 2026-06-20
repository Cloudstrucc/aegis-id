#!/usr/bin/env bash
set -Eeuo pipefail

# Prepare dev/QA/prod env files after Azure App Services and ACA-Py containers exist.
#
# Usage:
#   bash scripts/prepare-azure-lab-env.sh --env dev --admin-api-key "$ARIES_ADMIN_API_KEY"
#   bash scripts/prepare-azure-lab-env.sh --env qa --admin-api-key "$ARIES_ADMIN_API_KEY"
#   bash scripts/prepare-azure-lab-env.sh --env prod --admin-api-key "$ARIES_ADMIN_API_KEY"
#
# The script:
#   - verifies the Aegis ID and Business Expenses App Services exist and are running
#   - verifies the four ACA-Py Azure Container Instances exist and are running
#   - writes ACA-Py admin URLs into .env.dev or .env.qa
#   - writes the shared ACA-Py admin API key when provided
#   - validates ACA-Py /status with the admin API key

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_ENV="${DEPLOY_ENV:-dev}"
ENV_FILE="${ENV_FILE:-}"
TENANT_PROFILE="${TENANT_PROFILE:-}"
ADMIN_API_KEY="${ARIES_ADMIN_API_KEY:-}"
AZURE_LOGIN="${AZURE_LOGIN:-auto}"
AZURE_LOCATION="${AZURE_LOCATION:-canadacentral}"
DEPLOY_TIMEOUT_SECONDS="${DEPLOY_TIMEOUT_SECONDS:-600}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-10}"
SKIP_ADMIN_CHECK="${SKIP_ADMIN_CHECK:-0}"

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Prepare Vanguard Aegis ID dev/QA/prod env files for Azure deploys.

Usage:
  bash scripts/prepare-azure-lab-env.sh --env dev --admin-api-key "<acapy-admin-key>"
  bash scripts/prepare-azure-lab-env.sh --env qa --admin-api-key "<acapy-admin-key>"
  bash scripts/prepare-azure-lab-env.sh --env prod --admin-api-key "<acapy-admin-key>"

Options:
  --env dev|qa|prod        Target environment. Defaults to dev.
  --env-file PATH          Override the root Aegis ID env file.
  --tenant VALUE           Tenant profile alias or Azure tenant ID from TENANT_<ALIAS>_AZURE_TENANT_ID.
  --admin-api-key KEY      Shared ACA-Py admin API key used by the ACI containers.
  --skip-admin-check       Update env files without calling ACA-Py /status.
  --azure-login always     Force az login even when already authenticated.
  --help                   Show this help.

Environment overrides:
  AZURE_LOCATION, AZURE_LOGIN, DEPLOY_TIMEOUT_SECONDS, POLL_INTERVAL_SECONDS
  ARIES_HOLDER_NAME, ARIES_ISSUER_NAME, ARIES_VERIFIER_NAME, ARIES_MEDIATOR_NAME
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env|-e)
      [[ $# -ge 2 ]] || die "--env requires a value"
      DEPLOY_ENV="$2"
      shift 2
      ;;
    --env=*)
      DEPLOY_ENV="${1#*=}"
      shift
      ;;
    --env-file)
      [[ $# -ge 2 ]] || die "--env-file requires a path"
      ENV_FILE="$2"
      shift 2
      ;;
    --env-file=*)
      ENV_FILE="${1#*=}"
      shift
      ;;
    --tenant|--tenant-profile)
      [[ $# -ge 2 ]] || die "$1 requires a value"
      TENANT_PROFILE="$2"
      shift 2
      ;;
    --tenant=*|--tenant-profile=*)
      TENANT_PROFILE="${1#*=}"
      shift
      ;;
    --admin-api-key)
      [[ $# -ge 2 ]] || die "--admin-api-key requires a value"
      ADMIN_API_KEY="$2"
      shift 2
      ;;
    --admin-api-key=*)
      ADMIN_API_KEY="${1#*=}"
      shift
      ;;
    --skip-admin-check)
      SKIP_ADMIN_CHECK=1
      shift
      ;;
    --azure-login)
      [[ $# -ge 2 ]] || die "--azure-login requires a value"
      AZURE_LOGIN="$2"
      shift 2
      ;;
    --azure-login=*)
      AZURE_LOGIN="${1#*=}"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

case "$DEPLOY_ENV" in
  dev|development)
    DEPLOY_ENV="dev"
    ;;
  qa|test)
    DEPLOY_ENV="qa"
    ;;
  prod|production)
    DEPLOY_ENV="prod"
    ;;
  *)
    die "Use --env dev, --env qa, or --env prod."
    ;;
esac

# shellcheck source=./env-loader.sh
source "$ROOT_DIR/scripts/env-loader.sh"

ENV_FILE_PATH="$(resolve_env_file "$ROOT_DIR" "$DEPLOY_ENV" "$ENV_FILE")"
BUSINESS_ENV_FILE_PATH="$(resolve_env_file "$ROOT_DIR/examples/business-expenses" "$DEPLOY_ENV" "")"

[[ -f "$ENV_FILE_PATH" ]] || die "Environment file not found: $ENV_FILE_PATH"
[[ -f "$BUSINESS_ENV_FILE_PATH" ]] || die "Business Expenses environment file not found: $BUSINESS_ENV_FILE_PATH"

load_env_file "$ENV_FILE_PATH" || die "Unable to load environment file: $ENV_FILE_PATH"
TENANT_KEYS=(
  AZURE_TENANT_ID AZURE_SUBSCRIPTION_ID AZURE_RESOURCE_GROUP AZURE_WEBAPP_NAME AZURE_LOCATION
  APP_PUBLIC_BASE_URL PUBLIC_BASE_URL BUSINESS_EXPENSES_APP_URL
  ARIES_HOLDER_NAME ARIES_ISSUER_NAME ARIES_VERIFIER_NAME ARIES_MEDIATOR_NAME
  ARIES_HOLDER_ADMIN_URL ARIES_ISSUER_ADMIN_URL ARIES_VERIFIER_ADMIN_URL ARIES_MEDIATOR_ADMIN_URL
  ARIES_ADMIN_API_KEY ARIES_HOLDER_ADMIN_API_KEY ARIES_ISSUER_ADMIN_API_KEY ARIES_VERIFIER_ADMIN_API_KEY
  ARIES_MEDIATOR_ADMIN_API_KEY
)
apply_tenant_profile "$TENANT_PROFILE" "${TENANT_KEYS[@]}" || die "Unable to apply tenant profile: $TENANT_PROFILE"

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

read_env_value() {
  local file="$1"
  local key="$2"

  awk -v key="$key" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      line=$0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      split(line, parts, "=")
      env_key=parts[1]
      gsub(/[[:space:]]/, "", env_key)
      if (env_key == key) {
        value=substr(line, index(line, "=") + 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        if (value ~ /^".*"$/ || value ~ /^\047.*\047$/) {
          value=substr(value, 2, length(value) - 2)
        }
        print value
        exit
      }
    }
  ' "$file"
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp_file
  tmp_file="$(mktemp)"

  awk -v key="$key" -v value="$value" '
    BEGIN { updated=0 }
    {
      line=$0
      candidate=line
      sub(/^[[:space:]]*export[[:space:]]+/, "", candidate)
      split(candidate, parts, "=")
      env_key=parts[1]
      gsub(/[[:space:]]/, "", env_key)
      if (env_key == key) {
        print key "=" value
        updated=1
      } else {
        print line
      }
    }
    END {
      if (!updated) {
        print key "=" value
      }
    }
  ' "$file" > "$tmp_file"

  mv "$tmp_file" "$file"
}

active_env_key() {
  local key="$1"
  if [[ -n "${TENANT_PROFILE:-}" ]]; then
    printf 'TENANT_%s_%s\n' "$TENANT_PROFILE" "$key"
  else
    printf '%s\n' "$key"
  fi
}

read_active_env_value() {
  local file="$1"
  local key="$2"

  read_env_value "$file" "$(active_env_key "$key")"
}

set_active_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"

  set_env_value "$file" "$(active_env_key "$key")" "$value"
}

wait_for_webapp_running() {
  local resource_group="$1"
  local app_name="$2"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local state
    state="$(
      az webapp show \
        --resource-group "$resource_group" \
        --name "$app_name" \
        --query state \
        --output tsv 2>/dev/null || true
    )"

    if [[ "$state" == "Running" ]]; then
      log "App Service is running: $app_name"
      return 0
    fi

    if [[ -z "$state" ]]; then
      die "App Service was not found: $resource_group/$app_name"
    fi

    local now
    now="$(date +%s)"
    if (( now - started_at >= DEPLOY_TIMEOUT_SECONDS )); then
      die "Timed out waiting for App Service $app_name to be Running. Last state: $state"
    fi

    printf '.'
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

wait_for_container_running() {
  local resource_group="$1"
  local container_name="$2"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local state fqdn
    state="$(
      az container show \
        --resource-group "$resource_group" \
        --name "$container_name" \
        --query "containers[0].instanceView.currentState.state" \
        --output tsv 2>/dev/null || true
    )"
    fqdn="$(
      az container show \
        --resource-group "$resource_group" \
        --name "$container_name" \
        --query "ipAddress.fqdn" \
        --output tsv 2>/dev/null || true
    )"

    if [[ "$state" == "Running" && -n "$fqdn" ]]; then
      log "Container is running: $container_name ($fqdn)"
      printf '%s\n' "$fqdn"
      return 0
    fi

    if [[ -z "$state" ]]; then
      die "Container was not found: $resource_group/$container_name"
    fi

    local now
    now="$(date +%s)"
    if (( now - started_at >= DEPLOY_TIMEOUT_SECONDS )); then
      die "Timed out waiting for container $container_name to be Running. Last state: $state"
    fi

    printf '.'
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

wait_for_acapy_status() {
  local label="$1"
  local url="$2"
  local key="$3"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local status
    status="$(curl -sS -o /dev/null -w '%{http_code}' -H "X-API-Key: $key" "${url%/}/status" || true)"

    if [[ "$status" == "200" ]]; then
      log "ACA-Py admin is reachable: $label"
      return 0
    fi

    local now
    now="$(date +%s)"
    if (( now - started_at >= DEPLOY_TIMEOUT_SECONDS )); then
      die "Timed out waiting for $label ACA-Py /status. Last HTTP status: $status"
    fi

    printf '.'
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

require_cmd az
require_cmd awk
require_cmd curl
require_cmd mktemp

AZURE_TENANT_ID="${AZURE_TENANT_ID:-24a46daa-7b87-4566-9eea-281326a1b75c}"
AZURE_SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-7719c366-5f64-439a-a6c6-65067d5a97e4}"
if [[ "$DEPLOY_ENV" == "prod" ]]; then
  default_resource_group="rg-vanguard-aegis-id"
  default_aegis_webapp="vanguard-aegis-id-65067d"
  default_business_webapp="vanguard-business-expenses-65067d"
  default_aries_holder="vanguard-aegis-holder-65067d"
  default_aries_issuer="vanguard-aegis-issuer-65067d"
  default_aries_verifier="vanguard-aegis-verifier-65067d"
  default_aries_mediator="vanguard-aegis-mediator-65067d"
else
  default_resource_group="rg-vanguard-aegis-id-${DEPLOY_ENV}"
  default_aegis_webapp="vanguard-aegis-id-${DEPLOY_ENV}-65067d"
  default_business_webapp="vanguard-business-expenses-${DEPLOY_ENV}-65067d"
  default_aries_holder="vanguard-aegis-holder-${DEPLOY_ENV}-65067d"
  default_aries_issuer="vanguard-aegis-issuer-${DEPLOY_ENV}-65067d"
  default_aries_verifier="vanguard-aegis-verifier-${DEPLOY_ENV}-65067d"
  default_aries_mediator="vanguard-aegis-mediator-${DEPLOY_ENV}-65067d"
fi

AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-$default_resource_group}"
AZURE_WEBAPP_NAME="${AZURE_WEBAPP_NAME:-$default_aegis_webapp}"

BUSINESS_RESOURCE_GROUP="$(read_active_env_value "$BUSINESS_ENV_FILE_PATH" AZURE_RESOURCE_GROUP)"
BUSINESS_WEBAPP_NAME="$(read_active_env_value "$BUSINESS_ENV_FILE_PATH" AZURE_WEBAPP_NAME)"
BUSINESS_RESOURCE_GROUP="${BUSINESS_RESOURCE_GROUP:-$AZURE_RESOURCE_GROUP}"
BUSINESS_WEBAPP_NAME="${BUSINESS_WEBAPP_NAME:-$default_business_webapp}"

ARIES_HOLDER_NAME="${ARIES_HOLDER_NAME:-$default_aries_holder}"
ARIES_ISSUER_NAME="${ARIES_ISSUER_NAME:-$default_aries_issuer}"
ARIES_VERIFIER_NAME="${ARIES_VERIFIER_NAME:-$default_aries_verifier}"
ARIES_MEDIATOR_NAME="${ARIES_MEDIATOR_NAME:-$default_aries_mediator}"

if [[ -z "$ADMIN_API_KEY" ]]; then
  ADMIN_API_KEY="$(read_active_env_value "$ENV_FILE_PATH" ARIES_ADMIN_API_KEY)"
fi

if [[ "$AZURE_LOGIN" == "always" ]] || ! az account show >/dev/null 2>&1; then
  log "Starting Azure login. Complete the browser/device prompt if requested."
  az login --tenant "$AZURE_TENANT_ID" --output none
else
  log "Azure CLI is already authenticated"
fi

log "Selecting Azure subscription"
az account set --subscription "$AZURE_SUBSCRIPTION_ID"

log "Checking target Azure resources for $DEPLOY_ENV"
wait_for_webapp_running "$AZURE_RESOURCE_GROUP" "$AZURE_WEBAPP_NAME"
wait_for_webapp_running "$BUSINESS_RESOURCE_GROUP" "$BUSINESS_WEBAPP_NAME"

holder_fqdn="$(wait_for_container_running "$AZURE_RESOURCE_GROUP" "$ARIES_HOLDER_NAME" | tail -n 1)"
issuer_fqdn="$(wait_for_container_running "$AZURE_RESOURCE_GROUP" "$ARIES_ISSUER_NAME" | tail -n 1)"
verifier_fqdn="$(wait_for_container_running "$AZURE_RESOURCE_GROUP" "$ARIES_VERIFIER_NAME" | tail -n 1)"
mediator_fqdn="$(wait_for_container_running "$AZURE_RESOURCE_GROUP" "$ARIES_MEDIATOR_NAME" | tail -n 1)"

holder_admin_url="http://${holder_fqdn}:6011"
issuer_admin_url="http://${issuer_fqdn}:4011"
verifier_admin_url="http://${verifier_fqdn}:5011"
mediator_admin_url="http://${mediator_fqdn}:3011"

log "Updating $ENV_FILE_PATH"
set_active_env_value "$ENV_FILE_PATH" "ARIES_HOLDER_ADMIN_URL" "$holder_admin_url"
set_active_env_value "$ENV_FILE_PATH" "ARIES_ISSUER_ADMIN_URL" "$issuer_admin_url"
set_active_env_value "$ENV_FILE_PATH" "ARIES_VERIFIER_ADMIN_URL" "$verifier_admin_url"
set_active_env_value "$ENV_FILE_PATH" "ARIES_MEDIATOR_ADMIN_URL" "$mediator_admin_url"

if [[ -n "$ADMIN_API_KEY" ]]; then
  set_active_env_value "$ENV_FILE_PATH" "ARIES_ADMIN_API_KEY" "$ADMIN_API_KEY"
fi

log "Updating $BUSINESS_ENV_FILE_PATH"
set_active_env_value "$BUSINESS_ENV_FILE_PATH" "AZURE_RESOURCE_GROUP" "$BUSINESS_RESOURCE_GROUP"
set_active_env_value "$BUSINESS_ENV_FILE_PATH" "AZURE_WEBAPP_NAME" "$BUSINESS_WEBAPP_NAME"
set_active_env_value "$BUSINESS_ENV_FILE_PATH" "APP_PUBLIC_BASE_URL" "https://${BUSINESS_WEBAPP_NAME}.azurewebsites.net"
set_active_env_value "$BUSINESS_ENV_FILE_PATH" "AEGIS_ID_BASE_URL" "https://${AZURE_WEBAPP_NAME}.azurewebsites.net"

if [[ "$SKIP_ADMIN_CHECK" != "1" ]]; then
  [[ -n "$ADMIN_API_KEY" ]] || die "ARIES_ADMIN_API_KEY is required for ACA-Py validation. Re-run with --admin-api-key or set ARIES_ADMIN_API_KEY in $ENV_FILE_PATH."

  wait_for_acapy_status "holder" "$holder_admin_url" "$ADMIN_API_KEY"
  wait_for_acapy_status "issuer" "$issuer_admin_url" "$ADMIN_API_KEY"
  wait_for_acapy_status "verifier" "$verifier_admin_url" "$ADMIN_API_KEY"
  wait_for_acapy_status "mediator" "$mediator_admin_url" "$ADMIN_API_KEY"
else
  log "Skipping ACA-Py admin /status validation"
fi

log "Prepared $DEPLOY_ENV environment files"
cat <<EOF

Next deploy commands:
  bash scripts/deploy-azure-webapp.sh --env $DEPLOY_ENV${TENANT_PROFILE:+ --tenant $TENANT_PROFILE}
  bash scripts/deploy-azure-business-expenses.sh --env $DEPLOY_ENV${TENANT_PROFILE:+ --tenant $TENANT_PROFILE}

Note:
  The Business Expenses deploy still needs AEGIS_ORGANIZATION_ID in:
  $BUSINESS_ENV_FILE_PATH
EOF
