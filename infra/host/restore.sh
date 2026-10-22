#!/usr/bin/env bash
# Restore the Hark database from the Litestream replica in S3.
#   /opt/hark/restore.sh [--force] [litestream restore flags, e.g. -timestamp 2026-10-22T10:00:00Z]
# Refuses to replace an existing database unless --force is given; with --force
# the current files are moved aside (hark.sqlite*.pre-restore-<time>), not deleted.
# On a fresh host, just run deploy.sh: it restores automatically when the DB is missing.
set -euo pipefail

HARK_DIR=/opt/hark
cd "$HARK_DIR"
export HOME=${HOME:-/root}

force=false
if [[ "${1:-}" == "--force" ]]; then
  force=true
  shift
fi

if [[ ! -f "$HARK_DIR/compose.env" ]]; then
  echo "No $HARK_DIR/compose.env yet: run deploy.sh first (it restores a missing DB itself)." >&2
  exit 1
fi

compose() {
  docker compose --env-file "$HARK_DIR/compose.env" -f "$HARK_DIR/compose.yaml" "$@"
}

# hark.sqlite is not a stable copy while either process has it open.
echo "==> Stopping hark and litestream"
compose stop hark litestream
trap 'echo "==> Starting hark and litestream"; compose up -d hark litestream' EXIT

if compose run --rm --no-deps -T hark test -e /data/hark.sqlite </dev/null; then
  if [[ "$force" != true ]]; then
    echo "/data/hark.sqlite exists; re-run with --force to move it aside and restore." >&2
    exit 1
  fi
  echo "==> Moving the current database aside"
  # shellcheck disable=SC2016 # expanded by the container's shell
  compose run --rm --no-deps -T hark sh -c '
    set -eu
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    for f in hark.sqlite hark.sqlite-wal hark.sqlite-shm .hark.sqlite-litestream; do
      if [ -e "/data/$f" ]; then mv "/data/$f" "/data/$f.pre-restore-$stamp"; fi
    done
    echo "Moved aside with suffix .pre-restore-$stamp"
  ' </dev/null
fi

echo "==> Restoring from the replica"
compose run --rm --no-deps -T litestream \
  restore -config /etc/litestream.yml "$@" /data/hark.sqlite </dev/null
echo "==> Restored /data/hark.sqlite"
