#!/usr/bin/env bash
set -Eeuo pipefail

# Run the Vanguard Aegis ID Android wallet on an emulator, for one environment.
#
# Usage:
#   scripts/run-android.sh --env dev              # published dev build
#   scripts/run-android.sh --env qa
#   scripts/run-android.sh --env prod
#   scripts/run-android.sh --env local            # build from source, talks to your Mac
#   scripts/run-android.sh --env dev --build      # build from source instead of downloading
#   scripts/run-android.sh --env prod --fresh     # wipe app data first
#   scripts/run-android.sh --help
#
# It boots the emulator if nothing is running, installs the right build, and
# launches it. dev, qa and prod install side by side, so switching environments
# never means uninstalling.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT_DIR/android/VanguardAegisWallet"
SDK="${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
EMULATOR="$SDK/emulator/emulator"
AVD="${AEGIS_AVD:-Aegis_API35_arm64}"
BLOB_BASE="${AEGIS_APK_BASE_URL:-https://vanguardaegisdownloads.blob.core.windows.net/wallet}"

ENVIRONMENT=""
FROM_SOURCE=0
FRESH=0

die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

package_for() {
  case "$1" in
    local) echo "ca.vanguardcs.aegisid.wallet.local" ;;
    dev)   echo "ca.vanguardcs.aegisid.wallet.dev" ;;
    qa)    echo "ca.vanguardcs.aegisid.wallet.qa" ;;
    prod)  echo "ca.vanguardcs.aegisid.wallet" ;;
    *)     die "Unknown environment: $1 (expected local, dev, qa or prod)" ;;
  esac
}

flavour_for() {
  case "$1" in
    local) echo "Local" ;; dev) echo "Dev" ;; qa) echo "Qa" ;; prod) echo "Prod" ;;
  esac
}

# Each flavour registers its own URL scheme, so a deep link for one build never
# reaches another.
scheme_for() {
  case "$1" in
    local) echo "aegisid-local" ;; dev) echo "aegisid-dev" ;;
    qa) echo "aegisid-qa" ;; prod) echo "aegisid" ;;
  esac
}

usage() {
  cat <<'USAGE'
Run the Aegis ID Android wallet on an emulator.

Usage:
  scripts/run-android.sh --env dev|qa|prod|local

Options:
  --env, -e <local|dev|qa|prod>  Which build to run.
  --build                        Build from source instead of downloading the
                                 published APK. Implied for local.
  --fresh                        Clear the app's data first, so it starts at
                                 first-run setup.
  --avd <name>                   Emulator to use (default Aegis_API35_arm64).
  --help, -h                     This message.

dev, qa and prod install side by side — switching environments does not require
uninstalling. local is always built from source because it points at a
development server on this machine.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env|-e) [[ $# -ge 2 ]] || die "--env requires a value"; ENVIRONMENT="$2"; shift 2 ;;
    --env=*)  ENVIRONMENT="${1#*=}"; shift ;;
    --build)  FROM_SOURCE=1; shift ;;
    --fresh)  FRESH=1; shift ;;
    --avd)    [[ $# -ge 2 ]] || die "--avd requires a value"; AVD="$2"; shift 2 ;;
    --avd=*)  AVD="${1#*=}"; shift ;;
    --help|-h) usage; exit 0 ;;
    -*)       die "Unknown option: $1 (try --help)" ;;
    *)        ENVIRONMENT="$1"; shift ;;
  esac
done

[[ -n "$ENVIRONMENT" ]] || die "Specify an environment: --env dev|qa|prod|local (try --help)"
PACKAGE="$(package_for "$ENVIRONMENT")"
# The local flavour is compiled against a server on this machine, so there is
# never a published build of it to download.
[[ "$ENVIRONMENT" == "local" ]] && FROM_SOURCE=1

[[ -x "$ADB" ]] || die "adb not found at $ADB — set ANDROID_SDK_ROOT"

# --- emulator ---------------------------------------------------------------

if ! "$ADB" devices | grep -qE '\bdevice$'; then
  "$EMULATOR" -list-avds 2>/dev/null | grep -qx "$AVD" \
    || die "No AVD called '$AVD'. Available:
$("$EMULATOR" -list-avds 2>/dev/null | sed 's/^/  /')

  See android/AGENTS.md for how to create one — note the bundled avdmanager
  cannot, so it has to be written by hand."

  log "Booting $AVD"
  nohup "$EMULATOR" -avd "$AVD" -no-snapshot-load -no-audio >/dev/null 2>&1 &
  "$ADB" wait-for-device

  printf '  waiting for boot'
  for _ in $(seq 1 60); do
    [[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]] && break
    printf '.'
    sleep 5
  done
  printf '\n'
else
  log "Using the emulator already running"
fi

[[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]] \
  || die "The emulator did not finish booting."

# --- get an APK -------------------------------------------------------------

if [[ "$FROM_SOURCE" == "1" ]]; then
  flavour="$(flavour_for "$ENVIRONMENT")"
  # Without this the build gets versionCode 1 and Android refuses to install it
  # over a published build as a downgrade. Minutes since 2020, as the release
  # script uses, so a fresh source build is always newer.
  version_code=$(( ($(date +%s) - 1577836800) / 60 ))
  log "Building the $ENVIRONMENT flavour from source (versionCode $version_code)"
  (cd "$ANDROID_DIR" && ./gradlew ":app:assemble${flavour}Debug" -PaegisVersionCode="$version_code" -q)
  APK="$ANDROID_DIR/app/build/outputs/apk/$ENVIRONMENT/debug/app-$ENVIRONMENT-debug.apk"
  [[ -f "$APK" ]] || die "Gradle produced no APK at $APK"
else
  APK="$(mktemp -d)/aegis-$ENVIRONMENT.apk"
  url="$BLOB_BASE/aegis-id-wallet-$ENVIRONMENT.apk"
  log "Downloading the published $ENVIRONMENT build"
  status="$(curl -sS -o "$APK" -w '%{http_code}' "$url" || true)"
  [[ "$status" == "200" ]] || die "Could not download $url (HTTP $status)
  Publish it first with: scripts/release-android.sh --env $ENVIRONMENT --apk"
fi

# --- install ----------------------------------------------------------------

log "Installing $PACKAGE"
if ! install_output="$("$ADB" install -r "$APK" 2>&1)"; then
  if grep -qE "INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match" <<<"$install_output"; then
    # A debug-signed build cannot be replaced by a release-signed one, or the
    # other way round. Uninstalling loses the wallet on this device, so say so
    # rather than doing it silently.
    cat >&2 <<REINSTALL

ERROR: $PACKAGE is already installed with a different signing key.

  This happens when swapping between a locally built (debug-signed) build and a
  published (release-signed) one. Android will not update across signing keys.

  Uninstalling DELETES the wallet on this device — its Wallet ID and device key
  are gone, and getting back in needs a recovery code. If that is acceptable:

      $ADB uninstall $PACKAGE
      $0 --env $ENVIRONMENT${FROM_SOURCE:+ --build}

REINSTALL
    exit 1
  fi
  if grep -q "INSTALL_FAILED_VERSION_DOWNGRADE" <<<"$install_output"; then
    cat >&2 <<DOWNGRADE

ERROR: $PACKAGE already has a newer build installed.

  Android will not install an older versionCode over a newer one. Either bump
  the build, or remove the installed one first:

      $ADB uninstall $PACKAGE

  Uninstalling DELETES the wallet on this device.

DOWNGRADE
    exit 1
  fi

  printf '%s\n' "$install_output" >&2
  die "Install failed."
fi

if [[ "$FRESH" == "1" ]]; then
  log "Clearing app data — this wallet will start at first-run setup"
  "$ADB" shell pm clear "$PACKAGE" >/dev/null
fi

# --- launch -----------------------------------------------------------------

log "Launching $ENVIRONMENT"
"$ADB" shell am start -n "$PACKAGE/ca.vanguardcs.aegisid.wallet.MainActivity" >/dev/null

version="$("$ADB" shell dumpsys package "$PACKAGE" 2>/dev/null | grep -m1 versionName | tr -d '\r' | xargs || true)"
cat <<DONE

Running: $PACKAGE
$([ -n "$version" ] && echo "  $version")

  Deep links for this build use $(scheme_for "$ENVIRONMENT")://. Quote them for the
  DEVICE shell — an unquoted & is a background operator there and truncates the
  URL at the first parameter:

      $ADB shell "am start -a android.intent.action.VIEW -d '$(scheme_for "$ENVIRONMENT")://org-invite?invitation_id=…'"

DONE
