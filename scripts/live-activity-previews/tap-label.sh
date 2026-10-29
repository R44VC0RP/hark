#!/bin/bash
# Tap the first button with this accessibility label, if one is on screen.
# Exits 0 after tapping, 1 when no such button appeared.
#
# Usage: tap-label.sh <device-udid> <label> [tries]   (tries are 0.5s apart)
set -euo pipefail
DEVICE="$1"; LABEL="$2"; TRIES="${3:-6}"

for _ in $(seq 1 "$TRIES"); do
  point="$(serve-sim ax -d "$DEVICE" 2>/dev/null | LABEL="$LABEL" python3 -c '
import json, os, sys
try:
    tree = json.load(sys.stdin)
except ValueError:
    sys.exit()
screen = tree["screen"]
for e in tree.get("elements", []):
    if e.get("type") == "Button" and e.get("label") == os.environ["LABEL"]:
        f = e["frame"]
        print("%.4f %.4f" % ((f["x"] + f["width"] / 2) / screen["width"], (f["y"] + f["height"] / 2) / screen["height"]))
        break')"
  if [ -n "$point" ]; then
    # shellcheck disable=SC2086
    serve-sim tap -d "$DEVICE" $point >/dev/null
    exit 0
  fi
  sleep 0.5
done
exit 1
