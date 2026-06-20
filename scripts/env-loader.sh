# Shared dotenv loader for deploy scripts.
# External shell variables take precedence over values in the selected env file.

resolve_env_file() {
  local base_dir="$1"
  local env_name="${2:-prod}"
  local explicit_file="${3:-}"

  if [[ -n "$explicit_file" ]]; then
    printf '%s\n' "$explicit_file"
    return 0
  fi

  case "$env_name" in
    prod|production)
      printf '%s\n' "$base_dir/.env"
      ;;
    local|localhost)
      printf '%s\n' "$base_dir/.env.local"
      ;;
    dev|development)
      printf '%s\n' "$base_dir/.env.dev"
      ;;
    qa|test)
      printf '%s\n' "$base_dir/.env.qa"
      ;;
    *)
      printf '%s\n' "$env_name"
      ;;
  esac
}

load_env_file() {
  local env_file="$1"

  [[ -f "$env_file" ]] || return 1

  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    raw_line="${raw_line%$'\r'}"

    [[ -z "${raw_line//[[:space:]]/}" ]] && continue
    [[ "$raw_line" =~ ^[[:space:]]*# ]] && continue

    if [[ "$raw_line" == export\ * ]]; then
      raw_line="${raw_line#export }"
    fi

    [[ "$raw_line" == *=* ]] || continue

    local key="${raw_line%%=*}"
    local value="${raw_line#*=}"
    key="${key//[[:space:]]/}"

    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue

    if [[ "$value" == \"*\" && "$value" == *\" && ${#value} -ge 2 ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' && ${#value} -ge 2 ]]; then
      value="${value:1:${#value}-2}"
    fi

    if [[ -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done < "$env_file"
}

normalize_tenant_profile() {
  local raw="$1"

  printf '%s\n' "$raw" \
    | tr '[:lower:]' '[:upper:]' \
    | sed -E 's/[^A-Z0-9]+/_/g; s/^_+//; s/_+$//; s/_+/_/g'
}

resolve_tenant_profile() {
  local requested="$1"
  local normalized direct_var var profile

  [[ -n "$requested" ]] || return 1

  normalized="$(normalize_tenant_profile "$requested")"
  direct_var="TENANT_${normalized}_AZURE_TENANT_ID"

  if [[ -n "${!direct_var+x}" ]]; then
    printf '%s\n' "$normalized"
    return 0
  fi

  for var in $(compgen -v | grep -E '^TENANT_[A-Z0-9_]+_AZURE_TENANT_ID$' || true); do
    if [[ "${!var}" == "$requested" ]]; then
      profile="${var#TENANT_}"
      profile="${profile%_AZURE_TENANT_ID}"
      printf '%s\n' "$profile"
      return 0
    fi
  done

  return 1
}

apply_tenant_profile() {
  local requested="$1"
  shift || true

  [[ -n "$requested" ]] || return 0

  local profile
  if ! profile="$(resolve_tenant_profile "$requested")"; then
    printf 'ERROR: Tenant profile not found for "%s". Add TENANT_<ALIAS>_AZURE_TENANT_ID to the selected env file.\n' "$requested" >&2
    return 1
  fi

  export TENANT_PROFILE="$profile"

  local key profile_key
  for key in "$@"; do
    profile_key="TENANT_${profile}_${key}"
    if [[ -n "${!profile_key+x}" ]]; then
      export "$key=${!profile_key}"
    fi
  done
}
