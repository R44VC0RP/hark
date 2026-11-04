#!/bin/bash
# Capture each style twice: "before" on the base commit's widget code and
# "after" on the checked-out code, with the same native build.
#
# Usage: run.sh <device-udid> <base-sha> <out-dir> <style>...
# Writes <out-dir>/<style>-before.png, <style>-after.png and manifest.json.
#
# The layouts are JavaScript served by Metro, so swapping the widget sources
# and restarting Metro switches between before and after without a rebuild.
# If the change also touches native code, "before" runs on the new native
# build too.
set -euo pipefail

DEVICE="$1"; BASE_REF="$2"; OUT="$3"; shift 3
STYLES=("$@")
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BASE="$(git -C "$ROOT" rev-parse --verify "$BASE_REF^{commit}")"
SOURCES=(apps/expo/src/widgets packages/contracts/src)
PORT="${LA_METRO_PORT:-8081}"
METRO_PID=""
mkdir -p "$OUT"

stop_metro() {
  if [ -n "$METRO_PID" ]; then
    kill "$METRO_PID" 2>/dev/null || true
    wait "$METRO_PID" 2>/dev/null || true
    METRO_PID=""
  fi
}
restore_head() { (cd "$ROOT" && git restore --source=HEAD --worktree -- "${SOURCES[@]}"); }
trap 'stop_metro; restore_head' EXIT

app_running() {
  xcrun simctl spawn "$DEVICE" launchctl list 2>/dev/null | grep -q "UIKitApplication:ceo.ryan.hark\["
}

start_app() {
  local log="$OUT/metro-$1.log"
  (cd "$ROOT/apps/expo" && CI=1 exec pnpm exec expo start --dev-client --offline --port "$PORT" >"$log" 2>&1) &
  METRO_PID=$!
  for _ in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:$PORT/status" 2>/dev/null | grep -q running && break
    sleep 1
  done
  # The debug build occasionally crashes during launch (seen in
  # expo-notifications and ExpoFabricView), before it requests the bundle, so
  # relaunch a few times. A cold Metro cache takes a while on CI.
  for attempt in 1 2 3 4 5; do
    xcrun simctl terminate "$DEVICE" ceo.ryan.hark 2>/dev/null || true
    "$HERE/open-url.sh" "$DEVICE" "hark://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A$PORT"
    for second in $(seq 1 120); do
      grep -q "Bundled" "$log" && break
      # A crashed launch leaves no app process; retry without waiting it out.
      if [ "$second" -gt 5 ] && ! app_running; then break; fi
      sleep 1
    done
    grep -q "Bundled" "$log" && break
    echo "launch attempt $attempt got no bundle; relaunching" >&2
  done
  grep -q "Bundled" "$log" || { echo "Metro never served a bundle (see $log)" >&2; exit 1; }
  sleep 5
}

in_base() { git -C "$ROOT" cat-file -e "$BASE:apps/expo/src/widgets/live-activities/$1.tsx" 2>/dev/null; }

# Before: the base commit's widget code and contracts.
(cd "$ROOT" && git restore --source="$BASE" --worktree -- "${SOURCES[@]}")
start_app before
for style in "${STYLES[@]}"; do
  if in_base "$style"; then
    echo "before: $style" >&2
    "$HERE/capture.sh" "$DEVICE" "$style" "$OUT/$style-before.png"
  else
    echo "before: $style is new, skipped" >&2
  fi
done
stop_metro

# After: the checked-out code.
restore_head
start_app after
for style in "${STYLES[@]}"; do
  echo "after: $style" >&2
  "$HERE/capture.sh" "$DEVICE" "$style" "$OUT/$style-after.png"
done
stop_metro

# shellcheck disable=SC2016 # JavaScript, not shell
node -e '
const [base, head, out, ...styles] = process.argv.slice(1);
const fs = require("fs");
const entries = styles.map((style) => ({
  style,
  before: fs.existsSync(`${out}/${style}-before.png`),
  after: fs.existsSync(`${out}/${style}-after.png`),
}));
fs.writeFileSync(`${out}/manifest.json`, JSON.stringify({ base, head, styles: entries }, null, 2));
' "$BASE" "$(git -C "$ROOT" rev-parse HEAD)" "$OUT" "${STYLES[@]}"
