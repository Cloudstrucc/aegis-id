#!/usr/bin/env bash
set -Eeuo pipefail

# Archive, export and (optionally) upload the Vanguard Aegis ID wallet to
# TestFlight for one or more environments.
#
# Usage (--env mirrors the Azure deploy scripts; bare names still work):
#   scripts/release-ios.sh --env dev
#   scripts/release-ios.sh --env dev --env qa
#   scripts/release-ios.sh --env all
#   scripts/release-ios.sh dev qa prod
#   scripts/release-ios.sh --env all --build-number 7   # pin the build number
#   scripts/release-ios.sh --env dev --skip-upload      # archive + export only
#   scripts/release-ios.sh --help
#
# BUILD_NUMBER and SKIP_UPLOAD still work as environment variables.
#
# Uploading needs App Store Connect API credentials:
#   ASC_KEY_ID, ASC_ISSUER_ID   and  ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8
#
# Those two come from .env.ios at the repo root, which is untracked — copy
# .env.ios.example to get started. Anything already exported in the shell wins,
# so CI can set them without a file. Point IOS_ENV_FILE elsewhere to override.
#
# The key is per Apple team, not per environment: dev, qa and prod all sign for
# the same team and upload to the same App Store Connect account, which is why
# there is one file rather than one per environment.
#
# Without credentials the script archives and exports, then tells you what to do
# next, so nothing here ever handles your signing key.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios/VanguardAegisWallet"
PROJECT="$IOS_DIR/VanguardAegisWallet.xcodeproj"
BUILD_DIR="$IOS_DIR/build"
SKIP_UPLOAD="${SKIP_UPLOAD:-0}"
IOS_ENV_FILE="${IOS_ENV_FILE:-$ROOT_DIR/.env.ios}"

die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

# Load App Store Connect credentials from the untracked env file. Values already
# in the environment win, so an export or a CI secret is never overwritten.
load_ios_env() {
  [[ -f "$IOS_ENV_FILE" ]] || return 0

  local line key value loaded="" overridden=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%$'\r'}"
    [[ -z "${line// }" || "$line" == \#* ]] && continue
    line="${line#export }"
    [[ "$line" == *=* ]] || continue

    key="${line%%=*}"
    value="${line#*=}"
    key="${key//[[:space:]]/}"
    # Tolerate quoted values, which is how most people write these.
    value="${value#\"}"; value="${value%\"}"
    value="${value#\'}"; value="${value%\'}"

    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ -n "${!key:-}" ]]; then
      # Deliberate, so CI secrets win. Named so a stale export is obvious
      # rather than silently shadowing the file.
      overridden="$overridden $key"
      continue
    fi

    export "$key=$value"
    loaded="$loaded $key"
  done < "$IOS_ENV_FILE"

  [[ -n "$loaded" ]] && log "Loaded from ${IOS_ENV_FILE#$ROOT_DIR/}:$loaded"
  [[ -n "$overridden" ]] && log "Taken from the environment, not the file:$overridden"
  return 0
}

# altool's failure for a malformed key id is a confusing "file not found" naming
# a path nobody wrote, so check the shape here and say what is actually wrong.
check_asc_credentials() {
  [[ -n "${ASC_KEY_ID:-}" && -n "${ASC_ISSUER_ID:-}" ]] || return 0

  local source_hint="the environment (unset it, or fix ${IOS_ENV_FILE#$ROOT_DIR/})"

  if [[ ! "$ASC_KEY_ID" =~ ^[A-Za-z0-9]{8,12}$ ]]; then
    die "ASC_KEY_ID is '$ASC_KEY_ID', which is not a Key ID.
  A Key ID is ~10 letters and digits, e.g. RS7734NF97.
  This value came from $source_hint"
  fi

  if [[ ! "$ASC_ISSUER_ID" =~ ^[0-9a-fA-F-]{36}$ ]]; then
    die "ASC_ISSUER_ID is '$ASC_ISSUER_ID', which is not an Issuer ID.
  An Issuer ID is a 36-character UUID.
  This value came from $source_hint"
  fi

  # Fail before a ten-minute archive rather than at the upload that follows it.
  local key_file="$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8"
  [[ -f "$key_file" ]] || die "No private key at $key_file
  Download the .p8 from App Store Connect and put it there, or run with --skip-upload."
}

# environment -> scheme | configuration
config_for() {
  case "$1" in
    dev)  echo "VanguardAegisWallet Dev|Release-Dev" ;;
    qa)   echo "VanguardAegisWallet QA|Release-QA" ;;
    prod) echo "VanguardAegisWallet|Release" ;;
    *)    die "Unknown environment: $1 (expected dev, qa, prod or all)" ;;
  esac
}

# Flags mirror the Azure deploy scripts, so --env means the same thing across
# every release script in the repo. Bare environment names still work, because
# that is what the existing runbooks and muscle memory use.
ENVIRONMENTS=()

add_environment() {
  local value="$1"
  if [[ "$value" == "all" ]]; then
    ENVIRONMENTS+=(dev qa prod)
    return
  fi
  # Validate here rather than at archive time, so a typo fails before a
  # ten-minute build rather than after one.
  config_for "$value" >/dev/null
  ENVIRONMENTS+=("$value")
}

usage() {
  cat <<'USAGE'
Archive, export and upload the Vanguard Aegis ID wallet.

Usage:
  scripts/release-ios.sh --env dev
  scripts/release-ios.sh --env dev --env qa
  scripts/release-ios.sh --env all
  scripts/release-ios.sh dev qa prod          # positional form still works
  scripts/release-ios.sh all

Options:
  --env, -e <dev|qa|prod|all>   Environment to release. Repeatable.
  --env=<value>                 Same, in equals form.
  --build-number <n>            Pin the build number instead of a timestamp.
  --skip-upload                 Archive and export only, no upload.
  --env-file <path>             App Store Connect credentials file.
  --help, -h                    This message.

Credentials come from .env.ios at the repository root (see .env.ios.example).
Values already exported in the shell take precedence.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env|-e)
      [[ $# -ge 2 ]] || die "--env requires a value"
      add_environment "$2"
      shift 2
      ;;
    --env=*)
      add_environment "${1#*=}"
      shift
      ;;
    --build-number)
      [[ $# -ge 2 ]] || die "--build-number requires a value"
      BUILD_NUMBER="$2"
      shift 2
      ;;
    --build-number=*)
      BUILD_NUMBER="${1#*=}"
      shift
      ;;
    --skip-upload)
      SKIP_UPLOAD=1
      shift
      ;;
    --env-file)
      [[ $# -ge 2 ]] || die "--env-file requires a path"
      IOS_ENV_FILE="$2"
      shift 2
      ;;
    --env-file=*)
      IOS_ENV_FILE="${1#*=}"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    -*)
      die "Unknown option: $1 (try --help)"
      ;;
    *)
      add_environment "$1"
      shift
      ;;
  esac
done

[[ ${#ENVIRONMENTS[@]} -gt 0 ]] || die "Specify at least one environment: --env dev|qa|prod|all (try --help)"

# --env dev --env all, or a repeated name, should not build anything twice.
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

# After parsing, so --env-file can choose the file.
load_ios_env

# Before any archiving, so a bad credential costs a second rather than a build.
[[ "$SKIP_UPLOAD" == "1" ]] || check_asc_credentials

command -v xcodebuild >/dev/null || die "xcodebuild not found"

# A shared, monotonically increasing build number keeps TestFlight happy across
# all three bundle identifiers.
BUILD_NUMBER="${BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"
log "Build number: $BUILD_NUMBER"

for env in "${ENVIRONMENTS[@]}"; do
  IFS='|' read -r scheme configuration <<< "$(config_for "$env")"
  archive="$BUILD_DIR/$env.xcarchive"
  export_dir="$BUILD_DIR/$env-export"
  options="$BUILD_DIR/$env-ExportOptions.plist"

  log "═══ $env — scheme '$scheme', configuration '$configuration' ═══"

  mkdir -p "$BUILD_DIR"
  rm -rf "$archive" "$export_dir"

  log "Archiving $env"
  xcodebuild -project "$PROJECT" \
    -scheme "$scheme" \
    -configuration "$configuration" \
    -destination 'generic/platform=iOS' \
    -archivePath "$archive" \
    CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
    clean archive

  # App Store export options. Signing stays automatic so Xcode manages profiles.
  cat > "$options" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>export</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST

  log "Exporting $env"
  xcodebuild -exportArchive \
    -archivePath "$archive" \
    -exportPath "$export_dir" \
    -exportOptionsPlist "$options" \
    -allowProvisioningUpdates

  ipa="$(find "$export_dir" -name '*.ipa' | head -1)"
  [[ -n "$ipa" ]] || die "No .ipa produced for $env"
  log "Exported: $ipa"

  if [[ "$SKIP_UPLOAD" == "1" ]]; then
    log "SKIP_UPLOAD=1 — not uploading $env"
    continue
  fi

  if [[ -z "${ASC_KEY_ID:-}" || -z "${ASC_ISSUER_ID:-}" ]]; then
    log "ASC_KEY_ID / ASC_ISSUER_ID not set — skipping upload for $env."
    log "Upload it yourself with:"
    printf '  xcrun altool --upload-app -f "%s" -t ios --apiKey <KEY_ID> --apiIssuer <ISSUER_ID>\n' "$ipa"
    continue
  fi

  log "Uploading $env to App Store Connect"
  xcrun altool --upload-app -f "$ipa" -t ios \
    --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
  log "Uploaded $env (build $BUILD_NUMBER)"
done

log "Done. Environments: ${ENVIRONMENTS[*]} (build $BUILD_NUMBER)"
