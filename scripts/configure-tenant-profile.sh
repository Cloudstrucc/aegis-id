#!/usr/bin/env bash
set -Eeuo pipefail

# Seed tenant-scoped variables into the root Aegis ID and Business Expenses env files.
#
# Usage:
#   bash scripts/configure-tenant-profile.sh --tenant vanguardcs
#   bash scripts/configure-tenant-profile.sh --tenant contoso --tenant-id ... --subscription-id ... --client-id ...

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TENANT_ALIAS="${TENANT_ALIAS:-vanguardcs}"
TENANT_ID="${AZURE_TENANT_ID:-6b4b0578-e6a2-4693-8f4c-af55cb10de87}"
SUBSCRIPTION_ID="${AZURE_SUBSCRIPTION_ID:-93471fe7-92b9-43a5-85b3-72b0ee0e75d1}"
AZURE_CLIENT_ID_VALUE="${AZURE_CLIENT_ID:-d67a6415-1033-40e1-85a1-87692c73aea9}"
VID_AUTHORITY_DID_VALUE="${VID_AUTHORITY_DID:-did:web:verifiedid.entra.microsoft.com:6b4b0578-e6a2-4693-8f4c-af55cb10de87:bc62bab7-bb47-aff1-36fb-b989b9eda26c}"
VID_MANIFEST_URL_VALUE="${VID_MANIFEST_URL:-https://verifiedid.did.msidentity.com/v1.0/tenants/6b4b0578-e6a2-4693-8f4c-af55cb10de87/verifiableCredentials/contracts/15c092a5-660a-5a5d-76a5-c7f03d418504/manifest}"
VID_CREDENTIAL_TYPE_VALUE="${VID_CREDENTIAL_TYPE:-VerifiedEmployee}"
AZURE_LOCATION="${AZURE_LOCATION:-canadacentral}"
TARGET_ENV="${TARGET_ENV:-all}"
RESOURCE_SUFFIX="${RESOURCE_SUFFIX:-}"

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Seed tenant profile variables into Aegis ID env files.

Usage:
  bash scripts/configure-tenant-profile.sh --tenant vanguardcs

Options:
  --tenant ALIAS             Tenant profile alias, for example vanguardcs.
  --tenant-id ID             Azure tenant ID.
  --subscription-id ID       Azure subscription ID.
  --client-id ID             App registration client ID used by Verified ID.
  --authority-did DID        Microsoft Entra Verified ID authority DID.
  --manifest-url URL         Verified ID manifest URL.
  --credential-type TYPE     Verified ID credential type.
  --resource-suffix SUFFIX   Globally unique suffix for App Service/ACI names.
  --env prod|dev|qa|all      Env files to update. Defaults to all.
  --location REGION          Azure region. Defaults to canadacentral.
  --help                     Show this help.

The script writes TENANT_<ALIAS>_* variables. It leaves secret values blank so you
can set them manually before provisioning/deploying.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tenant|--tenant-profile)
      [[ $# -ge 2 ]] || die "$1 requires a value"
      TENANT_ALIAS="$2"
      shift 2
      ;;
    --tenant=*|--tenant-profile=*)
      TENANT_ALIAS="${1#*=}"
      shift
      ;;
    --tenant-id)
      [[ $# -ge 2 ]] || die "--tenant-id requires a value"
      TENANT_ID="$2"
      shift 2
      ;;
    --tenant-id=*)
      TENANT_ID="${1#*=}"
      shift
      ;;
    --subscription-id)
      [[ $# -ge 2 ]] || die "--subscription-id requires a value"
      SUBSCRIPTION_ID="$2"
      shift 2
      ;;
    --subscription-id=*)
      SUBSCRIPTION_ID="${1#*=}"
      shift
      ;;
    --client-id)
      [[ $# -ge 2 ]] || die "--client-id requires a value"
      AZURE_CLIENT_ID_VALUE="$2"
      shift 2
      ;;
    --client-id=*)
      AZURE_CLIENT_ID_VALUE="${1#*=}"
      shift
      ;;
    --authority-did)
      [[ $# -ge 2 ]] || die "--authority-did requires a value"
      VID_AUTHORITY_DID_VALUE="$2"
      shift 2
      ;;
    --authority-did=*)
      VID_AUTHORITY_DID_VALUE="${1#*=}"
      shift
      ;;
    --manifest-url)
      [[ $# -ge 2 ]] || die "--manifest-url requires a value"
      VID_MANIFEST_URL_VALUE="$2"
      shift 2
      ;;
    --manifest-url=*)
      VID_MANIFEST_URL_VALUE="${1#*=}"
      shift
      ;;
    --credential-type)
      [[ $# -ge 2 ]] || die "--credential-type requires a value"
      VID_CREDENTIAL_TYPE_VALUE="$2"
      shift 2
      ;;
    --credential-type=*)
      VID_CREDENTIAL_TYPE_VALUE="${1#*=}"
      shift
      ;;
    --resource-suffix)
      [[ $# -ge 2 ]] || die "--resource-suffix requires a value"
      RESOURCE_SUFFIX="$2"
      shift 2
      ;;
    --resource-suffix=*)
      RESOURCE_SUFFIX="${1#*=}"
      shift
      ;;
    --env|-e)
      [[ $# -ge 2 ]] || die "--env requires a value"
      TARGET_ENV="$2"
      shift 2
      ;;
    --env=*)
      TARGET_ENV="${1#*=}"
      shift
      ;;
    --location)
      [[ $# -ge 2 ]] || die "--location requires a value"
      AZURE_LOCATION="$2"
      shift 2
      ;;
    --location=*)
      AZURE_LOCATION="${1#*=}"
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

# shellcheck source=./env-loader.sh
source "$ROOT_DIR/scripts/env-loader.sh"

PROFILE="$(normalize_tenant_profile "$TENANT_ALIAS")"
PROFILE_LOWER="$(printf '%s\n' "$PROFILE" | tr '[:upper:]' '[:lower:]')"

if [[ -z "$RESOURCE_SUFFIX" ]]; then
  compact_subscription="$(printf '%s' "$SUBSCRIPTION_ID" | tr -d '-')"
  RESOURCE_SUFFIX="${compact_subscription: -6}"
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

set_profile_value() {
  local file="$1"
  local key="$2"
  local value="$3"

  set_env_value "$file" "TENANT_${PROFILE}_${key}" "$value"
}

set_profile_secret_if_missing() {
  local file="$1"
  local key="$2"
  local full_key="TENANT_${PROFILE}_${key}"

  if [[ -z "$(read_env_value "$file" "$full_key")" ]]; then
    set_env_value "$file" "$full_key" ""
  fi
}

root_env_file() {
  case "$1" in
    prod) printf '%s\n' "$ROOT_DIR/.env" ;;
    dev) printf '%s\n' "$ROOT_DIR/.env.dev" ;;
    qa) printf '%s\n' "$ROOT_DIR/.env.qa" ;;
    *) die "Unsupported env: $1" ;;
  esac
}

business_env_file() {
  case "$1" in
    prod) printf '%s\n' "$ROOT_DIR/examples/business-expenses/.env" ;;
    dev) printf '%s\n' "$ROOT_DIR/examples/business-expenses/.env.dev" ;;
    qa) printf '%s\n' "$ROOT_DIR/examples/business-expenses/.env.qa" ;;
    *) die "Unsupported env: $1" ;;
  esac
}

envs_to_update() {
  case "$TARGET_ENV" in
    all) printf '%s\n' prod dev qa ;;
    prod|production) printf '%s\n' prod ;;
    dev|development) printf '%s\n' dev ;;
    qa|test) printf '%s\n' qa ;;
    *) die "Unsupported --env value: $TARGET_ENV" ;;
  esac
}

env_segment() {
  local env_name="$1"
  if [[ "$env_name" == "prod" ]]; then
    printf '%s\n' ""
  else
    printf '%s\n' "-${env_name}"
  fi
}

env_data_segment() {
  local env_name="$1"
  if [[ "$env_name" == "prod" ]]; then
    printf '%s\n' "prod"
  else
    printf '%s\n' "$env_name"
  fi
}

for env_name in $(envs_to_update); do
  root_file="$(root_env_file "$env_name")"
  business_file="$(business_env_file "$env_name")"

  [[ -f "$root_file" ]] || die "Missing env file: $root_file"
  [[ -f "$business_file" ]] || die "Missing env file: $business_file"

  segment="$(env_segment "$env_name")"
  data_segment="$(env_data_segment "$env_name")"

  aegis_app_name="vanguard-aegis-id${segment}-${RESOURCE_SUFFIX}"
  business_app_name="vanguard-business-expenses${segment}-${RESOURCE_SUFFIX}"
  app_service_plan_name="${aegis_app_name}-plan"
  resource_group="rg-vanguard-aegis-id${segment}"
  aegis_base_url="https://${aegis_app_name}.azurewebsites.net"
  business_base_url="https://${business_app_name}.azurewebsites.net"
  client_name="Vanguard Cloud Services - Aegis ID"
  oidc_issuer="https://mock-idp.${env_name}.${PROFILE_LOWER}.local"
  if [[ "$env_name" == "prod" ]]; then
    oidc_issuer="https://mock-idp.${PROFILE_LOWER}.local"
  fi

  holder_name="vanguard-aegis-holder${segment}-${RESOURCE_SUFFIX}"
  issuer_name="vanguard-aegis-issuer${segment}-${RESOURCE_SUFFIX}"
  verifier_name="vanguard-aegis-verifier${segment}-${RESOURCE_SUFFIX}"
  mediator_name="vanguard-aegis-mediator${segment}-${RESOURCE_SUFFIX}"

  set_profile_value "$root_file" AZURE_TENANT_ID "$TENANT_ID"
  set_profile_value "$root_file" AZURE_SUBSCRIPTION_ID "$SUBSCRIPTION_ID"
  set_profile_value "$root_file" AZURE_RESOURCE_GROUP "$resource_group"
  set_profile_value "$root_file" AZURE_WEBAPP_NAME "$aegis_app_name"
  set_profile_value "$root_file" APP_SERVICE_PLAN_NAME "$app_service_plan_name"
  set_profile_value "$root_file" BUSINESS_APP_SERVICE_PLAN_NAME "$app_service_plan_name"
  set_profile_value "$root_file" APP_SERVICE_SKU_NAME "F1"
  set_profile_value "$root_file" APP_SERVICE_SKU_TIER "Free"
  set_profile_value "$root_file" AZURE_LOCATION "$AZURE_LOCATION"
  set_profile_value "$root_file" PUBLIC_BASE_URL "$aegis_base_url"
  set_profile_value "$root_file" APP_PUBLIC_BASE_URL "$aegis_base_url"
  set_profile_value "$root_file" BUSINESS_EXPENSES_APP_URL "$business_base_url"
  set_profile_value "$root_file" WEBSITE_NODE_DEFAULT_VERSION "~20"
  set_profile_value "$root_file" VID_MODE "live"
  set_profile_value "$root_file" VID_CLIENT_NAME "$client_name"
  set_profile_value "$root_file" AZURE_CLIENT_ID "$AZURE_CLIENT_ID_VALUE"
  set_profile_secret_if_missing "$root_file" AZURE_CLIENT_SECRET
  set_profile_value "$root_file" VID_AUTHORITY_DID "$VID_AUTHORITY_DID_VALUE"
  set_profile_value "$root_file" VID_MANIFEST_URL "$VID_MANIFEST_URL_VALUE"
  set_profile_value "$root_file" VID_CREDENTIAL_TYPE "$VID_CREDENTIAL_TYPE_VALUE"
  set_profile_secret_if_missing "$root_file" VID_CALLBACK_API_KEY
  set_profile_secret_if_missing "$root_file" SESSION_SECRET
  set_profile_value "$root_file" PASSKEY_RP_NAME "Vanguard Cloud Services - Aegis ID"
  set_profile_value "$root_file" PASSKEY_RP_ID "${aegis_app_name}.azurewebsites.net"
  set_profile_value "$root_file" PASSKEY_ORIGIN "$aegis_base_url"
  set_profile_value "$root_file" USER_STORE_PATH "/home/data/aegis-id/${PROFILE_LOWER}/${data_segment}/users.json"
  set_profile_value "$root_file" SUBSCRIPTION_STORE_PATH "/home/data/aegis-id/${PROFILE_LOWER}/${data_segment}/subscriptions.json"
  set_profile_value "$root_file" SUBSCRIBER_WORKSPACE_STORE_PATH "/home/data/aegis-id/${PROFILE_LOWER}/${data_segment}/subscriber-workspaces.json"
  set_profile_value "$root_file" TRANSACTION_STORE_PATH "/home/data/aegis-id/${PROFILE_LOWER}/${data_segment}/transactions.json"
  set_profile_value "$root_file" ISSUER_ORG_STORE_PATH "/home/data/aegis-id/${PROFILE_LOWER}/${data_segment}/issuer-organizations.json"
  set_profile_value "$root_file" ORG_ADMIN_STORE_PATH "/home/data/aegis-id/${PROFILE_LOWER}/${data_segment}/org-admin.json"
  set_profile_value "$root_file" ORG_ADMIN_EVENT_STORE_PATH "/home/data/aegis-id/${PROFILE_LOWER}/${data_segment}/org-admin-events.json"
  set_profile_value "$root_file" OIDC_WALLET_SESSION_STORE_PATH "/home/data/aegis-id/${PROFILE_LOWER}/${data_segment}/oidc-wallet-sessions.json"
  set_profile_value "$root_file" OIDC_CODE_STORE_PATH "/home/data/aegis-id/${PROFILE_LOWER}/${data_segment}/oidc-codes.json"
  set_profile_value "$root_file" WALLET_CHALLENGE_STORE_PATH "/home/data/aegis-id/${PROFILE_LOWER}/${data_segment}/wallet-challenges.json"
  set_profile_value "$root_file" WALLET_PASSKEY_STORE_PATH "/home/data/aegis-id/${PROFILE_LOWER}/${data_segment}/wallet-passkeys.json"
  set_profile_value "$root_file" AUDIT_STORE_PATH "/home/data/aegis-id/${PROFILE_LOWER}/${data_segment}/audit-events.json"
  set_profile_value "$root_file" OIDC_WALLET_DEMO_MODE "mock"
  set_profile_value "$root_file" OIDC_WALLET_ISSUER "$oidc_issuer"
  set_profile_value "$root_file" OIDC_WALLET_PUBLIC_BASE_URL "$aegis_base_url"
  set_profile_value "$root_file" OIDC_WALLET_AUTHORIZATION_ENDPOINT "/demo/oidc-wallet/mock-authorize"
  set_profile_value "$root_file" OIDC_WALLET_CLIENT_ID "vanguard-aegis-wallet-gated-app${segment}"
  set_profile_value "$root_file" OIDC_WALLET_SCOPE "openid profile email"
  set_profile_value "$root_file" OIDC_WALLET_SESSION_TTL_SECONDS "900"
  set_profile_value "$root_file" ARIES_HOLDER_NAME "$holder_name"
  set_profile_value "$root_file" ARIES_ISSUER_NAME "$issuer_name"
  set_profile_value "$root_file" ARIES_VERIFIER_NAME "$verifier_name"
  set_profile_value "$root_file" ARIES_MEDIATOR_NAME "$mediator_name"
  set_profile_value "$root_file" ARIES_HOLDER_ADMIN_URL "http://${holder_name}.${AZURE_LOCATION}.azurecontainer.io:6011"
  set_profile_value "$root_file" ARIES_ISSUER_ADMIN_URL "http://${issuer_name}.${AZURE_LOCATION}.azurecontainer.io:4011"
  set_profile_value "$root_file" ARIES_VERIFIER_ADMIN_URL "http://${verifier_name}.${AZURE_LOCATION}.azurecontainer.io:5011"
  set_profile_value "$root_file" ARIES_MEDIATOR_ADMIN_URL "http://${mediator_name}.${AZURE_LOCATION}.azurecontainer.io:3011"
  set_profile_secret_if_missing "$root_file" ARIES_ADMIN_API_KEY

  set_profile_value "$business_file" AZURE_TENANT_ID "$TENANT_ID"
  set_profile_value "$business_file" AZURE_SUBSCRIPTION_ID "$SUBSCRIPTION_ID"
  set_profile_value "$business_file" AZURE_RESOURCE_GROUP "$resource_group"
  set_profile_value "$business_file" AZURE_WEBAPP_NAME "$business_app_name"
  set_profile_value "$business_file" APP_SERVICE_PLAN_NAME "$app_service_plan_name"
  set_profile_value "$business_file" WEBSITE_NODE_DEFAULT_VERSION "~20"
  set_profile_value "$business_file" APP_PUBLIC_BASE_URL "$business_base_url"
  set_profile_value "$business_file" AEGIS_ID_BASE_URL "$aegis_base_url"
  set_profile_secret_if_missing "$business_file" SESSION_SECRET
  set_profile_value "$business_file" AEGIS_OIDC_AUTHORIZATION_ENDPOINT "/oidc/authorize"
  set_profile_value "$business_file" AEGIS_OIDC_TOKEN_ENDPOINT "/oidc/token"
  set_profile_value "$business_file" OIDC_CLIENT_ID "business-expenses-demo${segment}"
  set_profile_value "$business_file" OIDC_SCOPE "openid profile email"
  set_profile_value "$business_file" VERIFIED_ID_AUTH_ENABLED "true"
  set_profile_value "$business_file" YUBIKEY_AUTH_ENABLED "true"
  set_profile_value "$business_file" AEGIS_WALLET_PASSKEY_APPROVALS_REQUIRED "false"
  set_profile_secret_if_missing "$business_file" AEGIS_ORGANIZATION_ID
  set_profile_secret_if_missing "$business_file" AEGIS_ISSUER_CONNECTION_ID

  printf 'Updated %s tenant profile in %s and %s\n' "$PROFILE" "$root_file" "$business_file"
done

cat <<EOF

Tenant profile seeded.

Profile:          $PROFILE
Tenant ID:        $TENANT_ID
Subscription ID:  $SUBSCRIPTION_ID
Resource suffix:  $RESOURCE_SUFFIX

Use deploy/provision commands with:
  --tenant $TENANT_ALIAS

Secrets still to fill manually:
  TENANT_${PROFILE}_AZURE_CLIENT_SECRET
  TENANT_${PROFILE}_VID_CALLBACK_API_KEY
  TENANT_${PROFILE}_SESSION_SECRET
  TENANT_${PROFILE}_ARIES_ADMIN_API_KEY (optional; provisioner can generate it)
  TENANT_${PROFILE}_AEGIS_ORGANIZATION_ID in examples/business-expenses env files after org creation
EOF
