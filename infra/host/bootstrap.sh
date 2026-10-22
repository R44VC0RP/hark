#!/usr/bin/env bash
# Host setup for the Hark host (Amazon Linux 2023, arm64), run as root from the
# extracted host bundle: by EC2 user data on first boot and by the HarkUpdateHost
# Run Command document afterwards, both with LITESTREAM_BUCKET and AWS_REGION
# exported. Safe to re-run. It installs the runtime and this bundle into
# /opt/hark; deploy.sh does the deploying.
#   bootstrap.sh <extracted bundle dir>
set -euo pipefail

bundle_dir=${1:?usage: bootstrap.sh <extracted host bundle dir>}

# Pinned docker compose release; bump both together from
# https://github.com/docker/compose/releases (docker-compose-linux-aarch64.sha256).
COMPOSE_VERSION=v5.6.0
COMPOSE_SHA256=733ec76717ceb59052a9609b9dadfb523b2df8eab57a54212872d10a58078ea2

if [[ "$(uname -m)" != "aarch64" ]]; then
  echo "bootstrap.sh expects an aarch64 host, got $(uname -m)" >&2
  exit 1
fi

dnf install -y docker dnf-automatic iptables-nft

# Apply security updates automatically.
sed -i -E \
  -e 's/^upgrade_type[[:space:]]*=.*/upgrade_type = security/' \
  -e 's/^apply_updates[[:space:]]*=.*/apply_updates = yes/' \
  /etc/dnf/automatic.conf
systemctl enable --now dnf-automatic.timer

# Kernel live patches (installed by dnf-automatic like other security updates)
# cover kernel CVEs until the next reboot. Best effort: a kernel without live
# patch support must not fail the setup.
if dnf install -y kpatch-dnf kpatch-runtime && dnf kernel-livepatch -y auto; then
  systemctl enable --now kpatch.service
else
  echo "warning: kernel live patching could not be enabled" >&2
fi

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

# Containers on Docker bridges must not reach the instance metadata service
# (the role's credentials). Litestream, the one container that needs the role,
# uses the host network and is unaffected. Docker recreates DOCKER-USER on every
# start, so a unit tied to docker.service re-inserts the rule each time.
cat >/etc/systemd/system/hark-block-imds.service <<'UNIT'
[Unit]
Description=Block container access to the EC2 instance metadata service
After=docker.service
Requires=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'iptables -C DOCKER-USER -d 169.254.169.254/32 -j DROP 2>/dev/null || iptables -I DOCKER-USER -d 169.254.169.254/32 -j DROP'

[Install]
WantedBy=docker.service
UNIT
systemctl daemon-reload
systemctl enable hark-block-imds.service
systemctl restart hark-block-imds.service
iptables -C DOCKER-USER -d 169.254.169.254/32 -j DROP

install -d -m 755 /opt/hark
for f in compose.yaml litestream.yml; do
  install -m 644 "$bundle_dir/$f" "/opt/hark/$f"
done
for f in bootstrap.sh deploy.sh restore.sh; do
  install -m 755 "$bundle_dir/$f" "/opt/hark/$f"
done
# Values that are fixed per stack, read by deploy.sh.
umask 077
cat >/opt/hark/instance.env <<ENV
LITESTREAM_BUCKET=${LITESTREAM_BUCKET:?LITESTREAM_BUCKET must be exported}
AWS_REGION=${AWS_REGION:?AWS_REGION must be exported}
ENV
