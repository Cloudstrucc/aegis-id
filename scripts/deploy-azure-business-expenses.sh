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
#   --tenant alias-or-tenant-id
#   AZURE_TENANT_ID=... AZURE_SUBSCRIPTION_ID=... AZURE_RESOURCE_GROUP=...
#   AZURE_WEBAPP_NAME=... APP_PUBLIC_BASE_URL=... AEGIS_ID_BASE_URL=...
#   AEGIS_ORGANIZATION_ID=... BUSINESS_SESSION_SECRET=... SKIP_NPM_INSTALL=1 AZURE_LOGIN=always
#   --allow-dirty (ALLOW_DIRTY=1) to package a tree that does not match its commit

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/examples/business-expenses"
DEPLOY_ENV="${DEPLOY_ENV:-prod}"
ENV_FILE="${ENV_FILE:-}"
TENANT_PROFILE="${TENANT_PROFILE:-}"
ALLOW_DIRTY="${ALLOW_DIRTY:-0}"

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
    --tenant|--tenant-profile)
      [[ $# -ge 2 ]] || die "$1 requires a value"
      TENANT_PROFILE="$2"
      shift 2
      ;;
    --tenant=*|--tenant-profile=*)
      TENANT_PROFILE="${1#*=}"
      shift
      ;;
    --allow-dirty)
      ALLOW_DIRTY=1
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
# shellcheck source=./git-guard.sh
source "$ROOT_DIR/scripts/git-guard.sh"
ENV_FILE_PATH="$(resolve_env_file "$APP_DIR" "$DEPLOY_ENV" "$ENV_FILE")"
load_env_file "$ENV_FILE_PATH" || die "Environment file not found: $ENV_FILE_PATH"
TENANT_KEYS=(
  AZURE_TENANT_ID AZURE_SUBSCRIPTION_ID AZURE_RESOURCE_GROUP AZURE_WEBAPP_NAME WEBSITE_NODE_DEFAULT_VERSION
  APP_PUBLIC_BASE_URL AEGIS_ID_BASE_URL SESSION_SECRET BUSINESS_SESSION_SECRET
  AEGIS_OIDC_AUTHORIZATION_ENDPOINT AEGIS_OIDC_TOKEN_ENDPOINT OIDC_CLIENT_ID OIDC_SCOPE
  VERIFIED_ID_AUTH_ENABLED YUBIKEY_AUTH_ENABLED AEGIS_WALLET_PASSKEY_APPROVALS_REQUIRED
  AEGIS_ORGANIZATION_ID AEGIS_ISSUER_CONNECTION_ID
)
apply_tenant_profile "$TENANT_PROFILE" "${TENANT_KEYS[@]}" || die "Unable to apply tenant profile: $TENANT_PROFILE"
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
# One run must not overwrite another's package. Two deployments of different
# environments overlap routinely — dev while qa is still building — and a fixed
# path means the second `zip` truncates the file the first is still uploading.
# An explicit ZIP_PATH is the caller's file and is left where they put it.
if [ -n "${ZIP_PATH:-}" ]; then
  ZIP_PATH_IS_TEMPORARY=0
else
  zip_tmp_dir="${TMPDIR:-/tmp}"
  zip_tmp_dir="${zip_tmp_dir%/}"
  zip_tenant_slug="${TENANT_PROFILE:-default}"
  zip_tenant_slug="${zip_tenant_slug//[^A-Za-z0-9]/-}"
  ZIP_PATH="${zip_tmp_dir}/vanguard-business-expenses-${DEPLOY_ENV}-${zip_tenant_slug}-$$.zip"
  ZIP_PATH_IS_TEMPORARY=1
fi

cleanup_zip() {
  if [ "${ZIP_PATH_IS_TEMPORARY:-0}" = "1" ] && [ -n "${ZIP_PATH:-}" ]; then
    rm -f "$ZIP_PATH"
  fi
}
trap cleanup_zip EXIT
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

# Kudu's zip deploy runs an Oryx build (npm install on the App Service host),
# and on the F1 tier that can take four or five minutes — longer than the
# gateway in front of the synchronous deploy call is willing to wait. The call
# then reports a 504 while the build carries on and succeeds, so a synchronous
# deploy is a coin toss between "worked" and "worked, but the script said it
# failed". Deploy asynchronously and watch the deployment itself instead.
kudu_latest_deployment_field() {
  local field="$1"
  az rest --method get \
    --url "https://${AZURE_WEBAPP_NAME}.scm.azurewebsites.net/api/deployments/latest" \
    --resource https://management.azure.com/ \
    --query "$field" --output tsv 2>/dev/null || true
}

wait_for_kudu_deployment() {
  local previous_id="${1:-}"
  local timeout_seconds="${2:-$DEPLOY_TIMEOUT_SECONDS}"
  local started_at
  started_at="$(date +%s)"
  local kudu_url="https://${AZURE_WEBAPP_NAME}.scm.azurewebsites.net/api/deployments/latest"

  while true; do
    local id status complete message
    id="$(kudu_latest_deployment_field id)"
    # Until Kudu has registered the new deployment, "latest" is still the old
    # one — which finished successfully, and must not be mistaken for this one.
    if [[ -n "$id" && "$id" != "$previous_id" ]]; then
      status="$(kudu_latest_deployment_field status)"
      complete="$(kudu_latest_deployment_field complete)"
      message="$(kudu_latest_deployment_field progress)"

      # Kudu status codes: 0 Pending, 1 Building, 2 Deploying, 3 Failed, 4 Success.
      if [[ "$complete" == "true" && "$status" == "4" ]]; then
        printf '\n'
        log "Kudu deployment succeeded"
        return 0
      fi
      if [[ "$status" == "3" ]]; then
        printf '\n'
        fail "Kudu deployment failed. Read the log at ${kudu_url%/latest}"
      fi
    fi

    local now
    now="$(date +%s)"
    if (( now - started_at >= timeout_seconds )); then
      printf '\n'
      fail "Timed out waiting for the Kudu deployment to finish. Check ${kudu_url}. Last status: ${status:-unknown} ${message:-}"
    fi

    printf '.'
    sleep "$POLL_INTERVAL_SECONDS"
  done
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

# The deployed page must not send the holder's browser to anybody else. A
# missing vendored file fails loudly above; a re-introduced CDN tag would not,
# because the page still renders — it just renders by asking a third party.
assert_body_has_no_third_party_origin() {
  local url="$1"
  local body
  body="$(curl -k -L -sS "$url")"

  local offenders
  offenders="$(printf '%s' "$body" \
    | grep -ohE '(src|href)="https?://[^"]+"' \
    | grep -vE "$(printf '%s' "$APP_PUBLIC_BASE_URL" | sed 's/[.[\*^$]/\\&/g')" \
    || true)"

  if [ -n "$offenders" ]; then
    printf '%s\n' "$offenders" >&2
    fail "$url loads assets from an origin that is not this app. Vendor them with scripts/fetch-example-vendor.sh."
  fi

  log "Verified $url loads nothing from a third-party origin"
}

require_cmd az
require_cmd curl
require_cmd npm
require_cmd node
require_cmd zip

# Before anything is installed, built or uploaded. The zip below is made from
# the working tree rather than from a commit, so this is the last point at
# which a tree nobody could reconstruct can still be refused.
assert_clean_checkout "$ROOT_DIR" "$DEPLOY_ENV" "$ALLOW_DIRTY" \
  || fail "Refusing to deploy a checkout that cannot be named by a commit."

# AEGIS_ORGANIZATION_ID is no longer required: holders choose their organization
# from the ones their own token carries. It stays supported as a fallback.

cd "$APP_DIR"

log "Deploying Vanguard Business Expenses to Azure App Service"
log "Tenant:        $AZURE_TENANT_ID"
log "Subscription:  $AZURE_SUBSCRIPTION_ID"
log "Resource group:$AZURE_RESOURCE_GROUP"
log "Web app:       $AZURE_WEBAPP_NAME"
log "Base URL:      $APP_PUBLIC_BASE_URL"
log "Aegis URL:     $AEGIS_ID_BASE_URL"
log "Organization:  ${AEGIS_ORGANIZATION_ID:-<holder chooses>}"
log "Env file:      $ENV_FILE_PATH"
if [[ -n "${TENANT_PROFILE:-}" ]]; then
  log "Tenant profile:$TENANT_PROFILE"
fi

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

log "Selecting Azure subscription: $AZURE_SUBSCRIPTION_ID"
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
  "AEGIS_WALLET_PASSKEY_APPROVALS_REQUIRED=${AEGIS_WALLET_PASSKEY_APPROVALS_REQUIRED:-false}"
  "DATA_DIR=${DATA_DIR:-/home/data/business-expenses/$DEPLOY_ENV}"
)

append_if_set() {
  local key="$1"
  if [[ -n "${!key:-}" ]]; then
    app_settings+=("$key=${!key}")
  fi
}

append_if_set AEGIS_ORGANIZATION_ID
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
previous_deployment_id="$(kudu_latest_deployment_field id)"
# --async: the call returns once the package is accepted; the build is
# watched below. A failure here is still a failure — the package did not
# get through — so it is not swallowed.
az webapp deploy \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_WEBAPP_NAME" \
  --src-path "$ZIP_PATH" \
  --type zip \
  --restart true \
  --async true \
  --output none

log "Waiting for the Kudu build and deployment to finish"
wait_for_kudu_deployment "$previous_deployment_id" "$DEPLOY_TIMEOUT_SECONDS"

log "Polling deployed app"
wait_for_http_status "$APP_PUBLIC_BASE_URL" 200 "$DEPLOY_TIMEOUT_SECONDS"

# Bootstrap, Bootswatch, Bootstrap Icons and pdf.js are served from this app's
# own origin, so a page that renders is no longer proof they arrived: a missing
# vendored file leaves an unstyled page that still answers 200. Check the files
# themselves, and that nothing points off-origin any more.
log "Verifying self-hosted assets"
wait_for_http_status "${APP_PUBLIC_BASE_URL%/}/vendor/bootstrap/bootstrap.flatly.min.css" 200 180
assert_content_type_contains "${APP_PUBLIC_BASE_URL%/}/vendor/bootstrap/bootstrap.flatly.min.css" "text/css"
wait_for_http_status "${APP_PUBLIC_BASE_URL%/}/vendor/bootstrap/bootstrap.bundle.min.js" 200 180
assert_content_type_contains "${APP_PUBLIC_BASE_URL%/}/vendor/bootstrap/bootstrap.bundle.min.js" "javascript"
wait_for_http_status "${APP_PUBLIC_BASE_URL%/}/vendor/bootstrap-icons/bootstrap-icons.min.css" 200 180
wait_for_http_status "${APP_PUBLIC_BASE_URL%/}/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2" 200 180
assert_content_type_contains "${APP_PUBLIC_BASE_URL%/}/vendor/bootstrap-icons/fonts/bootstrap-icons.woff2" "font/woff2"
# pdf.js and its worker must be the same build or pdf.js refuses the worker,
# and a .mjs served as anything but JavaScript is rejected by the module loader.
wait_for_http_status "${APP_PUBLIC_BASE_URL%/}/vendor/pdfjs/pdf.min.mjs" 200 180
assert_content_type_contains "${APP_PUBLIC_BASE_URL%/}/vendor/pdfjs/pdf.min.mjs" "javascript"
wait_for_http_status "${APP_PUBLIC_BASE_URL%/}/vendor/pdfjs/pdf.worker.min.mjs" 200 180
assert_content_type_contains "${APP_PUBLIC_BASE_URL%/}/vendor/pdfjs/pdf.worker.min.mjs" "javascript"
assert_body_has_no_third_party_origin "$APP_PUBLIC_BASE_URL"

log "Deployment complete"
printf '\nOpen: %s\n' "$APP_PUBLIC_BASE_URL"
