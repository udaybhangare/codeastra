#!/usr/bin/env bash
# Fresh Ubuntu 24.04 box: install Docker + compose plugin, verify cgroup v2 (R1).
# Usage: sudo deploy/bootstrap.sh   (re-runnable)
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }

if ! command -v docker >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git make dnsutils
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
[ -z "${SUDO_USER:-}" ] || usermod -aG docker "$SUDO_USER"

fs=$(stat -fc %T /sys/fs/cgroup)
if [ "$fs" != cgroup2fs ]; then
  echo "FAIL: cgroup is '$fs', need cgroup2fs (Ubuntu 24.04 default). Throttling by 'docker update' won't behave." >&2
  exit 1
fi
echo "OK: docker $(docker --version | cut -d' ' -f3 | tr -d ,), cgroup v2 ($(docker info --format '{{.CgroupVersion}}'), driver $(docker info --format '{{.CgroupDriver}}'))"
[ -z "${SUDO_USER:-}" ] || echo "NOTE: log out and back in (or run 'newgrp docker') so $SUDO_USER can use docker without sudo."
