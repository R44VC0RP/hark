#!/bin/bash
# Open a URL on the simulator and accept iOS's one-time 'Open in "Hark"?'
# prompt, which a fresh simulator shows before the first hark:// link.
#
# Usage: open-url.sh <device-udid> <url>
set -euo pipefail
DEVICE="$1"; URL="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"

xcrun simctl openurl "$DEVICE" "$URL"
"$HERE/tap-label.sh" "$DEVICE" "Open" 6 || true
