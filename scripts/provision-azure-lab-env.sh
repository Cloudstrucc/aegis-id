#!/usr/bin/env bash
set -Eeuo pipefail

# Provision a dev/QA Azure lab from scratch:
#   - Resource group
#   - Aegis ID App Service
#   - Business Expenses App Service
#   - ACA-Py holder, issuer, verifier, mediator Azure Container Instances
#   - .env.dev or .env.qa Aries URLs/admin key
#
# Usage:
#   bash scripts/provision-azure-lab-env.sh --env dev
#   bash scripts/provision-azure-lab-env.sh --env qa
#
# Recreate ACA-Py containers if you lost the admin key or need a clean wallet:
#   bash scripts/provision-azure-lab-env.sh --env dev --recreate-containers

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_ENV="${DEPLOY_ENV:-dev}"
ENV_FILE="${ENV_FILE:-}"
ADMIN_API_KEY="${ARIES_ADMIN_API_KEY:-}"
AZURE_LOGIN="${AZURE_LOGIN:-auto}"
AZURE_LOCATION="${AZURE_LOCATION:-canadacentral}"
ACAPY_IMAGE="${ACAPY_IMAGE:-ghcr.io/openwallet-foundation/acapy-agent:1.6}"
RECREATE_CONTAINERS="${RECREATE_CONTAINERS:-0}"
SKIP_APP_SERVICES="${SKIP_APP_SERVICES:-0}"
SKIP_CONTAINERS="${SKIP_CONTAINERS:-0}"

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Provision Vanguard Aegis ID dev/QA Azure lab resources.

Usage:
  bash scripts/provision-azure-lab-env.sh --env dev
  bash scripts/provision-azure-lab-env.sh --env qa

Options:
  --env dev|qa               Target environment. Defaults to dev.
  --env-file PATH            Override the root Aegis ID env file.
  --admin-api-key KEY        Use this ACA-Py admin API key instead of generating one.
  --recreate-containers      Delete and recreate ACA-Py containers.
  --skip-app-services        Do not create/update App Services.
  --skip-containers          Do not create/update ACA-Py containers.
  --azure-login always       Force az login even when already authenticated.
  --help                     Show this help.

Environment overrides:
  AZURE_LOCATION, ACAPY_IMAGE, AZURE_LOGIN
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
    --admin-api-key)
      [[ $# -ge 2 ]] || die "--admin-api-key requires a value"
      ADMIN_API_KEY="$2"
      shift 2
      ;;
    --admin-api-key=*)
      ADMIN_API_KEY="${1#*=}"
      shift
      ;;
    --recreate-containers)
      RECREATE_CONTAINERS=1
      shift
      ;;
    --skip-app-services)
      SKIP_APP_SERVICES=1
      shift
      ;;
    --skip-containers)
      SKIP_CONTAINERS=1
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
  *)
    die "This script is only for dev or QA. Use --env dev or --env qa."
    ;;
esac

# shellcheck source=./env-loader.sh
source "$ROOT_DIR/scripts/env-loader.sh"

ENV_FILE_PATH="$(resolve_env_file "$ROOT_DIR" "$DEPLOY_ENV" "$ENV_FILE")"
BUSINESS_ENV_FILE_PATH="$(resolve_env_file "$ROOT_DIR/examples/business-expenses" "$DEPLOY_ENV" "")"

[[ -f "$ENV_FILE_PATH" ]] || die "Environment file not found: $ENV_FILE_PATH"
[[ -f "$BUSINESS_ENV_FILE_PATH" ]] || die "Business Expenses environment file not found: $BUSINESS_ENV_FILE_PATH"

load_env_file "$ENV_FILE_PATH" || die "Unable to load environment file: $ENV_FILE_PATH"

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

random_hex() {
  openssl rand -hex 32
}

container_exists() {
  local name="$1"
  az container show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$name" \
    --query name \
    --output tsv >/dev/null 2>&1
}

delete_container_if_needed() {
  local name="$1"

  if [[ "$RECREATE_CONTAINERS" == "1" ]] && container_exists "$name"; then
    log "Deleting existing container: $name"
    az container delete \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$name" \
      --yes \
      --output none
  fi
}

create_acapy_container() {
  local name="$1"
  local label="$2"
  local inbound_port="$3"
  local admin_port="$4"
  local wallet_name="$5"
  local wallet_key="$6"
  local extra_args="$7"
  local fqdn="${name}.${AZURE_LOCATION}.azurecontainer.io"

  delete_container_if_needed "$name"

  if container_exists "$name"; then
    log "Container already exists, leaving in place: $name"
    return 0
  fi

  log "Creating ACA-Py container: $name"
  az container create \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$name" \
    --image "$ACAPY_IMAGE" \
    --location "$AZURE_LOCATION" \
    --os-type Linux \
    --cpu 1 \
    --memory 1.5 \
    --restart-policy OnFailure \
    --ip-address Public \
    --dns-name-label "$name" \
    --ports "$inbound_port" "$admin_port" \
    --secure-environment-variables \
      ACAPY_ADMIN_API_KEY="$ADMIN_API_KEY" \
      ACAPY_WALLET_KEY="$wallet_key" \
    --command-line "sh -c 'aca-py start --label \"$label\" --inbound-transport http 0.0.0.0 $inbound_port --outbound-transport http --admin 0.0.0.0 $admin_port --admin-api-key \"\$ACAPY_ADMIN_API_KEY\" --endpoint http://${fqdn}:${inbound_port} --no-ledger --wallet-type askar --wallet-name \"$wallet_name\" --wallet-key \"\$ACAPY_WALLET_KEY\" --auto-provision $extra_args'" \
    --output none
}

require_cmd az
require_cmd awk
require_cmd curl
require_cmd mktemp
require_cmd openssl

AZURE_TENANT_ID="${AZURE_TENANT_ID:-24a46daa-7b87-4566-9eea-281326a1b75c}"
AZURE_SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-7719c366-5f64-439a-a6c6-65067d5a97e4}"
AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-vanguard-aegis-id-${DEPLOY_ENV}}"
AZURE_WEBAPP_NAME="${AZURE_WEBAPP_NAME:-vanguard-aegis-id-${DEPLOY_ENV}-65067d}"
APP_PUBLIC_BASE_URL="${APP_PUBLIC_BASE_URL:-https://${AZURE_WEBAPP_NAME}.azurewebsites.net}"

BUSINESS_RESOURCE_GROUP="$(read_env_value "$BUSINESS_ENV_FILE_PATH" AZURE_RESOURCE_GROUP)"
BUSINESS_WEBAPP_NAME="$(read_env_value "$BUSINESS_ENV_FILE_PATH" AZURE_WEBAPP_NAME)"
BUSINESS_RESOURCE_GROUP="${BUSINESS_RESOURCE_GROUP:-$AZURE_RESOURCE_GROUP}"
BUSINESS_WEBAPP_NAME="${BUSINESS_WEBAPP_NAME:-vanguard-business-expenses-${DEPLOY_ENV}-65067d}"
BUSINESS_PUBLIC_BASE_URL="https://${BUSINESS_WEBAPP_NAME}.azurewebsites.net"

ARIES_HOLDER_NAME="${ARIES_HOLDER_NAME:-vanguard-aegis-holder-${DEPLOY_ENV}-65067d}"
ARIES_ISSUER_NAME="${ARIES_ISSUER_NAME:-vanguard-aegis-issuer-${DEPLOY_ENV}-65067d}"
ARIES_VERIFIER_NAME="${ARIES_VERIFIER_NAME:-vanguard-aegis-verifier-${DEPLOY_ENV}-65067d}"
ARIES_MEDIATOR_NAME="${ARIES_MEDIATOR_NAME:-vanguard-aegis-mediator-${DEPLOY_ENV}-65067d}"

if [[ -z "$ADMIN_API_KEY" ]]; then
  ADMIN_API_KEY="$(read_env_value "$ENV_FILE_PATH" ARIES_ADMIN_API_KEY)"
fi

if [[ -z "$ADMIN_API_KEY" ]]; then
  ADMIN_API_KEY="$(random_hex)"
  log "Generated a new ACA-Py admin API key for $DEPLOY_ENV and will save it to $ENV_FILE_PATH"
else
  log "Using provided/existing ACA-Py admin API key for $DEPLOY_ENV"
fi

if [[ "$AZURE_LOGIN" == "always" ]] || ! az account show >/dev/null 2>&1; then
  log "Starting Azure login. Complete the browser/device prompt if requested."
  az login --tenant "$AZURE_TENANT_ID" --output none
else
  log "Azure CLI is already authenticated"
fi

log "Selecting Azure subscription"
az account set --subscription "$AZURE_SUBSCRIPTION_ID"

log "Creating or updating resource group: $AZURE_RESOURCE_GROUP"
az group create \
  --name "$AZURE_RESOURCE_GROUP" \
  --location "$AZURE_LOCATION" \
  --output none

if [[ "$BUSINESS_RESOURCE_GROUP" != "$AZURE_RESOURCE_GROUP" ]]; then
  log "Creating or updating Business Expenses resource group: $BUSINESS_RESOURCE_GROUP"
  az group create \
    --name "$BUSINESS_RESOURCE_GROUP" \
    --location "$AZURE_LOCATION" \
    --output none
fi

if [[ "$SKIP_APP_SERVICES" != "1" ]]; then
  log "Creating or updating Aegis ID App Service: $AZURE_WEBAPP_NAME"
  az deployment group create \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --template-file "$ROOT_DIR/infra/bicep/main.bicep" \
    --parameters \
      appName="$AZURE_WEBAPP_NAME" \
      publicBaseUrl="$APP_PUBLIC_BASE_URL" \
      sessionSecret="$(random_hex)" \
      azureTenantId="$AZURE_TENANT_ID" \
    --output none

  log "Creating or updating Business Expenses App Service: $BUSINESS_WEBAPP_NAME"
  az deployment group create \
    --resource-group "$BUSINESS_RESOURCE_GROUP" \
    --template-file "$ROOT_DIR/infra/bicep/main.bicep" \
    --parameters \
      appName="$BUSINESS_WEBAPP_NAME" \
      publicBaseUrl="$BUSINESS_PUBLIC_BASE_URL" \
      sessionSecret="$(random_hex)" \
      azureTenantId="$AZURE_TENANT_ID" \
    --output none
else
  log "Skipping App Service provisioning"
fi

if [[ "$SKIP_CONTAINERS" != "1" ]]; then
  create_acapy_container \
    "$ARIES_HOLDER_NAME" \
    "Vanguard Aegis Holder ${DEPLOY_ENV}" \
    6010 \
    6011 \
    "holder-wallet-${DEPLOY_ENV}" \
    "$(random_hex)" \
    "--auto-accept-invites --auto-accept-requests --auto-ping-connection"

  create_acapy_container \
    "$ARIES_ISSUER_NAME" \
    "Vanguard Aries Issuer ${DEPLOY_ENV}" \
    4010 \
    4011 \
    "issuer-wallet-${DEPLOY_ENV}" \
    "$(random_hex)" \
    "--auto-accept-invites --auto-accept-requests --auto-ping-connection"

  create_acapy_container \
    "$ARIES_VERIFIER_NAME" \
    "Vanguard Aries Verifier ${DEPLOY_ENV}" \
    5010 \
    5011 \
    "verifier-wallet-${DEPLOY_ENV}" \
    "$(random_hex)" \
    "--auto-accept-invites --auto-accept-requests --auto-ping-connection"

  create_acapy_container \
    "$ARIES_MEDIATOR_NAME" \
    "Vanguard Aries Mediator ${DEPLOY_ENV}" \
    3010 \
    3011 \
    "mediator-wallet-${DEPLOY_ENV}" \
    "$(random_hex)" \
    "--open-mediation"
else
  log "Skipping ACA-Py container provisioning"
fi

log "Saving environment values"
set_env_value "$ENV_FILE_PATH" "AZURE_RESOURCE_GROUP" "$AZURE_RESOURCE_GROUP"
set_env_value "$ENV_FILE_PATH" "AZURE_WEBAPP_NAME" "$AZURE_WEBAPP_NAME"
set_env_value "$ENV_FILE_PATH" "PUBLIC_BASE_URL" "$APP_PUBLIC_BASE_URL"
set_env_value "$ENV_FILE_PATH" "APP_PUBLIC_BASE_URL" "$APP_PUBLIC_BASE_URL"
set_env_value "$ENV_FILE_PATH" "BUSINESS_EXPENSES_APP_URL" "$BUSINESS_PUBLIC_BASE_URL"
set_env_value "$ENV_FILE_PATH" "ARIES_ADMIN_API_KEY" "$ADMIN_API_KEY"
set_env_value "$ENV_FILE_PATH" "ARIES_HOLDER_ADMIN_URL" "http://${ARIES_HOLDER_NAME}.${AZURE_LOCATION}.azurecontainer.io:6011"
set_env_value "$ENV_FILE_PATH" "ARIES_ISSUER_ADMIN_URL" "http://${ARIES_ISSUER_NAME}.${AZURE_LOCATION}.azurecontainer.io:4011"
set_env_value "$ENV_FILE_PATH" "ARIES_VERIFIER_ADMIN_URL" "http://${ARIES_VERIFIER_NAME}.${AZURE_LOCATION}.azurecontainer.io:5011"
set_env_value "$ENV_FILE_PATH" "ARIES_MEDIATOR_ADMIN_URL" "http://${ARIES_MEDIATOR_NAME}.${AZURE_LOCATION}.azurecontainer.io:3011"

set_env_value "$BUSINESS_ENV_FILE_PATH" "AZURE_RESOURCE_GROUP" "$BUSINESS_RESOURCE_GROUP"
set_env_value "$BUSINESS_ENV_FILE_PATH" "AZURE_WEBAPP_NAME" "$BUSINESS_WEBAPP_NAME"
set_env_value "$BUSINESS_ENV_FILE_PATH" "APP_PUBLIC_BASE_URL" "$BUSINESS_PUBLIC_BASE_URL"
set_env_value "$BUSINESS_ENV_FILE_PATH" "AEGIS_ID_BASE_URL" "$APP_PUBLIC_BASE_URL"

if [[ "$SKIP_CONTAINERS" != "1" ]]; then
  log "Validating Azure lab resources"
  bash "$ROOT_DIR/scripts/prepare-azure-lab-env.sh" \
    --env "$DEPLOY_ENV" \
    --admin-api-key "$ADMIN_API_KEY"
else
  log "Skipping prepare validation because containers were skipped"
fi

cat <<EOF

Provisioning complete for $DEPLOY_ENV.

Env files updated:
  $ENV_FILE_PATH
  $BUSINESS_ENV_FILE_PATH

Next:
  bash scripts/deploy-azure-webapp.sh --env $DEPLOY_ENV

Then create an organization in the $DEPLOY_ENV Aegis ID web app, set AEGIS_ORGANIZATION_ID in:
  $BUSINESS_ENV_FILE_PATH

Then:
  bash scripts/deploy-azure-business-expenses.sh --env $DEPLOY_ENV

If you lose the ACA-Py admin key, recreate the lab containers:
  bash scripts/provision-azure-lab-env.sh --env $DEPLOY_ENV --recreate-containers
EOF
