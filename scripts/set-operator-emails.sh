#!/usr/bin/env bash
#
# Upsert PLATFORM_OPERATOR_EMAILS in an environment file.
#
# Usage:
#   bash scripts/set-operator-emails.sh a@x.com b@y.com            # adds to .env (prod)
#   bash scripts/set-operator-emails.sh --env dev a@x.com          # adds to .env.dev
#   bash scripts/set-operator-emails.sh --env all a@x.com          # every env file
#   bash scripts/set-operator-emails.sh --replace a@x.com          # set, don't merge
#   bash scripts/set-operator-emails.sh --remove b@y.com           # take one out
#   bash scripts/set-operator-emails.sh --list                     # show who is on it
#
# Adds by default rather than replacing, because the common mistake is pasting
# one address over a list and locking everybody else out of /admin — including
# whoever is running the command.
#
# Who is on this list decides who may reach platform administration: sign-in
# methods for the whole deployment, the mail and SMS transport, registration
# codes that grant a paid plan without payment, break-glass redemption, and the
# registers that list every wallet and delivered message on the installation.
# It is not a list of staff; it is a list of people who can see every
# customer's holders.
#
# `admin-access-service` lowercases before comparing, so this does too — one
# spelling, in the file and in the comparison.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="PLATFORM_OPERATOR_EMAILS"

TARGET_ENV="prod"
MODE="add"
EMAILS=()

die()  { printf '\n\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }
say()  { printf '\033[36m%s\033[0m\n' "$*"; }
ok()   { printf '\033[32m  %s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)      [[ $# -ge 2 ]] || die "--env needs a value"; TARGET_ENV="$2"; shift 2 ;;
    --env=*)    TARGET_ENV="${1#*=}"; shift ;;
    --replace)  MODE="replace"; shift ;;
    --remove)   MODE="remove"; shift ;;
    --list)     MODE="list"; shift ;;
    -h|--help)  sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)         die "Unknown option: $1" ;;
    *)          EMAILS+=("$1"); shift ;;
  esac
done

# Which files. `.env` is prod — see resolve_env_file in scripts/env-loader.sh.
case "$TARGET_ENV" in
  prod) FILES=("$ROOT_DIR/.env") ;;
  dev)  FILES=("$ROOT_DIR/.env.dev") ;;
  qa)   FILES=("$ROOT_DIR/.env.qa") ;;
  local) FILES=("$ROOT_DIR/.env.local") ;;
  all)  FILES=("$ROOT_DIR/.env" "$ROOT_DIR/.env.dev" "$ROOT_DIR/.env.qa") ;;
  *)    die "Unknown environment '$TARGET_ENV'. Use prod, dev, qa, local or all." ;;
esac

if [[ "$MODE" != "list" && ${#EMAILS[@]} -eq 0 ]]; then
  die "Give at least one address, or pass --list."
fi

# A plain sanity check, not validation: the point is to catch a typo'd flag or
# a shell-mangled argument landing in the list, not to adjudicate RFC 5322.
for email in ${EMAILS[@]+"${EMAILS[@]}"}; do
  [[ "$email" == *"@"*"."* ]] || die "That does not look like an address: $email"
done

for file in "${FILES[@]}"; do
  [[ -f "$file" ]] || { printf '\n'; say "$(basename "$file")"; note "does not exist — skipped"; continue; }

  printf '\n'
  say "$(basename "$file")"

  current="$(grep -E "^${KEY}=" "$file" | tail -1 | cut -d= -f2- || true)"

  # Merge, lowercase, de-duplicate, keep first-seen order. Order carries no
  # meaning to the service, but a list that reshuffles on every edit makes the
  # diff unreadable.
  merged="$(
    {
      if [[ "$MODE" != "replace" ]]; then printf '%s\n' "${current//,/$'\n'}"; fi
      if [[ "$MODE" != "remove" ]]; then printf '%s\n' ${EMAILS[@]+"${EMAILS[@]}"}; fi
    } | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]//g' | grep -v '^$' | awk '!seen[$0]++'
  )"

  if [[ "$MODE" == "remove" ]]; then
    for email in "${EMAILS[@]}"; do
      merged="$(printf '%s\n' "$merged" | grep -vxF "$(printf '%s' "$email" | tr '[:upper:]' '[:lower:]')" || true)"
    done
  fi

  value="$(printf '%s' "$merged" | paste -sd, -)"

  if [[ "$MODE" == "list" ]]; then
    if [[ -z "$current" ]]; then
      note "(not set — the deployment falls back to grandfathering the oldest administering subscriber)"
    else
      printf '%s\n' "${current//,/$'\n'}" | sed 's/^/  /'
    fi
    continue
  fi

  if [[ -z "$value" ]]; then
    die "That would leave the list empty. An empty list is not 'nobody' — it makes the deployment grandfather an account instead, which is probably not what you meant. Use --replace deliberately if it is."
  fi

  if grep -qE "^${KEY}=" "$file"; then
    # In place, preserving position and everything around it. A temp file
    # beside the target, because a half-written env file is a dead deployment.
    tmp="$file.tmp.$$"
    KEY="$KEY" VALUE="$value" python3 -I -c "
import io, os, sys
key, value = os.environ['KEY'], os.environ['VALUE']
src, dst = sys.argv[1], sys.argv[2]
out, replaced = [], False
for line in io.open(src, encoding='utf-8'):
    if line.startswith(key + '=') and not replaced:
        out.append(key + '=' + value + '\n')
        replaced = True
    elif line.startswith(key + '='):
        continue  # a duplicate key; the last one used to win, so drop the rest
    else:
        out.append(line)
io.open(dst, 'w', encoding='utf-8').write(''.join(out))
" "$file" "$tmp" || die "Could not rewrite $file"
    mv "$tmp" "$file"
    ok "updated"
  else
    printf '\n# Who may reach /admin. See scripts/set-operator-emails.sh.\n%s=%s\n' "$KEY" "$value" >> "$file"
    ok "added"
  fi

  printf '%s\n' "${value//,/$'\n'}" | sed 's/^/    /'
done

# --list changed nothing, so it has nothing to tell anybody to deploy.
if [[ "$MODE" == "list" ]]; then
  exit 0
fi

printf '\n'
cat <<'EOF'
These files are gitignored, so this changes nothing a deploy can see on its
own. Either redeploy, or push the setting on its own:

  az webapp config appsettings set \
    --name <app> --resource-group <group> \
    --settings PLATFORM_OPERATOR_EMAILS="<the value above>"

Setting it restarts the app, which takes a few seconds.
EOF
