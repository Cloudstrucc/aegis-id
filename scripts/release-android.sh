#!/usr/bin/env bash
set -Eeuo pipefail

# Build and sign the Vanguard Aegis ID Android wallet for one or more
# environments. Flags mirror scripts/release-ios.sh and the Azure deploy
# scripts, so --env means the same thing everywhere in this repo.
#
# Usage:
#   scripts/release-android.sh --env dev
#   scripts/release-android.sh --env dev --env qa
#   scripts/release-android.sh --env all
#   scripts/release-android.sh dev qa prod              # positional also works
#   scripts/release-android.sh --env all --apk          # APKs as well as bundles
#   scripts/release-android.sh --env dev --debug        # unsigned debug build
#   scripts/release-android.sh --help
#
# Signing credentials come from .env.android at the repo root, which is
# untracked — copy .env.android.example to get started. Values already exported
# in the shell win, so CI can supply them as secrets without a file.
#
# This script does NOT upload. It produces signed artifacts and tells you where
# they are; publishing to Play is a deliberate, manual step.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android/VanguardAegisWallet"
OUTPUT_DIR="$ROOT_DIR/artifacts/android"
ANDROID_ENV_FILE="${ANDROID_ENV_FILE:-$ROOT_DIR/.env.android}"
BUILD_DEBUG="${BUILD_DEBUG:-0}"
BUILD_APK="${BUILD_APK:-0}"

die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

# environment -> gradle flavour name (capitalised for task names)
flavour_for() {
  case "$1" in
    local) echo "Local" ;;
    dev)   echo "Dev" ;;
    qa)    echo "Qa" ;;
    prod)  echo "Prod" ;;
    *)     die "Unknown environment: $1 (expected local, dev, qa, prod or all)" ;;
  esac
}

# Load signing credentials from the untracked env file. Values already in the
# environment win, so an export or a CI secret is never overwritten.
load_android_env() {
  [[ -f "$ANDROID_ENV_FILE" ]] || return 0

  local line key value loaded="" overridden=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%$'\r'}"
    [[ -z "${line// }" || "$line" == \#* ]] && continue
    line="${line#export }"
    [[ "$line" == *=* ]] || continue

    key="${line%%=*}"
    value="${line#*=}"
    key="${key//[[:space:]]/}"
    value="${value#\"}"; value="${value%\"}"
    value="${value#\'}"; value="${value%\'}"

    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ -n "${!key:-}" ]]; then
      overridden="$overridden $key"
      continue
    fi
    export "$key=$value"
    loaded="$loaded $key"
  done < "$ANDROID_ENV_FILE"

  [[ -n "$loaded" ]] && log "Loaded from ${ANDROID_ENV_FILE#$ROOT_DIR/}:$loaded"
  [[ -n "$overridden" ]] && log "Taken from the environment, not the file:$overridden"
  return 0
}

# Fail before a build rather than after one that turns out unsigned.
check_signing() {
  [[ "$BUILD_DEBUG" == "1" ]] && return 0

  local missing=()
  [[ -n "${AEGIS_KEYSTORE_PATH:-}" ]] || missing+=(AEGIS_KEYSTORE_PATH)
  [[ -n "${AEGIS_KEYSTORE_PASSWORD:-}" ]] || missing+=(AEGIS_KEYSTORE_PASSWORD)
  [[ -n "${AEGIS_KEY_ALIAS:-}" ]] || missing+=(AEGIS_KEY_ALIAS)

  if [[ ${#missing[@]} -gt 0 ]]; then
    die "Missing signing credentials: ${missing[*]}
  Copy .env.android.example to .env.android and fill it in, or run with --debug
  for an unsigned build."
  fi

  [[ -f "$AEGIS_KEYSTORE_PATH" ]] || die "No keystore at $AEGIS_KEYSTORE_PATH
  A lost release keystore cannot be replaced — the app can never be updated on
  Play under the same package name. Keep it backed up somewhere durable."
}

usage() {
  cat <<'USAGE'
Build and sign the Vanguard Aegis ID Android wallet.

Usage:
  scripts/release-android.sh --env dev
  scripts/release-android.sh --env dev --env qa
  scripts/release-android.sh --env all
  scripts/release-android.sh dev qa prod          # positional form also works

Options:
  --env, -e <local|dev|qa|prod|all>  Environment to build. Repeatable.
  --env=<value>                      Same, in equals form.
  --version-code <n>                 Pin the versionCode (default: minutes since 2020).
  --version-name <v>                 Pin the versionName.
  --apk                              Also build an APK alongside the bundle.
  --debug                            Unsigned debug build; needs no credentials.
  --env-file <path>                  Signing credentials file.
  --help, -h                         This message.

Artifacts land in artifacts/android/. Nothing is uploaded — publishing to Play
is a deliberate, manual step.
USAGE
}

ENVIRONMENTS=()

add_environment() {
  local value="$1"
  if [[ "$value" == "all" ]]; then
    # Deliberately not "local": that flavour points at a development server on
    # the host machine and is never something you release.
    ENVIRONMENTS+=(dev qa prod)
    return
  fi
  flavour_for "$value" >/dev/null
  ENVIRONMENTS+=("$value")
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env|-e)
      [[ $# -ge 2 ]] || die "--env requires a value"
      add_environment "$2"; shift 2 ;;
    --env=*)
      add_environment "${1#*=}"; shift ;;
    --version-code)
      [[ $# -ge 2 ]] || die "--version-code requires a value"
      VERSION_CODE="$2"; shift 2 ;;
    --version-code=*)
      VERSION_CODE="${1#*=}"; shift ;;
    --version-name)
      [[ $# -ge 2 ]] || die "--version-name requires a value"
      VERSION_NAME="$2"; shift 2 ;;
    --version-name=*)
      VERSION_NAME="${1#*=}"; shift ;;
    --apk)
      BUILD_APK=1; shift ;;
    --debug)
      BUILD_DEBUG=1; shift ;;
    --env-file)
      [[ $# -ge 2 ]] || die "--env-file requires a path"
      ANDROID_ENV_FILE="$2"; shift 2 ;;
    --env-file=*)
      ANDROID_ENV_FILE="${1#*=}"; shift ;;
    --help|-h)
      usage; exit 0 ;;
    -*)
      die "Unknown option: $1 (try --help)" ;;
    *)
      add_environment "$1"; shift ;;
  esac
done

[[ ${#ENVIRONMENTS[@]} -gt 0 ]] || die "Specify at least one environment: --env dev|qa|prod|all (try --help)"

# Written the long way because macOS ships bash 3.2, which has no mapfile.
DEDUPED=()
for candidate in "${ENVIRONMENTS[@]}"; do
  already=0
  for seen in ${DEDUPED[@]+"${DEDUPED[@]}"}; do
    [[ "$seen" == "$candidate" ]] && already=1 && break
  done
  [[ $already -eq 0 ]] && DEDUPED+=("$candidate")
done
ENVIRONMENTS=("${DEDUPED[@]}")

load_android_env
check_signing

command -v java >/dev/null || die "java not found — Gradle needs a JDK 17"
[[ -x "$ANDROID_DIR/gradlew" ]] || die "No Gradle wrapper at $ANDROID_DIR/gradlew"

# Play caps versionCode at 2100000000, so the YYYYMMDDHHMM stamp iOS uses for
# CFBundleVersion does not fit. Minutes since 2020-01-01 is monotonic, about
# 3.4 million today, and good for centuries.
VERSION_CODE="${VERSION_CODE:-$(( ($(date +%s) - 1577836800) / 60 ))}"
VERSION_NAME="${VERSION_NAME:-}"

log "Version code: $VERSION_CODE${VERSION_NAME:+  version name: $VERSION_NAME}"
log "Environments: ${ENVIRONMENTS[*]}"

BUILD_TYPE="Release"
[[ "$BUILD_DEBUG" == "1" ]] && BUILD_TYPE="Debug"

mkdir -p "$OUTPUT_DIR"
cd "$ANDROID_DIR"

gradle_args=(-PaegisVersionCode="$VERSION_CODE")
[[ -n "$VERSION_NAME" ]] && gradle_args+=(-PaegisVersionName="$VERSION_NAME")

for env in "${ENVIRONMENTS[@]}"; do
  flavour="$(flavour_for "$env")"
  log "═══ $env — flavour '$flavour', build type '$BUILD_TYPE' ═══"

  tasks=("bundle${flavour}${BUILD_TYPE}")
  [[ "$BUILD_APK" == "1" || "$BUILD_DEBUG" == "1" ]] && tasks+=("assemble${flavour}${BUILD_TYPE}")

  # Anything older than this did not come out of the build below.
  started_at="$(date +%s)"

  ./gradlew "${tasks[@]}" "${gradle_args[@]}"

  lower_type="$(echo "$BUILD_TYPE" | tr '[:upper:]' '[:lower:]')"

  outputs=("app/build/outputs/bundle/${env}${BUILD_TYPE}/app-${env}-${lower_type}.aab")
  # Only when the APK was actually asked for. Gradle leaves the previous one in
  # place otherwise, and copying it stamped it with the new versionCode — an
  # artifact whose filename claimed to be today's build and whose contents were
  # weeks old. Play only takes the .aab, so this went unnoticed; the sideload
  # page on /downloads/android serves the .apk, and it was serving the stale one.
  if [[ "$BUILD_APK" == "1" || "$BUILD_DEBUG" == "1" ]]; then
    outputs+=("app/build/outputs/apk/${env}/${lower_type}/app-${env}-${lower_type}.apk")
  fi

  for artifact in "${outputs[@]}"; do
    if [[ ! -f "$artifact" ]]; then
      die "Expected build output is missing: $artifact"
    fi

    # Belt and braces: a task that was UP-TO-DATE against a stale input would
    # still leave a file here, and shipping the wrong binary is worse than
    # failing the release.
    modified_at="$(stat -f %m "$artifact" 2>/dev/null || stat -c %Y "$artifact")"
    if (( modified_at < started_at )); then
      die "$artifact was not produced by this run (last modified before the build started). Try: ./gradlew clean"
    fi

    target="$OUTPUT_DIR/$(basename "${artifact%.*}")-$VERSION_CODE.${artifact##*.}"
    cp "$artifact" "$target"
    log "Built: ${target#$ROOT_DIR/}"
  done
done

log "Done. Environments: ${ENVIRONMENTS[*]} (versionCode $VERSION_CODE)"
if [[ "$BUILD_DEBUG" != "1" ]]; then
  cat <<NEXT

Nothing has been uploaded. To publish, open Play Console, pick the app for this
environment, and upload the .aab from artifacts/android/.
NEXT
fi
