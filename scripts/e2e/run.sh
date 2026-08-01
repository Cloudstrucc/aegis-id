#!/usr/bin/env bash
set -Eeuo pipefail

# End-to-end journey test. Localhost only.
#
#   scripts/e2e/run.sh              full journey, opens pages in your browser
#   scripts/e2e/run.sh --headless   no browser windows
#   scripts/e2e/run.sh --keep       leave the servers running afterwards
#
# Every run uses its own data directory under artifacts/e2e/<timestamp>/, so it
# starts from nothing and never touches your working data.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

command -v node >/dev/null || { echo "ERROR: node is required" >&2; exit 2; }

if [[ ! -d node_modules ]]; then
  echo "ERROR: run 'npm install' first" >&2
  exit 2
fi

if [[ ! -d examples/business-expenses/node_modules ]]; then
  echo "NOTE: Business Expenses has no node_modules — its steps will be skipped."
  echo "      Install them with: (cd examples/business-expenses && npm install)"
  echo ""
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
