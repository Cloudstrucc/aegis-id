#!/usr/bin/env bash
set -Eeuo pipefail

# Vanguard Business Expenses Azure App Service deploy.
#
# Usage:
#   bash scripts/deploy-azure-business-expenses.sh --env prod
#
# Optional overrides:
#   --env prod|dev|qa|local
#   --env-file /absolute/path/to/.env
#   AZURE_TENANT_ID=... AZURE_SUBSCRIPTION_ID=... AZURE_RESOURCE_GROUP=...
#   AZURE_WEBAPP_NAME=... APP_PUBLIC_BASE_URL=... AEGIS_ID_BASE_URL=...
#   AEGIS_ORGANIZATION_ID=... BUSINESS_SESSION_SECRET=... SKIP_NPM_INSTALL=1 AZURE_LOGIN=always

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/examples/business-expenses"
DEPLOY_ENV="${DEPLOY_ENV:-prod}"
ENV_FILE="${ENV_FILE:-}"

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
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
    --skip-npm-install)
      SKIP_NPM_INSTALL=1
      shift
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

# shellcheck source=./env-loader.sh
source "$ROOT_DIR/scripts/env-loader.sh"
ENV_FILE_PATH="$(resolve_env_file "$APP_DIR" "$DEPLOY_ENV" "$ENV_FILE")"
load_env_file "$ENV_FILE_PATH" || die "Environment file not found: $ENV_FILE_PATH"
export APP_ENV="$DEPLOY_ENV"

AZURE_TENANT_ID="${AZURE_TENANT_ID:-24a46daa-7b87-4566-9eea-281326a1b75c}"
AZURE_SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-7719c366-5f64-439a-a6c6-65067d5a97e4}"
AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-vanguard-aegis-id}"
AZURE_WEBAPP_NAME="${AZURE_WEBAPP_NAME:-vanguard-business-expenses-65067d}"
APP_PUBLIC_BASE_URL="${APP_PUBLIC_BASE_URL:-https://${AZURE_WEBAPP_NAME}.azurewebsites.net}"
AEGIS_ID_BASE_URL="${AEGIS_ID_BASE_URL:-https://vanguard-aegis-id-65067d.azurewebsites.net}"
AEGIS_ORGANIZATION_ID="${AEGIS_ORGANIZATION_ID:-}"
BUSINESS_SESSION_SECRET="${BUSINESS_SESSION_SECRET:-${SESSION_SECRET:-}}"
WEBSITE_NODE_DEFAULT_VERSION="${WEBSITE_NODE_DEFAULT_VERSION:-~20}"
ZIP_PATH="${ZIP_PATH:-/tmp/vanguard-business-expenses.zip}"
DEPLOY_TIMEOUT_SECONDS="${DEPLOY_TIMEOUT_SECONDS:-900}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-10}"
AZURE_LOGIN="${AZURE_LOGIN:-auto}"

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

wait_for_http_status() {
  local url="$1"
  local expected_status="${2:-200}"
  local timeout_seconds="${3:-$DEPLOY_TIMEOUT_SECONDS}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local status
    status="$(curl -k -L -sS -o /dev/null -w '%{http_code}' "$url" || true)"
    if [[ "$status" == "$expected_status" ]]; then
      log "Ready: $url returned $status"
      return 0
    fi

    local now
    now="$(date +%s)"
    if (( now - started_at >= timeout_seconds )); then
      fail "Timed out waiting for $url to return $expected_status. Last status: $status"
    fi

    printf '.'
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

require_cmd az
require_cmd curl
require_cmd npm
require_cmd node
require_cmd zip

[[ -n "$AEGIS_ORGANIZATION_ID" || -n "${AEGIS_ISSUER_CONNECTION_ID:-}" ]] || fail "Set AEGIS_ORGANIZATION_ID or AEGIS_ISSUER_CONNECTION_ID before deploying."

cd "$APP_DIR"

log "Deploying Vanguard Business Expenses to Azure App Service"
log "Tenant:        $AZURE_TENANT_ID"
log "Subscription:  $AZURE_SUBSCRIPTION_ID"
log "Resource group:$AZURE_RESOURCE_GROUP"
log "Web app:       $AZURE_WEBAPP_NAME"
log "Base URL:      $APP_PUBLIC_BASE_URL"
log "Aegis URL:     $AEGIS_ID_BASE_URL"
log "Organization:  $AEGIS_ORGANIZATION_ID"
log "Env file:      $ENV_FILE_PATH"

if [[ "${SKIP_NPM_INSTALL:-0}" != "1" ]]; then
  log "Installing Node dependencies"
  npm install
else
  log "Skipping npm install"
fi

log "Running local syntax verification"
node --check src/server.js
node --check public/app.js

if [[ "$AZURE_LOGIN" == "always" ]] || ! az account show >/dev/null 2>&1; then
  log "Starting Azure login. Complete the browser/device prompt if requested."
  az login --tenant "$AZURE_TENANT_ID" --output none
else
  log "Azure CLI is already authenticated"
fi

log "Selecting Azure subscription"
az account set --subscription "$AZURE_SUBSCRIPTION_ID"

if [[ -z "$BUSINESS_SESSION_SECRET" ]]; then
  log "Looking for an existing SESSION_SECRET app setting"
  BUSINESS_SESSION_SECRET="$(
    az webapp config appsettings list \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_WEBAPP_NAME" \
      --query "[?name=='SESSION_SECRET'].value | [0]" \
      --output tsv 2>/dev/null || true
  )"
fi

if [[ -z "$BUSINESS_SESSION_SECRET" ]]; then
  log "Generating a new SESSION_SECRET for Business Expenses"
  BUSINESS_SESSION_SECRET="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
fi

log "Applying App Service settings"
app_settings=(
  "APP_ENV=$DEPLOY_ENV"
  "NODE_ENV=${NODE_ENV:-production}"
  "SESSION_SECRET=$BUSINESS_SESSION_SECRET"
  "SCM_DO_BUILD_DURING_DEPLOYMENT=true"
  "WEBSITE_NODE_DEFAULT_VERSION=$WEBSITE_NODE_DEFAULT_VERSION"
  "APP_PUBLIC_BASE_URL=$APP_PUBLIC_BASE_URL"
  "AEGIS_ID_BASE_URL=$AEGIS_ID_BASE_URL"
  "AEGIS_OIDC_AUTHORIZATION_ENDPOINT=${AEGIS_OIDC_AUTHORIZATION_ENDPOINT:-/oidc/authorize}"
  "AEGIS_OIDC_TOKEN_ENDPOINT=${AEGIS_OIDC_TOKEN_ENDPOINT:-/oidc/token}"
  "OIDC_CLIENT_ID=${OIDC_CLIENT_ID:-business-expenses-demo}"
  "OIDC_SCOPE=${OIDC_SCOPE:-openid profile email}"
  "VERIFIED_ID_AUTH_ENABLED=${VERIFIED_ID_AUTH_ENABLED:-true}"
  "YUBIKEY_AUTH_ENABLED=${YUBIKEY_AUTH_ENABLED:-true}"
  "AEGIS_ORGANIZATION_ID=$AEGIS_ORGANIZATION_ID"
)

append_if_set() {
  local key="$1"
  if [[ -n "${!key:-}" ]]; then
    app_settings+=("$key=${!key}")
  fi
}

append_if_set AEGIS_ISSUER_CONNECTION_ID

az webapp config appsettings set \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_WEBAPP_NAME" \
  --settings "${app_settings[@]}" \
  --output none

log "Creating zip package: $ZIP_PATH"
rm -f "$ZIP_PATH"
zip -r "$ZIP_PATH" . \
  -x "node_modules/*" \
  -x ".env" \
  -x ".env.*" \
  -x "data/runtime/*" \
  -x "*.DS_Store" \
  -x "*.zip" \
  >/dev/null

log "Deploying zip package to Azure App Service"
az webapp deploy \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_WEBAPP_NAME" \
  --src-path "$ZIP_PATH" \
  --type zip \
  --restart true \
  --output none

log "Polling deployed app"
wait_for_http_status "$APP_PUBLIC_BASE_URL" 200 "$DEPLOY_TIMEOUT_SECONDS"

log "Deployment complete"
printf '\nOpen: %s\n' "$APP_PUBLIC_BASE_URL"
