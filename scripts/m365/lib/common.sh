# shellcheck shell=bash
# Shared by the bash scripts in scripts/m365/. Sourced, never run.
#
# Reads one environment's dotenv file and works out the Microsoft 365 names every step uses, so
# the PowerShell steps (lib/M365Env.ps1, same rules) and the bash steps agree on them. Change a
# rule here and change it there.
#
# The folder is meant to be copied into other projects. When it sits next to the repo's
# scripts/env-loader.sh it uses that loader (the env file beats the shell, a key set twice stops
# the script); in a project without one it falls back to the small copy below with the same rules.

M365_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$M365_DIR/../.." && pwd)"

if [[ -f "$M365_DIR/../env-loader.sh" ]]; then
  # shellcheck source=../../env-loader.sh
  source "$M365_DIR/../env-loader.sh"
fi

# Each helper is defined only when the host repo's loader did not already provide it, so this
# folder drops into a project whose env-loader.sh carries some of them, all of them, or none.
if ! declare -F log >/dev/null; then
  log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
fi
if ! declare -F warn >/dev/null; then
  warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
fi
if ! declare -F die >/dev/null; then
  die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
fi
if ! declare -F require_cmd >/dev/null; then
  require_cmd() { local c; for c in "$@"; do command -v "$c" >/dev/null 2>&1 || die "$c is required"; done; }
fi
if ! declare -F resolve_env_file >/dev/null; then
  resolve_env_file() {
    case "$2" in
      prod|production) echo "$1/.env" ;;
      local|localhost) echo "$1/.env.local" ;;
      dev|development) echo "$1/.env.dev" ;;
      qa|test)         echo "$1/.env.qa" ;;
      *)               echo "$2" ;;
    esac
  }
fi
if ! declare -F load_env_file >/dev/null; then
  load_env_file() {
    local file="$1" line key value seen=" "
    [[ -f "$file" ]] || { echo "env file not found: $file" >&2; return 1; }
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%%$'\r'}"
      [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
      line="${line#export }"
      key="${line%%=*}"; key="${key//[[:space:]]/}"; value="${line#*=}"
      [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
      [[ "$seen" == *" $key "* ]] && { echo "error: $key is set twice in $file" >&2; return 1; }
      seen+="$key "
      if [[ "$value" =~ ^\"(.*)\"$ ]] || [[ "$value" =~ ^\'(.*)\'$ ]]; then value="${BASH_REMATCH[1]}"; fi
      export "$key=$value"
    done < "$file"
  }
fi

# Lowercased address inside "Name <addr>" or a bare address; empty when there is none.
address_of() { local s="$1"; [[ "$s" == *"<"*">"* ]] && { s="${s#*<}"; s="${s%%>*}"; }; s="${s// /}"; printf '%s' "$s" | tr '[:upper:]' '[:lower:]'; }
domain_of()  { local a; a="$(address_of "$1")"; [[ "$a" == *@* ]] && printf '%s' "${a#*@}"; }

# m365_load <env-name-or-path>
# Loads the env file, then sets (and exports) the derived names:
#   M365_ENV_NAME M365_ENV_FILE M365_DOMAIN M365_APP_SLUG M365_DISPLAY_NAME M365_APP_NAME
#   GRAPH_SENDER EMAIL_HELP M365_SENDER_GROUP M365_MAILBOX_OWNERS
# and stops with a sentence when something required is missing or contradicts itself.
m365_load() {
  local name="$1"
  [[ -n "$name" ]] || die "--env is required (local, dev, qa, prod, or a path to an env file)"
  M365_ENV_FILE="$(resolve_env_file "$ROOT" "$name")"
  case "$name" in
    prod|production) M365_ENV_NAME=prod ;;
    dev|development) M365_ENV_NAME=dev ;;
    qa|test)         M365_ENV_NAME=qa ;;
    local|localhost) M365_ENV_NAME=local ;;
    *)               M365_ENV_NAME="" ;;
  esac
  load_env_file "$M365_ENV_FILE" || die "could not read $M365_ENV_FILE"

  M365_DOMAIN="$(printf '%s' "${M365_DOMAIN:-$(domain_of "${GRAPH_SENDER:-}")}" | tr '[:upper:]' '[:lower:]')"
  [[ -n "$M365_DOMAIN" ]] || die "set M365_DOMAIN (e.g. vanguardcs.ca or cloudstrucc.com) in $M365_ENV_FILE"
  [[ -n "${M365_APP_SLUG:-}" ]] || die "set M365_APP_SLUG in $M365_ENV_FILE: a short lowercase name for this app (e.g. aegis). It keeps this app's mailboxes and group apart from other apps on the same tenant."
  [[ "$M365_APP_SLUG" =~ ^[a-z0-9][a-z0-9-]*$ ]] || die "M365_APP_SLUG must be lowercase letters, digits and hyphens"

  local from_name=""
  [[ "${EMAIL_FROM:-}" == *"<"* ]] && { from_name="${EMAIL_FROM%%<*}"; from_name="${from_name%"${from_name##*[![:space:]]}"}"; }
  M365_DISPLAY_NAME="${M365_DISPLAY_NAME:-${from_name:-$M365_APP_SLUG}}"
  M365_APP_NAME="${M365_APP_NAME:-$M365_DISPLAY_NAME Mailer}"

  # One mailbox per environment, so a test run on dev never mails people from the address they
  # know as the real one. prod gets <slug>-noreply@, every other environment <slug>-<env>-noreply@.
  if [[ -z "${GRAPH_SENDER:-}" ]]; then
    [[ -n "$M365_ENV_NAME" ]] || die "set GRAPH_SENDER in $M365_ENV_FILE (no default for an env file given by path)"
    if [[ "$M365_ENV_NAME" == prod ]]; then GRAPH_SENDER="$M365_APP_SLUG-noreply@$M365_DOMAIN"
    else GRAPH_SENDER="$M365_APP_SLUG-$M365_ENV_NAME-noreply@$M365_DOMAIN"; fi
  fi
  GRAPH_SENDER="$(address_of "$GRAPH_SENDER")"
  EMAIL_HELP="$(address_of "${EMAIL_HELP:-}")"
  M365_SENDER_GROUP="$(address_of "${M365_SENDER_GROUP:-$M365_APP_SLUG-mail-senders@$M365_DOMAIN}")"
  M365_MAILBOX_OWNERS="${M365_MAILBOX_OWNERS:-${M365_ADMIN_UPN:-}}"

  local a
  for a in "$GRAPH_SENDER" "$EMAIL_HELP" "$M365_SENDER_GROUP"; do
    [[ -z "$a" || "$(domain_of "$a")" == "$M365_DOMAIN" ]] || die "$a is not on M365_DOMAIN ($M365_DOMAIN). Every address these scripts create lives on that one domain."
  done
  if [[ -n "${EMAIL_FROM:-}" && "$(address_of "$EMAIL_FROM")" != "$GRAPH_SENDER" ]]; then
    die "EMAIL_FROM's address ($(address_of "$EMAIL_FROM")) must be GRAPH_SENDER ($GRAPH_SENDER): Graph refuses a From it is not sending as"
  fi
  export M365_ENV_NAME M365_ENV_FILE M365_DOMAIN M365_APP_SLUG M365_DISPLAY_NAME M365_APP_NAME \
    GRAPH_SENDER EMAIL_HELP M365_SENDER_GROUP M365_MAILBOX_OWNERS
}

m365_print_plan() {
  log "Environment file: $M365_ENV_FILE"
  printf '    domain            %s\n' "$M365_DOMAIN"
  printf '    app registration  %s\n' "$M365_APP_NAME"
  printf '    sends as          %s  (GRAPH_SENDER)\n' "$GRAPH_SENDER"
  printf '    help inbox        %s\n' "${EMAIL_HELP:-(none: EMAIL_HELP is not set)}"
  printf '    scope group       %s\n' "$M365_SENDER_GROUP"
  printf '    mailbox owners    %s\n' "${M365_MAILBOX_OWNERS:-(none: set M365_MAILBOX_OWNERS or M365_ADMIN_UPN)}"
}

# set_env_value <file> <KEY>  (value read from the environment variable M365_NEW_VALUE)
# Replaces KEY=... in place, or appends it. The value never goes on a command line, where other
# processes can read it, and is never printed. Refuses a file git would commit.
set_env_value() {
  local file="$1" key="$2"
  if git -C "$(dirname "$file")" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    && ! git -C "$(dirname "$file")" check-ignore -q "$file"; then
    die "$file is not gitignored; refusing to write a secret into it"
  fi
  M365_KEY="$key" M365_FILE="$file" python3 -I -c '
import os, re
path, key, value = os.environ["M365_FILE"], os.environ["M365_KEY"], os.environ["M365_NEW_VALUE"]
lines = open(path).read().splitlines()
pat = re.compile(r"^\s*(export\s+)?" + re.escape(key) + r"\s*=")
out, done = [], False
for line in lines:
    if pat.match(line):
        if not done: out.append(f"{key}={value}"); done = True
        continue
    out.append(line)
if not done: out.append(f"{key}={value}")
open(path, "w").write("\n".join(out) + "\n")
'
}
