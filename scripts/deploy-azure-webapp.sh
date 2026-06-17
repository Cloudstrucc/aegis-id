#!/usr/bin/env bash
set -Eeuo pipefail

# Vanguard Cloud Services - Aegis ID Azure App Service deploy.
#
# Usage:
#   bash scripts/deploy-azure-webapp.sh --env prod
#
# Optional overrides:
#   --env prod|dev|qa|local
#   --env-file /absolute/path/to/.env
#   AZURE_TENANT_ID=... AZURE_SUBSCRIPTION_ID=... AZURE_RESOURCE_GROUP=...
#   AZURE_WEBAPP_NAME=... APP_PUBLIC_BASE_URL=... BUSINESS_EXPENSES_APP_URL=...
#   SKIP_NPM_INSTALL=1 SKIP_TESTS=1 VERIFY_ONLY=1 AZURE_LOGIN=always

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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
    --verify-only)
      VERIFY_ONLY=1
      shift
      ;;
    --skip-tests)
      SKIP_TESTS=1
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
ENV_FILE_PATH="$(resolve_env_file "$ROOT_DIR" "$DEPLOY_ENV" "$ENV_FILE")"
load_env_file "$ENV_FILE_PATH" || die "Environment file not found: $ENV_FILE_PATH"
export APP_ENV="$DEPLOY_ENV"

AZURE_TENANT_ID="${AZURE_TENANT_ID:-24a46daa-7b87-4566-9eea-281326a1b75c}"
AZURE_SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-7719c366-5f64-439a-a6c6-65067d5a97e4}"
AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-vanguard-aegis-id}"
AZURE_WEBAPP_NAME="${AZURE_WEBAPP_NAME:-vanguard-aegis-id-65067d}"
APP_PUBLIC_BASE_URL="${APP_PUBLIC_BASE_URL:-${PUBLIC_BASE_URL:-https://${AZURE_WEBAPP_NAME}.azurewebsites.net}}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-$APP_PUBLIC_BASE_URL}"
BUSINESS_EXPENSES_APP_URL="${BUSINESS_EXPENSES_APP_URL:-https://vanguard-business-expenses-65067d.azurewebsites.net}"
WEBSITE_NODE_DEFAULT_VERSION="${WEBSITE_NODE_DEFAULT_VERSION:-~20}"
ZIP_PATH="${ZIP_PATH:-/tmp/aegis-id-web.zip}"
DEPLOY_TIMEOUT_SECONDS="${DEPLOY_TIMEOUT_SECONDS:-900}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-10}"
AZURE_LOGIN="${AZURE_LOGIN:-auto}"
VERIFY_ONLY="${VERIFY_ONLY:-0}"

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

wait_for_webapp_running() {
  local timeout_seconds="${1:-$DEPLOY_TIMEOUT_SECONDS}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    local state
    state="$(
      az webapp show \
        --resource-group "$AZURE_RESOURCE_GROUP" \
        --name "$AZURE_WEBAPP_NAME" \
        --query state \
        --output tsv 2>/dev/null || true
    )"

    if [[ "$state" == "Running" ]]; then
      log "App Service state is Running"
      return 0
    fi

    local now
    now="$(date +%s)"
    if (( now - started_at >= timeout_seconds )); then
      fail "Timed out waiting for App Service state to be Running. Last state: ${state:-unknown}"
    fi

    printf '.'
    sleep "$POLL_INTERVAL_SECONDS"
  done
}

assert_content_type_contains() {
  local url="$1"
  local expected="$2"
  local headers
  headers="$(curl -k -L -sS -I "$url" | tr -d '\r')"

  if ! printf '%s\n' "$headers" | awk 'tolower($0) ~ /^content-type:/ { print tolower($0) }' | grep -q "$expected"; then
    printf '%s\n' "$headers" >&2
    fail "$url did not return expected Content-Type containing '$expected'."
  fi

  log "Verified Content-Type for $url contains '$expected'"
}

require_cmd az
require_cmd curl
require_cmd npm
require_cmd node
require_cmd zip

clean_test_env=(
  env -i
  "PATH=$PATH"
  "HOME=$HOME"
  "TMPDIR=${TMPDIR:-/tmp}"
  "USER=${USER:-}"
  "NODE_ENV=test"
  "APP_ENV=local"
)

cd "$ROOT_DIR"

log "Deploying Vanguard Aegis ID to Azure App Service"
log "Tenant:        $AZURE_TENANT_ID"
log "Subscription:  $AZURE_SUBSCRIPTION_ID"
log "Resource group:$AZURE_RESOURCE_GROUP"
log "Web app:       $AZURE_WEBAPP_NAME"
log "Base URL:      $APP_PUBLIC_BASE_URL"
log "Example app:   $BUSINESS_EXPENSES_APP_URL"
log "Env file:      $ENV_FILE_PATH"

if [[ "$VERIFY_ONLY" == "1" ]]; then
  log "VERIFY_ONLY=1 set; skipping local install, tests, app settings, packaging, and zip deploy"
elif [[ "${SKIP_NPM_INSTALL:-0}" != "1" ]]; then
  log "Installing Node dependencies"
  npm install
else
  log "Skipping npm install"
fi

if [[ "$VERIFY_ONLY" == "1" ]]; then
  :
elif [[ "${SKIP_TESTS:-0}" != "1" ]]; then
  log "Running local verification"
  "${clean_test_env[@]}" node --check public/scripts/main.js
  "${clean_test_env[@]}" npm run smoke
  "${clean_test_env[@]}" npm test
else
  log "Skipping local tests"
fi

if [[ "$AZURE_LOGIN" == "always" ]] || ! az account show >/dev/null 2>&1; then
  log "Starting Azure login. Complete the browser/device prompt if requested."
  az login --tenant "$AZURE_TENANT_ID" --output none
else
  log "Azure CLI is already authenticated"
fi

log "Selecting Azure subscription"
az account set --subscription "$AZURE_SUBSCRIPTION_ID"

if [[ "$VERIFY_ONLY" != "1" ]]; then
  if [[ -z "${SESSION_SECRET:-}" ]]; then
    log "Looking for an existing SESSION_SECRET app setting"
    SESSION_SECRET="$(
      az webapp config appsettings list \
        --resource-group "$AZURE_RESOURCE_GROUP" \
        --name "$AZURE_WEBAPP_NAME" \
        --query "[?name=='SESSION_SECRET'].value | [0]" \
        --output tsv 2>/dev/null || true
    )"
  fi

  if [[ -z "${SESSION_SECRET:-}" ]]; then
    log "Generating a new SESSION_SECRET for Aegis ID"
    SESSION_SECRET="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
  fi

  log "Applying App Service settings"
  app_settings=(
    "APP_ENV=$DEPLOY_ENV"
    "NODE_ENV=${NODE_ENV:-production}"
    "SESSION_SECRET=$SESSION_SECRET"
    "SCM_DO_BUILD_DURING_DEPLOYMENT=true"
    "WEBSITE_NODE_DEFAULT_VERSION=$WEBSITE_NODE_DEFAULT_VERSION"
    "APP_PUBLIC_BASE_URL=$APP_PUBLIC_BASE_URL"
    "PUBLIC_BASE_URL=$PUBLIC_BASE_URL"
    "BUSINESS_EXPENSES_APP_URL=$BUSINESS_EXPENSES_APP_URL"
  )

  append_if_set() {
    local key="$1"
    if [[ -n "${!key:-}" ]]; then
      app_settings+=("$key=${!key}")
    fi
  }

  for key in \
    IOS_TESTFLIGHT_PUBLIC_URL ANDROID_TESTING_URL \
    USER_STORE_PATH SUBSCRIPTION_STORE_PATH SUBSCRIBER_WORKSPACE_STORE_PATH TRANSACTION_STORE_PATH \
    ISSUER_ORG_STORE_PATH ORG_ADMIN_STORE_PATH ORG_ADMIN_EVENT_STORE_PATH OIDC_WALLET_SESSION_STORE_PATH \
    OIDC_CODE_STORE_PATH WALLET_CHALLENGE_STORE_PATH AUDIT_STORE_PATH \
    DEFAULT_MFA_METHOD PASSKEY_RP_NAME PASSKEY_RP_ID PASSKEY_ORIGIN \
    VID_MODE AZURE_TENANT_ID AZURE_CLIENT_ID AZURE_CLIENT_SECRET VID_CLIENT_NAME VID_AUTHORITY_DID \
    VID_MANIFEST_URL VID_CREDENTIAL_TYPE VID_CALLBACK_API_KEY \
    ARIES_HOLDER_ADMIN_URL ARIES_ISSUER_ADMIN_URL ARIES_VERIFIER_ADMIN_URL ARIES_MEDIATOR_ADMIN_URL \
    ARIES_ADMIN_API_KEY ARIES_HOLDER_ADMIN_API_KEY ARIES_ISSUER_ADMIN_API_KEY ARIES_VERIFIER_ADMIN_API_KEY \
    ARIES_MEDIATOR_ADMIN_API_KEY OIDC_WALLET_DEMO_MODE OIDC_WALLET_ISSUER OIDC_WALLET_PUBLIC_BASE_URL \
    OIDC_WALLET_AUTHORIZATION_ENDPOINT OIDC_WALLET_CLIENT_ID OIDC_WALLET_SCOPE OIDC_WALLET_SESSION_TTL_SECONDS
  do
    append_if_set "$key"
  done

  az webapp config appsettings set \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --settings "${app_settings[@]}" \
    --output none

  log "Creating zip package: $ZIP_PATH"
  rm -f "$ZIP_PATH"
  zip -r "$ZIP_PATH" . \
    -x "node_modules/*" \
    -x ".git/*" \
    -x ".env" \
    -x ".env.*" \
    -x "data/*" \
    -x "ios/*" \
    -x "android/*" \
    -x "business-expenses/*" \
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
fi

log "Waiting for App Service state to be Running"
wait_for_webapp_running "$DEPLOY_TIMEOUT_SECONDS"

log "Polling app health endpoint"
wait_for_http_status "${APP_PUBLIC_BASE_URL%/}/api/health" 200 "$DEPLOY_TIMEOUT_SECONDS"

log "Verifying MediaPipe runtime assets"
wait_for_http_status "${APP_PUBLIC_BASE_URL%/}/vendor/mediapipe/face_detection/face_detection.js" 200 180
assert_content_type_contains "${APP_PUBLIC_BASE_URL%/}/vendor/mediapipe/face_detection/face_detection.js" "application/javascript"

wait_for_http_status "${APP_PUBLIC_BASE_URL%/}/vendor/mediapipe/face_detection/face_detection_solution_simd_wasm_bin.wasm" 200 180
assert_content_type_contains "${APP_PUBLIC_BASE_URL%/}/vendor/mediapipe/face_detection/face_detection_solution_simd_wasm_bin.wasm" "application/wasm"

log "Deployment complete"
printf '\nOpen: %s\n' "$APP_PUBLIC_BASE_URL"
