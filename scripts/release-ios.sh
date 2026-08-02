#!/usr/bin/env bash
set -Eeuo pipefail

# Archive, export and (optionally) upload the Vanguard Aegis ID wallet to
# TestFlight for one or more environments.
#
# Usage:
#   scripts/release-ios.sh dev
#   scripts/release-ios.sh dev qa prod
#   scripts/release-ios.sh all
#   BUILD_NUMBER=7 scripts/release-ios.sh all          # pin the build number
#   SKIP_UPLOAD=1 scripts/release-ios.sh dev           # archive + export only
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

  local line key value
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
    [[ -n "${!key:-}" ]] && continue

    export "$key=$value"
  done < "$IOS_ENV_FILE"

  log "Loaded App Store Connect settings from ${IOS_ENV_FILE#$ROOT_DIR/}"
}

load_ios_env

# environment -> scheme | configuration
config_for() {
  case "$1" in
    dev)  echo "VanguardAegisWallet Dev|Release-Dev" ;;
    qa)   echo "VanguardAegisWallet QA|Release-QA" ;;
    prod) echo "VanguardAegisWallet|Release" ;;
    *)    die "Unknown environment: $1 (expected dev, qa, prod or all)" ;;
  esac
}

[[ $# -gt 0 ]] || die "Specify at least one environment: dev, qa, prod, or all"
ENVIRONMENTS=("$@")
[[ "${ENVIRONMENTS[0]}" == "all" ]] && ENVIRONMENTS=(dev qa prod)

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
