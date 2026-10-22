#!/usr/bin/env bash
# Restore the Hark database from the Litestream replica in S3.
#   /opt/hark/restore.sh [--force] [litestream restore flags, e.g. -timestamp 2026-10-22T10:00:00Z]
# Refuses to replace an existing database unless --force is given; with --force
# the current files are moved aside (hark.sqlite*.pre-restore-<time>), not deleted.
# The restore is integrity-checked; if it fails, the moved files are put back and
# hark and litestream stay stopped (nothing starts on a missing database).
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
# Until the restore has succeeded, leaving the services stopped is the safe
# failure: nothing can start on a missing or half-restored database.
trap 'echo "Restore did not complete; hark and litestream are left stopped." >&2' EXIT

stamp=
if compose run --rm --no-deps -T hark test -e /data/hark.sqlite </dev/null; then
  if [[ "$force" != true ]]; then
    echo "/data/hark.sqlite exists; re-run with --force to move it aside and restore." >&2
    trap - EXIT
    echo "==> Starting hark and litestream"
    compose up -d hark litestream
    exit 1
  fi
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  echo "==> Moving the current database aside (suffix .pre-restore-$stamp)"
  # shellcheck disable=SC2016 # expanded by the container's shell
  compose run --rm --no-deps -T -e "STAMP=$stamp" hark sh -c '
    set -eu
    for f in hark.sqlite hark.sqlite-wal hark.sqlite-shm .hark.sqlite-litestream; do
      if [ -e "/data/$f" ]; then mv "/data/$f" "/data/$f.pre-restore-$STAMP"; fi
    done
  ' </dev/null
fi

echo "==> Restoring from the replica"
failed=$(date -u +%Y%m%dT%H%M%SZ)
if ! compose run --rm --no-deps -T litestream \
  restore -config /etc/litestream.yml -integrity-check quick "$@" /data/hark.sqlite </dev/null; then
  echo "Restore failed; moving its output aside (suffix .failed-restore-$failed)." >&2
  # shellcheck disable=SC2016 # expanded by the container's shell
  compose run --rm --no-deps -T -e "STAMP=$stamp" -e "FAILED=$failed" hark sh -c '
    set -eu
    for f in hark.sqlite hark.sqlite-wal hark.sqlite-shm .hark.sqlite-litestream; do
      if [ -e "/data/$f" ]; then mv "/data/$f" "/data/$f.failed-restore-$FAILED"; fi
      if [ -n "$STAMP" ] && [ -e "/data/$f.pre-restore-$STAMP" ]; then
        mv "/data/$f.pre-restore-$STAMP" "/data/$f"
      fi
    done
  ' </dev/null
  if [[ -n "$stamp" ]]; then
    echo "The previous database is back in place. Start it with:" >&2
    echo "  sudo docker compose --env-file $HARK_DIR/compose.env -f $HARK_DIR/compose.yaml up -d hark litestream" >&2
  fi
  exit 1
fi
echo "==> Restored /data/hark.sqlite"

trap - EXIT
echo "==> Starting hark and litestream"
compose up -d hark litestream
