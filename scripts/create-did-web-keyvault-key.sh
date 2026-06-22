#!/usr/bin/env bash
set -Eeuo pipefail

# Create or reuse the Azure Key Vault key used by the Aegis DID:web issuer.
#
# The key created here is an EC P-256 key suitable for ES256 signing. The script
# follows the same --env and --tenant profile pattern used by the Azure deploy
# scripts, then writes the versionless Key Vault key ID back to the selected env
# file so later deployments can pick it up.
#
# Usage:
#   bash scripts/create-did-web-keyvault-key.sh --env prod
#   bash scripts/create-did-web-keyvault-key.sh --env dev --tenant vanguardcs
#   bash scripts/create-did-web-keyvault-key.sh --env qa --tenant vanguardcs

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEPLOY_ENV="${DEPLOY_ENV:-prod}"
ENV_FILE="${ENV_FILE:-}"
TENANT_PROFILE="${TENANT_PROFILE:-}"
AZURE_LOGIN="${AZURE_LOGIN:-auto}"
TARGET_LOCATION="${AZURE_LOCATION:-canadacentral}"
RESOURCE_GROUP_OVERRIDE="${AZURE_RESOURCE_GROUP_OVERRIDE:-}"
WEBAPP_NAME_OVERRIDE="${AZURE_WEBAPP_NAME_OVERRIDE:-}"
VAULT_NAME="${AEGIS_DID_WEB_KEYVAULT_NAME:-}"
KEY_NAME_OVERRIDE="${AEGIS_DID_WEB_KEY_NAME_OVERRIDE:-}"
ASSIGN_WEBAPP_IDENTITY=1
UPDATE_ENV_FILE=1
ROTATE_KEY=0

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

log() {
  printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"
}

usage() {
  cat <<'EOF'
Create the Azure Key Vault key used for Aegis DID:web / ES256 signing.

Usage:
  bash scripts/create-did-web-keyvault-key.sh --env prod
  bash scripts/create-did-web-keyvault-key.sh --env dev
  bash scripts/create-did-web-keyvault-key.sh --env qa
  bash scripts/create-did-web-keyvault-key.sh --env dev --tenant vanguardcs
  bash scripts/create-did-web-keyvault-key.sh --env qa --tenant vanguardcs

Options:
  --env dev|qa|prod          Target env file. Defaults to prod (.env).
  --env-file PATH            Override the root Aegis ID env file.
  --tenant VALUE             Tenant profile alias or Azure tenant ID. Omit for default Cloudstrucc env values.
  --resource-group NAME      Override AZURE_RESOURCE_GROUP from env.
  --webapp-name NAME         Override AZURE_WEBAPP_NAME from env.
  --location REGION          Override AZURE_LOCATION from env. Defaults to canadacentral.
  --vault-name NAME          Override vault name parsed from AEGIS_DID_WEB_KEYVAULT_URL.
  --key-name NAME            Override AEGIS_DID_WEB_KEY_NAME. Defaults to aegis-did-web-signing.
  --rotate-key               Create a new key version when the key already exists.
  --no-webapp-identity       Skip assigning App Service managed identity access.
  --no-env-update            Do not write Key Vault values back to the env file.
  --azure-login always       Force az login even when Azure CLI is already authenticated.
  --help                     Show this help.

What it creates:
  - Resource group, if missing
  - Key Vault, if missing, with RBAC authorization enabled
  - EC P-256 key with sign/verify operations for ES256 signing
  - Optional App Service system-assigned managed identity
  - Optional Key Vault Crypto User role assignment for the App Service identity

Notes:
  - The private key never leaves Azure Key Vault.
  - The env file stores only the vault URL and versionless key ID, not a secret.
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
    --resource-group)
      [[ $# -ge 2 ]] || die "--resource-group requires a value"
      RESOURCE_GROUP_OVERRIDE="$2"
      shift 2
      ;;
    --resource-group=*)
      RESOURCE_GROUP_OVERRIDE="${1#*=}"
      shift
      ;;
    --webapp-name)
      [[ $# -ge 2 ]] || die "--webapp-name requires a value"
      WEBAPP_NAME_OVERRIDE="$2"
      shift 2
      ;;
    --webapp-name=*)
      WEBAPP_NAME_OVERRIDE="${1#*=}"
      shift
      ;;
    --location)
      [[ $# -ge 2 ]] || die "--location requires a value"
      TARGET_LOCATION="$2"
      shift 2
      ;;
    --location=*)
      TARGET_LOCATION="${1#*=}"
      shift
      ;;
    --vault-name)
      [[ $# -ge 2 ]] || die "--vault-name requires a value"
      VAULT_NAME="$2"
      shift 2
      ;;
    --vault-name=*)
      VAULT_NAME="${1#*=}"
      shift
      ;;
    --key-name)
      [[ $# -ge 2 ]] || die "--key-name requires a value"
      KEY_NAME_OVERRIDE="$2"
      shift 2
      ;;
    --key-name=*)
      KEY_NAME_OVERRIDE="${1#*=}"
      shift
      ;;
    --rotate-key)
      ROTATE_KEY=1
      shift
      ;;
    --no-webapp-identity)
      ASSIGN_WEBAPP_IDENTITY=0
      shift
      ;;
    --no-env-update)
      UPDATE_ENV_FILE=0
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

command -v az >/dev/null 2>&1 || die "Azure CLI is required. Install it first, then run this script again."

# shellcheck source=./env-loader.sh
source "$ROOT_DIR/scripts/env-loader.sh"

ENV_FILE_PATH="$(resolve_env_file "$ROOT_DIR" "$DEPLOY_ENV" "$ENV_FILE")"
[[ -f "$ENV_FILE_PATH" ]] || die "Environment file not found: $ENV_FILE_PATH"

load_env_file "$ENV_FILE_PATH" || die "Unable to load environment file: $ENV_FILE_PATH"

TENANT_KEYS=(
  AZURE_TENANT_ID AZURE_SUBSCRIPTION_ID AZURE_RESOURCE_GROUP AZURE_WEBAPP_NAME AZURE_LOCATION
  AEGIS_DID_WEB_ENABLED AEGIS_DID_WEB_DOMAIN AEGIS_DID_WEB_ORIGIN AEGIS_DID_WEB_ID
  AEGIS_DID_WEB_KEY_NAME AEGIS_DID_WEB_KEY_ALG AEGIS_DID_WEB_KEY_CURVE
  AEGIS_DID_WEB_KEYVAULT_URL AEGIS_DID_WEB_KEYVAULT_KEY_ID
  AEGIS_DID_WEB_CACHE_TTL_SECONDS AEGIS_DID_WEB_CREDENTIAL_TTL_DAYS
)

if [[ -n "$TENANT_PROFILE" ]]; then
  NORMALIZED_TENANT_PROFILE="$(normalize_tenant_profile "$TENANT_PROFILE")"
  case "$NORMALIZED_TENANT_PROFILE" in
    CLOUDSTRUCC|DEFAULT|ROOT)
      log "Using root/default env values for Cloudstrucc; no tenant profile overlay needed"
      TENANT_PROFILE=""
      ;;
  esac
fi

apply_tenant_profile "$TENANT_PROFILE" "${TENANT_KEYS[@]}" || die "Unable to apply tenant profile: $TENANT_PROFILE"

AZURE_TENANT_ID="${AZURE_TENANT_ID:-}"
AZURE_SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-}"
AZURE_RESOURCE_GROUP="${RESOURCE_GROUP_OVERRIDE:-${AZURE_RESOURCE_GROUP:-}}"
AZURE_WEBAPP_NAME="${WEBAPP_NAME_OVERRIDE:-${AZURE_WEBAPP_NAME:-}}"
TARGET_LOCATION="${AZURE_LOCATION:-$TARGET_LOCATION}"
KEY_NAME="${KEY_NAME_OVERRIDE:-${AEGIS_DID_WEB_KEY_NAME:-aegis-did-web-signing}}"
KEY_ALG="${AEGIS_DID_WEB_KEY_ALG:-ES256}"
KEY_CURVE="${AEGIS_DID_WEB_KEY_CURVE:-P-256}"

[[ -n "$AZURE_TENANT_ID" ]] || die "AZURE_TENANT_ID is required in $ENV_FILE_PATH."
[[ -n "$AZURE_SUBSCRIPTION_ID" ]] || die "AZURE_SUBSCRIPTION_ID is required in $ENV_FILE_PATH."
[[ -n "$AZURE_RESOURCE_GROUP" ]] || die "AZURE_RESOURCE_GROUP is required in $ENV_FILE_PATH."
[[ -n "$TARGET_LOCATION" ]] || die "AZURE_LOCATION is required in $ENV_FILE_PATH."
[[ "$KEY_ALG" == "ES256" ]] || die "This script supports ES256 only. Current AEGIS_DID_WEB_KEY_ALG=$KEY_ALG."
[[ "$KEY_CURVE" == "P-256" ]] || die "This script supports P-256 only. Current AEGIS_DID_WEB_KEY_CURVE=$KEY_CURVE."

if [[ -z "$VAULT_NAME" && -n "${AEGIS_DID_WEB_KEYVAULT_URL:-}" ]]; then
  vault_url="${AEGIS_DID_WEB_KEYVAULT_URL%/}"
  if [[ "$vault_url" =~ ^https://([A-Za-z0-9-]+)\.vault\.azure\.net$ ]]; then
    VAULT_NAME="${BASH_REMATCH[1]}"
  fi
fi

if [[ -z "$VAULT_NAME" ]]; then
  if [[ -z "$AZURE_WEBAPP_NAME" ]]; then
    die "Unable to derive Key Vault name. Set AEGIS_DID_WEB_KEYVAULT_URL or pass --vault-name."
  fi

  suffix="${AZURE_WEBAPP_NAME##*-}"
  if [[ "$DEPLOY_ENV" == "prod" ]]; then
    VAULT_NAME="kv-aegis-${suffix}"
  else
    VAULT_NAME="kv-aegis-${DEPLOY_ENV}-${suffix}"
  fi
fi

if ! [[ "$VAULT_NAME" =~ ^[A-Za-z][A-Za-z0-9-]{1,22}[A-Za-z0-9]$ ]]; then
  die "Invalid Key Vault name '$VAULT_NAME'. It must be 3-24 chars, start with a letter, and contain only letters, numbers, and hyphens."
fi

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

wait_for_provider_registration() {
  local namespace="$1"
  local state

  state="$(az provider show --namespace "$namespace" --query registrationState --output tsv 2>/dev/null || true)"
  if [[ "$state" == "Registered" ]]; then
    return 0
  fi

  log "Registering Azure resource provider: $namespace"
  az provider register --namespace "$namespace" --output none

  for _ in {1..30}; do
    state="$(az provider show --namespace "$namespace" --query registrationState --output tsv 2>/dev/null || true)"
    [[ "$state" == "Registered" ]] && return 0
    sleep 5
  done

  die "Timed out waiting for $namespace registration."
}

grant_current_principal_keyvault_admin() {
  local vault_id="$1"
  local object_id account_user account_type

  object_id="$(az ad signed-in-user show --query id --output tsv 2>/dev/null || true)"

  if [[ -z "$object_id" ]]; then
    account_user="$(az account show --query user.name --output tsv 2>/dev/null || true)"
    account_type="$(az account show --query user.type --output tsv 2>/dev/null || true)"
    if [[ "$account_type" == "servicePrincipal" && -n "$account_user" ]]; then
      object_id="$(az ad sp show --id "$account_user" --query id --output tsv 2>/dev/null || true)"
    fi
  fi

  if [[ -z "$object_id" ]]; then
    log "Could not resolve current Azure principal object ID; skipping Key Vault Administrator self-assignment"
    return 0
  fi

  if [[ "$VAULT_RBAC_ENABLED" == "true" ]]; then
    log "Ensuring current Azure principal can create/read keys through Key Vault RBAC"
    az role assignment create \
      --assignee "$object_id" \
      --role "Key Vault Administrator" \
      --scope "$vault_id" \
      --output none 2>/dev/null || true
  else
    log "Ensuring current Azure principal can create/read keys through Key Vault access policies"
    az keyvault set-policy \
      --name "$VAULT_NAME" \
      --object-id "$object_id" \
      --key-permissions get list create update sign verify \
      --output none 2>/dev/null || true
  fi
}

ensure_key_exists() {
  local vault_name="$1"
  local key_name="$2"
  local key_id=""

  if [[ "$ROTATE_KEY" != "1" ]]; then
    key_id="$(az keyvault key show --vault-name "$vault_name" --name "$key_name" --query key.kid --output tsv 2>/dev/null || true)"
    if [[ -n "$key_id" ]]; then
      log "Key already exists: $key_name"
      printf '%s\n' "$key_id"
      return 0
    fi
  fi

  if [[ "$ROTATE_KEY" == "1" ]]; then
    log "Creating a new version for Key Vault key: $key_name"
  else
    log "Creating Key Vault key: $key_name"
  fi

  for attempt in {1..18}; do
    if key_id="$(
      az keyvault key create \
        --vault-name "$vault_name" \
        --name "$key_name" \
        --kty EC \
        --curve P-256 \
        --ops sign verify \
        --query key.kid \
        --output tsv 2>/dev/null
    )"; then
      printf '%s\n' "$key_id"
      return 0
    fi

    log "Waiting for Key Vault permission propagation before retrying key creation ($attempt/18)"
    sleep 10
  done

  die "Unable to create Key Vault key '$key_name'. Check Key Vault RBAC permissions and retry."
}

assign_webapp_crypto_user() {
  local vault_id="$1"
  local principal_id

  if [[ "$ASSIGN_WEBAPP_IDENTITY" != "1" ]]; then
    return 0
  fi

  if [[ -z "$AZURE_WEBAPP_NAME" ]]; then
    log "AZURE_WEBAPP_NAME is empty; skipping App Service managed identity role assignment"
    return 0
  fi

  if ! az webapp show --resource-group "$AZURE_RESOURCE_GROUP" --name "$AZURE_WEBAPP_NAME" >/dev/null 2>&1; then
    log "App Service not found yet: $AZURE_WEBAPP_NAME. Skipping managed identity role assignment for now."
    return 0
  fi

  log "Ensuring App Service has a system-assigned managed identity"
  principal_id="$(
    az webapp identity assign \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_WEBAPP_NAME" \
      --query principalId \
      --output tsv
  )"

  if [[ -z "$principal_id" || "$principal_id" == "null" ]]; then
    log "Could not resolve App Service managed identity principal ID; skipping Key Vault role assignment"
    return 0
  fi

  if [[ "$VAULT_RBAC_ENABLED" == "true" ]]; then
    log "Granting App Service Key Vault Crypto User on the vault"
    az role assignment create \
      --assignee-object-id "$principal_id" \
      --assignee-principal-type ServicePrincipal \
      --role "Key Vault Crypto User" \
      --scope "$vault_id" \
      --output none 2>/dev/null || true
  else
    log "Granting App Service key get/sign/verify permissions through Key Vault access policy"
    az keyvault set-policy \
      --name "$VAULT_NAME" \
      --object-id "$principal_id" \
      --key-permissions get sign verify \
      --output none 2>/dev/null || true
  fi
}

if [[ "$AZURE_LOGIN" == "always" ]] || ! az account show >/dev/null 2>&1; then
  log "Starting Azure login. Complete the browser/device prompt if requested."
  az login --tenant "$AZURE_TENANT_ID" --output none
else
  log "Azure CLI is already authenticated"
fi

log "Selecting Azure subscription: $AZURE_SUBSCRIPTION_ID"
az account set --subscription "$AZURE_SUBSCRIPTION_ID"

wait_for_provider_registration "Microsoft.KeyVault"

log "Creating or updating resource group: $AZURE_RESOURCE_GROUP"
az group create \
  --name "$AZURE_RESOURCE_GROUP" \
  --location "$TARGET_LOCATION" \
  --output none

if ! az keyvault show --resource-group "$AZURE_RESOURCE_GROUP" --name "$VAULT_NAME" >/dev/null 2>&1; then
  existing_vault_id="$(az keyvault show --name "$VAULT_NAME" --query id --output tsv 2>/dev/null || true)"
  if [[ -n "$existing_vault_id" ]]; then
    die "Key Vault '$VAULT_NAME' already exists outside resource group '$AZURE_RESOURCE_GROUP': $existing_vault_id. Use a unique AEGIS_DID_WEB_KEYVAULT_URL in $ENV_FILE_PATH or pass --vault-name."
  fi

  log "Creating Key Vault: $VAULT_NAME"
  if ! az keyvault create \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$VAULT_NAME" \
    --location "$TARGET_LOCATION" \
    --sku standard \
    --enable-rbac-authorization true \
    --output none
  then
    die "Unable to create Key Vault '$VAULT_NAME'. Key Vault names are globally unique; choose a different AEGIS_DID_WEB_KEYVAULT_URL or pass --vault-name."
  fi
else
  log "Key Vault already exists: $VAULT_NAME"
fi

VAULT_ID="$(az keyvault show --resource-group "$AZURE_RESOURCE_GROUP" --name "$VAULT_NAME" --query id --output tsv)"
VAULT_URI="$(az keyvault show --resource-group "$AZURE_RESOURCE_GROUP" --name "$VAULT_NAME" --query properties.vaultUri --output tsv)"
VAULT_RBAC_ENABLED="$(az keyvault show --resource-group "$AZURE_RESOURCE_GROUP" --name "$VAULT_NAME" --query properties.enableRbacAuthorization --output tsv)"
VAULT_URI="${VAULT_URI%/}/"
VERSIONLESS_KEY_ID="${VAULT_URI}keys/${KEY_NAME}"

grant_current_principal_keyvault_admin "$VAULT_ID"
VERSIONED_KEY_ID="$(ensure_key_exists "$VAULT_NAME" "$KEY_NAME" | tail -n 1)"
assign_webapp_crypto_user "$VAULT_ID"

if [[ "$UPDATE_ENV_FILE" == "1" ]]; then
  if [[ -n "${TENANT_PROFILE:-}" ]]; then
    env_prefix="TENANT_${TENANT_PROFILE}_"
  else
    env_prefix=""
  fi

  log "Writing DID:web Key Vault values to $ENV_FILE_PATH"
  set_env_value "$ENV_FILE_PATH" "${env_prefix}AEGIS_DID_WEB_KEY_NAME" "$KEY_NAME"
  set_env_value "$ENV_FILE_PATH" "${env_prefix}AEGIS_DID_WEB_KEY_ALG" "ES256"
  set_env_value "$ENV_FILE_PATH" "${env_prefix}AEGIS_DID_WEB_KEY_CURVE" "P-256"
  set_env_value "$ENV_FILE_PATH" "${env_prefix}AEGIS_DID_WEB_KEYVAULT_URL" "$VAULT_URI"
  set_env_value "$ENV_FILE_PATH" "${env_prefix}AEGIS_DID_WEB_KEYVAULT_KEY_ID" "$VERSIONLESS_KEY_ID"
fi

log "DID:web Key Vault key is ready"
printf '\nEnvironment:      %s\n' "$DEPLOY_ENV"
if [[ -n "${TENANT_PROFILE:-}" ]]; then
  printf 'Tenant profile:   %s\n' "$TENANT_PROFILE"
fi
printf 'Resource group:   %s\n' "$AZURE_RESOURCE_GROUP"
printf 'Key Vault:        %s\n' "$VAULT_NAME"
printf 'Vault URL:        %s\n' "$VAULT_URI"
printf 'Key name:         %s\n' "$KEY_NAME"
printf 'Key algorithm:    ES256\n'
printf 'Key curve:        P-256\n'
printf 'Versionless ID:   %s\n' "$VERSIONLESS_KEY_ID"
printf 'Versioned ID:     %s\n\n' "$VERSIONED_KEY_ID"
printf 'Next deploy will carry these values via:\n'
printf '  bash scripts/deploy-azure-webapp.sh --env %s%s\n' "$DEPLOY_ENV" "${TENANT_PROFILE:+ --tenant $TENANT_PROFILE}"
