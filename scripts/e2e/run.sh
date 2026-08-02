#!/usr/bin/env bash
set -Eeuo pipefail

# End-to-end journey test. Localhost only.
#
#   scripts/e2e/run.sh                   full journey, opens pages in your browser
#   scripts/e2e/run.sh --headless        no browser windows
#   scripts/e2e/run.sh --install-wallet  also build + install the wallet on the simulator
#   scripts/e2e/run.sh --isolated        run on 3210/4310 instead of 3000/4300
#   scripts/e2e/run.sh --keep            leave the servers running afterwards
#
# It starts both Node apps itself — you do not need to run `npm start` first.
# By default it claims ports 3000 and 4300, because the wallet's Local build is
# compiled against those; if they are busy it steps aside to 3210/4310 and says
# so, and the iOS leg skips. Nothing already running is ever killed.
#
# Every run uses its own data directory under artifacts/e2e/<timestamp>/, so it
# starts from nothing and never touches your working data.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

command -v node >/dev/null || { echo "ERROR: node is required" >&2; exit 2; }

if [[ ! -d node_modules ]]; then
  echo "Installing Aegis ID dependencies…"
  npm install --silent
fi

if [[ ! -d examples/business-expenses/node_modules ]]; then
  echo "Installing Business Expenses dependencies…"
  (cd examples/business-expenses && npm install --silent)
fi

if ! xcrun simctl list devices booted 2>/dev/null | grep -q "(Booted)"; then
  echo "NOTE: no booted iOS Simulator — the simulator step will be skipped."
  echo "      Boot one with: open -a Simulator"
  echo ""
fi

echo "Running the Aegis ID end-to-end journey…"
echo ""

node scripts/e2e/journey.js "$@"
status=$?

latest="$(ls -1dt artifacts/e2e/*/ 2>/dev/null | head -1 || true)"
if [[ -n "$latest" && "${*}" != *--headless* ]]; then
  open "${latest}report.html" 2>/dev/null || true
fi

exit $status
