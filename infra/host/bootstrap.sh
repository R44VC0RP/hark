#!/usr/bin/env bash
# First-boot setup for the Hark host (Amazon Linux 2023, arm64). The CDK stack
# feeds this file as EC2 user data, prefixed with exports of LITESTREAM_BUCKET
# and AWS_REGION. It installs the runtime only; deploy.sh does the deploying.
set -euo pipefail

# Pinned docker compose release; bump both together from
# https://github.com/docker/compose/releases (docker-compose-linux-aarch64.sha256).
COMPOSE_VERSION=v5.6.0
COMPOSE_SHA256=733ec76717ceb59052a9609b9dadfb523b2df8eab57a54212872d10a58078ea2

if [[ "$(uname -m)" != "aarch64" ]]; then
  echo "bootstrap.sh expects an aarch64 host, got $(uname -m)" >&2
  exit 1
fi

dnf install -y docker dnf-automatic

# Apply security updates automatically.
sed -i -E \
  -e 's/^upgrade_type[[:space:]]*=.*/upgrade_type = security/' \
  -e 's/^apply_updates[[:space:]]*=.*/apply_updates = yes/' \
  /etc/dnf/automatic.conf
systemctl enable --now dnf-automatic.timer

# Rotate container logs so json-file logs cannot fill the disk.
install -d -m 755 /etc/docker
cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
JSON

install -d -m 755 /usr/local/lib/docker/cli-plugins
compose_tmp=$(mktemp)
curl -fsSL --retry 5 -o "$compose_tmp" \
  "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-aarch64"
echo "${COMPOSE_SHA256}  ${compose_tmp}" | sha256sum --check --strict -
install -m 755 "$compose_tmp" /usr/local/lib/docker/cli-plugins/docker-compose
rm -f "$compose_tmp"

systemctl enable --now docker
docker compose version

install -d -m 755 /opt/hark
# Values that are fixed per stack, read by deploy.sh.
umask 077
cat >/opt/hark/instance.env <<ENV
LITESTREAM_BUCKET=${LITESTREAM_BUCKET:?LITESTREAM_BUCKET must be exported}
AWS_REGION=${AWS_REGION:?AWS_REGION must be exported}
ENV
