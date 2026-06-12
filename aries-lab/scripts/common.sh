#!/usr/bin/env bash
set -euo pipefail

json_header=(-H "Content-Type: application/json")

post_json() {
  local url="$1"
  local payload="$2"
  curl -sS -X POST "$url" "${json_header[@]}" -d "$payload"
}
