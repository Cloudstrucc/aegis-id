#!/usr/bin/env bash
#
# Deploy dev, then qa, then prod, in one command.
#
# Usage:
#   bash scripts/deploy-all.sh                          # dev -> qa -> prod, default tenant
#   bash scripts/deploy-all.sh --tenant vanguardcs      # the same chain, other tenant
#   bash scripts/deploy-all.sh --tenants default,vanguardcs
#   bash scripts/deploy-all.sh --envs dev,qa            # stop before prod
#   bash scripts/deploy-all.sh --dry-run                # print the plan, deploy nothing
#
#   --yes            skip the production confirmation (for an unattended run)
#   --skip-health    deploy without waiting for each site to answer afterwards
#   --allow-dirty    passed through to the per-environment script
#
# Why this exists, and why it is not just three commands in a row:
#
#   1. **A successful deploy does not mean a working site.** On 11 Nov a prod
#      deploy reported "Build successful" while the container was exiting with
#      `Cannot find module 'express'` and the site served 503 for twenty
#      minutes. Nothing in the per-environment script noticed, because its job
#      ends when Azure accepts the package. So every stage here ends with a
#      real HTTP request to the real hostname, and the chain stops if it does
#      not come back 200.
#
#   2. **A wedged deployment blocks the retry.** When an Oryx build hangs, the
#      next deploy is refused with "Another deployment is in progress" — which
#      is how one stuck build cost three attempts that day. The preflight below
#      asks Azure whether anything is in flight before packaging anything, and
#      says what to do about it rather than failing opaquely twenty minutes in.
#
#   3. **Production is the one that needs a person.** It asks, every time,
#      unless --yes is passed. Everything before it runs unattended.
#
# The chain stops at the first failure and tells you exactly where it stopped
# and what was already deployed, because a half-finished chain is worse than a
# failed one if you cannot tell which half.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/env-loader.sh
source "$ROOT_DIR/scripts/env-loader.sh"

ENVS_RAW="dev,qa,prod"
TENANTS_RAW="default"
ASSUME_YES=0
SKIP_HEALTH=0
DRY_RUN=0
ALLOW_DIRTY_FLAG=()

HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-10}"

die() { printf '\n\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }
say() { printf '\033[36m%s\033[0m\n' "$*"; }
ok()  { printf '\033[32m  %s\033[0m\n' "$*"; }
warn(){ printf '\033[33m  %s\033[0m\n' "$*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --envs)    [[ $# -ge 2 ]] || die "--envs requires a value";    ENVS_RAW="$2";    shift 2 ;;
    --envs=*)  ENVS_RAW="${1#*=}"; shift ;;
    --tenant|--tenants)
               [[ $# -ge 2 ]] || die "--tenant requires a value";  TENANTS_RAW="$2"; shift 2 ;;
    --tenant=*|--tenants=*) TENANTS_RAW="${1#*=}"; shift ;;
    --yes|-y)         ASSUME_YES=1; shift ;;
    --skip-health)    SKIP_HEALTH=1; shift ;;
    --dry-run)        DRY_RUN=1; shift ;;
    --allow-dirty)    ALLOW_DIRTY_FLAG=(--allow-dirty); shift ;;
    -h|--help)        sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)                die "Unknown argument: $1" ;;
  esac
done

IFS=',' read -r -a ENVS <<< "$ENVS_RAW"
IFS=',' read -r -a TENANTS <<< "$TENANTS_RAW"

for env_name in "${ENVS[@]}"; do
  case "$env_name" in
    dev|qa|prod) ;;
    *) die "Refusing to deploy to '$env_name'. This script covers dev, qa and prod." ;;
  esac
done

# ---------------------------------------------------------------------------
# What each stage targets
# ---------------------------------------------------------------------------

# Reads the environment file the way the deploy script will, so the hostname
# probed afterwards is the hostname that was actually deployed to, rather than
# one duplicated here that can drift.
resolve_target() {
  local env_name="$1" tenant="$2"
  local env_file; env_file="$(resolve_env_file "$ROOT_DIR" "$env_name" "")"
  [[ -f "$env_file" ]] || { printf '\n'; return 1; }

  (
    set +u
    load_env_file "$env_file" >/dev/null 2>&1
    if [[ "$tenant" != "default" ]]; then
      apply_tenant_profile "$tenant" APP_PUBLIC_BASE_URL AZURE_WEBAPP_NAME AZURE_RESOURCE_GROUP \
        >/dev/null 2>&1
    fi
    printf '%s\t%s\t%s\n' "${APP_PUBLIC_BASE_URL:-}" "${AZURE_WEBAPP_NAME:-}" "${AZURE_RESOURCE_GROUP:-}"
  )
}

# ---------------------------------------------------------------------------
# Preflight: is anything already in flight on this App Service?
# ---------------------------------------------------------------------------
#
# Kudu status codes: 0 Pending, 1 Building, 2 Deploying, 3 Failed, 4 Success.
# Anything in 0-2 means the next push is refused, so finding out now costs a
# second and finding out later costs a full test run and a package.
preflight_deployment_lock() {
  local webapp="$1" group="$2"
  [[ -n "$webapp" && -n "$group" ]] || return 0
  command -v az >/dev/null 2>&1 || return 0

  local in_flight
  in_flight="$(az webapp deployment list \
      --name "$webapp" --resource-group "$group" \
      --query "length([?properties.status==\`0\`||properties.status==\`1\`||properties.status==\`2\`])" \
      -o tsv 2>/dev/null)" || return 0

  [[ "$in_flight" =~ ^[0-9]+$ ]] || return 0
  (( in_flight == 0 )) && return 0

  printf '\n\033[31mA deployment is already in progress on %s (%s in flight).\033[0m\n' "$webapp" "$in_flight" >&2
  cat >&2 <<EOF

  Azure will refuse this one. If it is genuinely running, wait for it. If it is
  wedged — a build that has sat at "Building" for more than ten minutes — stop
  and start the app to clear the lock, then run this again:

    az webapp stop  --name $webapp --resource-group $group
    az webapp start --name $webapp --resource-group $group

EOF
  return 1
}

# ---------------------------------------------------------------------------
# Health: does the site actually answer?
# ---------------------------------------------------------------------------
#
# The point of the whole script. A cold start on a plan without Always On can
# take 40 seconds, so this polls rather than asking once, and it asks for the
# root page rather than a health endpoint, because the health endpoint is
# authenticated and a 401 proves nothing about whether a page renders.
wait_until_serving() {
  local url="$1" label="$2"
  [[ -n "$url" ]] || { warn "No APP_PUBLIC_BASE_URL for $label — cannot check it answers"; return 0; }

  local deadline=$(( SECONDS + HEALTH_TIMEOUT ))
  local code=""
  printf '  waiting for %s ' "$url"
  while (( SECONDS < deadline )); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 45 "$url/" 2>/dev/null)"
    if [[ "$code" == "200" ]]; then
      printf ' \033[32m200\033[0m\n'
      return 0
    fi
    printf '.'
    sleep "$HEALTH_INTERVAL"
  done

  printf ' \033[31m%s\033[0m\n' "${code:-no answer}"
  return 1
}

# ---------------------------------------------------------------------------
# The plan
# ---------------------------------------------------------------------------

say ""
say "Deployment chain"
printf '  environments : %s\n' "${ENVS[*]}"
printf '  tenants      : %s\n' "${TENANTS[*]}"
printf '  health check : %s\n' "$([[ $SKIP_HEALTH == 1 ]] && echo 'skipped' || echo "up to ${HEALTH_TIMEOUT}s per stage")"

STAGES=()
for tenant in "${TENANTS[@]}"; do
  for env_name in "${ENVS[@]}"; do
    STAGES+=("$env_name|$tenant")
  done
done

printf '\n  order:\n'
stage_number=0
for stage in "${STAGES[@]}"; do
  stage_number=$(( stage_number + 1 ))
  env_name="${stage%%|*}"; tenant="${stage##*|}"
  IFS=$'\t' read -r base_url webapp _group <<< "$(resolve_target "$env_name" "$tenant")"
  printf '    %d. %-5s %-12s %s\n' "$stage_number" "$env_name" "$tenant" "${base_url:-<no base url>}"
done
printf '\n'

if (( DRY_RUN == 1 )); then
  ok "--dry-run: nothing was deployed"
  exit 0
fi

# ---------------------------------------------------------------------------
# Run it
# ---------------------------------------------------------------------------

DONE=()
started_at=$SECONDS

for stage in "${STAGES[@]}"; do
  env_name="${stage%%|*}"
  tenant="${stage##*|}"
  label="$env_name/$tenant"

  IFS=$'\t' read -r base_url webapp group <<< "$(resolve_target "$env_name" "$tenant")"

  # Production asks. Every time, and for each tenant separately — they are
  # different live sites and agreeing to one is not agreeing to the other.
  if [[ "$env_name" == "prod" && $ASSUME_YES -eq 0 ]]; then
    printf '\n\033[33m================================================================\033[0m\n'
    printf '\033[33m  PRODUCTION: %s\033[0m\n' "${base_url:-$webapp}"
    printf '\033[33m================================================================\033[0m\n'
    printf '  Type \033[1myes\033[0m to deploy, anything else to stop here: '
    read -r reply
    if [[ "$reply" != "yes" ]]; then
      printf '\n'
      warn "Stopped before production at your request."
      [[ ${#DONE[@]} -gt 0 ]] && printf '  Already deployed: %s\n' "${DONE[*]}"
      exit 0
    fi
  fi

  say ""
  say "================================================================"
  say "  $label  ->  ${base_url:-unknown}"
  say "================================================================"

  if ! preflight_deployment_lock "$webapp" "$group"; then
    printf '\n'
    die "Stopped at $label: a deployment is already in flight. Nothing was packaged.$(
      [[ ${#DONE[@]} -gt 0 ]] && printf '\n  Already deployed: %s' "${DONE[*]}")"
  fi

  tenant_flag=()
  [[ "$tenant" != "default" ]] && tenant_flag=(--tenant "$tenant")

  if ! bash "$ROOT_DIR/scripts/deploy-azure-webapp.sh" \
        --env "$env_name" "${tenant_flag[@]}" "${ALLOW_DIRTY_FLAG[@]}"; then
    printf '\n'
    die "$label failed. The output above is the whole of it — nothing after this stage ran.$(
      [[ ${#DONE[@]} -gt 0 ]] && printf '\n  Already deployed: %s' "${DONE[*]}")"
  fi

  if (( SKIP_HEALTH == 0 )); then
    if ! wait_until_serving "$base_url" "$label"; then
      printf '\n'
      cat >&2 <<EOF
  \033[31m$label deployed but the site is not answering.\033[0m

  Azure accepted the package; the container did not come up. The usual cause is
  a build that finished half-done, which leaves the source in place with no
  node_modules:

    az webapp log download --name $webapp --resource-group $group --log-file /tmp/$webapp.zip

  Look in LogFiles/StartupLogs for the container's own last words.

EOF
      die "Stopped at $label.$(
        [[ ${#DONE[@]} -gt 0 ]] && printf '\n  Already deployed: %s' "${DONE[*]}")"
    fi
  fi

  ok "$label is deployed and serving"
  DONE+=("$label")
done

elapsed=$(( SECONDS - started_at ))
printf '\n'
ok "All ${#DONE[@]} stages deployed and serving in $(( elapsed / 60 ))m $(( elapsed % 60 ))s:"
for entry in "${DONE[@]}"; do
  printf '    %s\n' "$entry"
done
printf '\n'
