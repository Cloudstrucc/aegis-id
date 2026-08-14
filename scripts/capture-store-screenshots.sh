#!/usr/bin/env bash
# Turn simulator captures into the exact pixel sizes each store demands.
#
# The simulator is driven by hand rather than by this script — automating the
# whole wallet setup was more fragile than it was worth, and the screens worth
# showing change. What this does is the part that is mechanical and easy to get
# wrong.
#
#   1. Boot a 6.7" simulator (iPhone 16 Pro Max) and set the wallet up in it
#   2. Capture each screen you want:
#        xcrun simctl io booted screenshot artifacts/store-assets/raw/01-home.png
#   3. Run this
#
# ffmpeg rather than Python imaging: it is already required by the walkthrough
# video generator, and the system Python here has an architecture mismatch that
# breaks Pillow when npm invokes it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW="$ROOT/artifacts/store-assets/raw"
OUT="$ROOT/artifacts/store-assets"

command -v ffmpeg >/dev/null || { echo "ffmpeg not found (brew install ffmpeg)"; exit 1; }

shopt -s nullglob
captures=("$RAW"/*.png)
if [[ ${#captures[@]} -eq 0 ]]; then
  echo "No captures in artifacts/store-assets/raw/."
  echo "Boot a simulator, set the wallet up, then:"
  echo "  xcrun simctl io booted screenshot artifacts/store-assets/raw/01-home.png"
  exit 1
fi

# Apple wants the full frame, so scale to the target width and trim the few
# extra rows at the centre.
apple() {
  local folder="$1" width="$2" height="$3"
  mkdir -p "$OUT/$folder"
  for src in "${captures[@]}"; do
    ffmpeg -v error -y -i "$src" \
      -vf "scale=${width}:-1,crop=${width}:${height}" \
      "$OUT/$folder/$(basename "$src")"
  done
  echo "  $folder: ${#captures[@]} files"
}

# Play rejects anything taller than 9:16, and cropping to that ratio would cut
# the content out — so pad at the sides instead.
play() {
  local folder="$1" width="$2" height="$3"
  mkdir -p "$OUT/$folder"
  for src in "${captures[@]}"; do
    ffmpeg -v error -y -i "$src" \
      -vf "scale=-1:${height},pad=${width}:${height}:(ow-iw)/2:0:color=0x0D2A42" \
      "$OUT/$folder/$(basename "$src")"
  done
  echo "  $folder: ${#captures[@]} files"
}

echo "Writing store assets:"
apple "ios-6.7-1284x2778" 1284 2778
apple "ios-6.5-1242x2688" 1242 2688
play  "play-phone-1080x1920" 1080 1920

ICON="$ROOT/ios/VanguardAegisWallet/VanguardAegisWallet/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
if [[ -f "$ICON" ]]; then
  mkdir -p "$OUT/play-graphics"
  sips -Z 512 "$ICON" --out "$OUT/play-graphics/play-icon-512x512.png" >/dev/null
  echo "  play-graphics: icon 512x512"
fi

echo
echo "Ready in artifacts/store-assets/ — see docs/store-submission.md"
