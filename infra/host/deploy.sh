#!/usr/bin/env bash
# Deploy one Hark image on this host. Safe to re-run. CI runs it through the
# HarkDeploy Run Command document; an operator can run it in a session.
#   /opt/hark/deploy.sh <account>.dkr.ecr.<region>.amazonaws.com/hark:<sha>
# If the new image does not become healthy, the previous image is started again
# and the script fails; the failed container's log tail is kept in
# /opt/hark/last-failed-deploy.log (not in the command output, which CI can read).
# A missing database with a non-empty replica is an error (a failed restore must
# not start an empty database); HARK_ALLOW_EMPTY_DB=1 overrides that.
set -euo pipefail

image=${1:?usage: deploy.sh <image-uri>}
HARK_DIR=/opt/hark
PARAMETER_PATH=/hark/prod
cd "$HARK_DIR"

# SSM Run Command does not always set HOME; docker login stores credentials there.
export HOME=${HOME:-/root}

# shellcheck source=/dev/null
source "$HARK_DIR/instance.env"
: "${LITESTREAM_BUCKET:?missing in instance.env}" "${AWS_REGION:?missing in instance.env}"

compose() {
  docker compose --env-file "$HARK_DIR/compose.env" -f "$HARK_DIR/compose.yaml" "$@"
}

echo "==> Logging in to ECR"
aws ecr get-login-password --region "$AWS_REGION" |
  docker login --username AWS --password-stdin "${image%%/*}" >/dev/null

echo "==> Rendering environment from SSM ${PARAMETER_PATH}"
umask 077
env_tmp=$(mktemp "$HARK_DIR/.env.XXXXXX")
tunnel_tmp=$(mktemp "$HARK_DIR/.cloudflared.env.XXXXXX")
trap 'rm -f "$env_tmp" "$tunnel_tmp"' EXIT
# Values never reach stdout. Every value is single-quoted so compose takes it
# literally (no ${} interpolation, no escapes, no inline comments).
aws ssm get-parameters-by-path --region "$AWS_REGION" --path "$PARAMETER_PATH" \
  --recursive --with-decryption --output json |
  python3 -c '
import json, re, sys

prefix, env_path, tunnel_path = sys.argv[1] + "/", sys.argv[2], sys.argv[3]
params = json.load(sys.stdin)["Parameters"]
values = {}
for p in params:
    key = p["Name"][len(prefix):]
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
        sys.exit("Unsupported parameter name: " + p["Name"])
    value = p["Value"]
    if "\x27" in value or "\n" in value or "\r" in value:
        sys.exit(key + ": single quotes and newlines are not supported (write PEM keys with \\n)")
    values[key] = value

# Set by compose.yaml, never from SSM.
for key in ("NODE_ENV", "PORT", "DATABASE_URL"):
    values.pop(key, None)
missing = [k for k in ("APP_URL", "BETTER_AUTH_SECRET", "CLOUDFLARE_TUNNEL_TOKEN") if k not in values]
if missing:
    sys.exit("Missing required parameters: " + ", ".join(missing))

# Only cloudflared gets the tunnel token, and only the app gets the rest.
token = values.pop("CLOUDFLARE_TUNNEL_TOKEN")
with open(tunnel_path, "w") as f:
    f.write("TUNNEL_TOKEN=\x27" + token + "\x27\n")
with open(env_path, "w") as f:
    for key in sorted(values):
        f.write(key + "=\x27" + values[key] + "\x27\n")
print("Rendered %d app parameters: %s" % (len(values), ", ".join(sorted(values))))
' "$PARAMETER_PATH" "$env_tmp" "$tunnel_tmp"
chmod 600 "$env_tmp" "$tunnel_tmp"
mv -f "$env_tmp" "$HARK_DIR/.env"
mv -f "$tunnel_tmp" "$HARK_DIR/cloudflared.env"

previous_image=
if [[ -f "$HARK_DIR/compose.env" ]]; then
  previous_image=$(sed -n 's/^HARK_IMAGE=//p' "$HARK_DIR/compose.env")
fi

write_compose_env() {
  cat >"$HARK_DIR/compose.env.tmp" <<ENV
HARK_IMAGE=${1}
LITESTREAM_BUCKET=${LITESTREAM_BUCKET}
AWS_REGION=${AWS_REGION}
ENV
  mv -f "$HARK_DIR/compose.env.tmp" "$HARK_DIR/compose.env"
}
write_compose_env "$image"
umask 022

echo "==> Pulling images"
compose pull --quiet

# A brand-new volume takes its ownership from the first image mounted on it, so
# let the hark image (where /data belongs to node) create it.
compose run --rm --no-deps -T hark true </dev/null

# On a fresh host (new or replaced instance) bring the database back from the
# replica before the app can create an empty one. No-op when the DB exists or
# there is no replica yet.
echo "==> Restoring database from replica if it is missing"
compose run --rm --no-deps -T litestream \
  restore -config /etc/litestream.yml -if-db-not-exists -if-replica-exists \
  -integrity-check quick /data/hark.sqlite \
  </dev/null

if ! compose run --rm --no-deps -T hark test -e /data/hark.sqlite </dev/null; then
  replica_key=$(aws s3api list-objects-v2 --region "$AWS_REGION" --bucket "$LITESTREAM_BUCKET" \
    --prefix hark.sqlite/ --max-items 1 --query 'Contents[0].Key' --output text)
  if [[ "$replica_key" != "None" && "${HARK_ALLOW_EMPTY_DB:-}" != "1" ]]; then
    echo "No database after the restore step, but the replica is not empty; refusing to" >&2
    echo "start an empty database. Fix the restore (restore.sh), or set HARK_ALLOW_EMPTY_DB=1." >&2
    exit 1
  fi
  echo "No replica yet; hark will create a new database"
fi

wait_healthy() {
  local container status=unknown
  container=$(compose ps -q hark)
  for _ in $(seq 1 30); do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")
    [[ "$status" == "healthy" ]] && return 0
    sleep 2
  done
  echo "hark is ${status} after 60s" >&2
  return 1
}

echo "==> Starting ${image}"
compose up -d --remove-orphans

if ! wait_healthy; then
  (umask 077 && compose logs --no-color --tail=200 hark >"$HARK_DIR/last-failed-deploy.log" 2>&1) || true
  echo "Log tail saved to $HARK_DIR/last-failed-deploy.log" >&2
  if [[ -n "$previous_image" && "$previous_image" != "$image" ]]; then
    echo "==> Rolling back to ${previous_image}" >&2
    umask 077
    write_compose_env "$previous_image"
    umask 022
    compose up -d --remove-orphans
    if wait_healthy; then
      echo "Rolled back: ${previous_image} is healthy" >&2
    else
      echo "Rollback image ${previous_image} is not healthy either" >&2
    fi
  fi
  exit 1
fi

compose ps
# Remove images no container uses (previous hark builds); rollbacks pull from ECR.
docker image prune -af >/dev/null
echo "==> Deployed ${image}"
