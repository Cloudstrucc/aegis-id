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
