#!/bin/bash
# Create and boot an iPhone 17 Pro simulator, install the Hark dev build and
# start the serve-sim helper for it. Prints the device UDID on the last line.
#
# Usage: setup-sim.sh <Hark.app>
set -euo pipefail

APP="${1:?usage: setup-sim.sh <Hark.app>}"
NAME="${LA_DEVICE_NAME:-Live Activity Previews}"
TYPE="com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro"
RUNTIME="$(xcrun simctl list runtimes -j | python3 -c '
import json, sys
ios = [r for r in json.load(sys.stdin)["runtimes"] if r["platform"] == "iOS" and r["isAvailable"]]
print(sorted(ios, key=lambda r: [int(p) for p in r["version"].split(".")])[-1]["identifier"])')"

UDID="$(xcrun simctl create "$NAME" "$TYPE" "$RUNTIME")"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >&2
xcrun simctl install "$UDID" "$APP"

# Skip expo-dev-client's first-launch menu tour, which would cover the lab.
xcrun simctl spawn "$UDID" defaults write ceo.ryan.hark EXDevMenuIsOnboardingFinished -bool YES

serve-sim --detach --quiet "$UDID" >&2
echo "$UDID"
