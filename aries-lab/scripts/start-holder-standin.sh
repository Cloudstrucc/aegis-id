#!/usr/bin/env bash
set -euo pipefail

MAC_IP="${MAC_IP:-$(ipconfig getifaddr en0)}"
HOLDER_NAME="${HOLDER_NAME:-cloudstrucc-aegis-holder}"
HOLDER_WALLET_NAME="${HOLDER_WALLET_NAME:-holder-wallet}"
HOLDER_WALLET_KEY="${HOLDER_WALLET_KEY:-change-me-holder}"
ACAPY_IMAGE="${ACAPY_IMAGE:-ghcr.io/openwallet-foundation/acapy-agent:1.6}"

if [[ -z "$MAC_IP" ]]; then
  echo "Unable to determine Mac LAN IP. Set MAC_IP explicitly, for example: MAC_IP=10.0.0.240 $0" >&2
  exit 1
fi

docker rm -f "$HOLDER_NAME" >/dev/null 2>&1 || true
docker run -d --name "$HOLDER_NAME" \
  -p 6010:6010 -p 6011:6011 \
  "$ACAPY_IMAGE" \
  start \
  --label "Cloudstrucc iOS Holder Stand-in" \
  --inbound-transport http 0.0.0.0 6010 \
  --outbound-transport http \
  --admin 0.0.0.0 6011 \
  --admin-insecure-mode \
  --endpoint "http://$MAC_IP:6010" \
  --no-ledger \
  --wallet-type askar \
  --wallet-name "$HOLDER_WALLET_NAME" \
  --wallet-key "$HOLDER_WALLET_KEY" \
  --auto-provision \
  --auto-accept-invites \
  --auto-accept-requests \
  --auto-ping-connection
