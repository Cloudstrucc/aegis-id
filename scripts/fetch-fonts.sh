#!/usr/bin/env bash
# Re-downloads the self-hosted brand typefaces into public/fonts/ and rewrites
# public/styles/fonts.css.
#
# Why self-hosted: the Content Security Policy in src/app.js allows styles and
# fonts from 'self' only. Admitting fonts.googleapis.com and fonts.gstatic.com
# would put a third party in the load path of every page of an identity
# product, to save 240 KB served from our own origin. Not worth it.
#
# Run this when a weight or a language subset changes. It needs network access,
# so it is a developer step, never part of a deploy.
set -Eeuo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 -I scripts/fetch-fonts.py
