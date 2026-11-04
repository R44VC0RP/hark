#!/bin/bash
# Capture one Live Activity style on the booted iPhone 17 Pro simulator as a
# stacked 1206x1222 PNG: Lock Screen, minimized island, expanded island.
#
# Usage: capture.sh <device-udid> <style> <out.png>
#   LA_QUERY  extra la-lab URL parameters, e.g. 'progress=none&privacy=private'
#   PYTHON    interpreter with Pillow (default: python3)
#
# Assumes the Hark dev build is running against Metro and the serve-sim helper
# streams this device. Frames come from serve-sim's stream, not
# `simctl io screenshot`, which can render malformed wireframes.
set -euo pipefail

DEVICE="$1"; STYLE="$2"; OUT="$3"
HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PYTHON:-python3}"
RAW="$(mktemp -d "${TMPDIR:-/tmp}/la-capture.XXXXXX")"
ISLAND_X=0.5
ISLAND_Y=0.032
TOUCH_DOWN=0

STREAM_URL="$(serve-sim --list "$DEVICE" | plutil -extract streamUrl raw -o - -)"
shot() { "$PY" "$HERE/frame.py" grab "$STREAM_URL" "$RAW/$1.png"; }
locked() { serve-sim state -d "$DEVICE" 2>/dev/null | grep -q '"locked":true'; }
release_touch() {
  if [ "$TOUCH_DOWN" -eq 1 ]; then
    serve-sim gesture -d "$DEVICE" "{\"type\":\"end\",\"x\":$ISLAND_X,\"y\":$ISLAND_Y}" >/dev/null || true
    TOUCH_DOWN=0
  fi
}
cleanup() { release_touch; rm -rf "$RAW"; }
trap cleanup EXIT INT TERM

# Start or update the activity. The lab clears delivered notifications first
# so they don't push the activity out of the Lock Screen crop.
serve-sim button -d "$DEVICE" home >/dev/null; sleep 0.5
"$HERE/open-url.sh" "$DEVICE" "hark://la-lab?style=$STYLE&ts=$(date +%s)${LA_QUERY:+&$LA_QUERY}"
sleep 3

# 1. Lock Screen. `button lock` is a no-op on iOS 27 simulators; power works.
serve-sim button -d "$DEVICE" home >/dev/null; sleep 0.3
serve-sim tap -d "$DEVICE" 0.1 0.04 >/dev/null; sleep 1.2 # collapse an already-expanded island
serve-sim button -d "$DEVICE" power >/dev/null; sleep 1.0
for _ in 1 2 3; do
  locked && break
  serve-sim button -d "$DEVICE" power >/dev/null; sleep 1.0
done
serve-sim button -d "$DEVICE" power >/dev/null; sleep 1.3 # wake to the Lock Screen
# The first activity on a fresh simulator asks "Allow Live Activities from
# Hark?" on the Lock Screen, covering the banner. Allow it, then lock and
# wake again for a clean frame.
if "$HERE/tap-label.sh" "$DEVICE" "Allow" 2; then
  sleep 1
  serve-sim button -d "$DEVICE" power >/dev/null; sleep 1.0
  serve-sim button -d "$DEVICE" power >/dev/null; sleep 1.3
fi
shot lockscreen

# 2. Home Screen with the minimized island.
serve-sim button -d "$DEVICE" home >/dev/null; sleep 2.0
shot island-min

# 3. Expanded island while a press is held for two seconds.
TOUCH_DOWN=1
serve-sim gesture -d "$DEVICE" "{\"type\":\"begin\",\"x\":$ISLAND_X,\"y\":$ISLAND_Y}" >/dev/null
sleep 2.0
shot island-expanded
release_touch

mkdir -p "$(dirname "$OUT")"
"$PY" "$HERE/frame.py" stack "$RAW/lockscreen.png" "$RAW/island-min.png" "$RAW/island-expanded.png" "$OUT"

serve-sim tap -d "$DEVICE" 0.1 0.04 >/dev/null
serve-sim button -d "$DEVICE" home >/dev/null
