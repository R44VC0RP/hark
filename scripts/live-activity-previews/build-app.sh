#!/bin/bash
# Build the Hark debug app for the iOS simulator without an Apple account.
#
# Usage: build-app.sh <derived-data-dir>
# Prints the path of the built Hark.app on the last line.
#
# The simulator runs ad-hoc ("-") signed apps with their entitlements, which
# the widget extension needs for the App Group it reads layouts from, so no
# team or provisioning profile is involved.
set -euo pipefail

DERIVED="${1:?usage: build-app.sh <derived-data-dir>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_DIR="$ROOT/apps/expo"

cd "$APP_DIR"
CI=1 pnpm exec expo prebuild -p ios --no-install >&2
(cd ios && pod install >&2)

xcodebuild \
  -workspace ios/Hark.xcworkspace \
  -scheme Hark \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination "generic/platform=iOS Simulator" \
  -derivedDataPath "$DERIVED" \
  CODE_SIGN_IDENTITY=- \
  CODE_SIGN_STYLE=Manual \
  DEVELOPMENT_TEAM= \
  PROVISIONING_PROFILE_SPECIFIER= \
  ARCHS=arm64 \
  COMPILER_INDEX_STORE_ENABLE=NO \
  build >&2

APP="$DERIVED/Build/Products/Debug-iphonesimulator/Hark.app"
test -d "$APP"
echo "$APP"
