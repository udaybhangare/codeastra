#!/usr/bin/env bash
# Spike (prompt 04): is Docker on cgroup v2, and does `docker update --cpus`
# change CPU use of a RUNNING container? Takes ~15 s. Needs only `docker`.
set -euo pipefail
IMG=${IMG:-alpine:3.20}
NAME=bulkhead-cgroup-spike
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

echo "cgroup version : $(docker info --format '{{.CgroupVersion}}')  (want 2)"
echo "cgroup driver  : $(docker info --format '{{.CgroupDriver}}')"
echo "rootless       : $(docker info --format '{{.SecurityOptions}}' | grep -q rootless && echo yes || echo no)"

# measured CPU cores used over $1 seconds, read from the container's own cgroup
measure() {
  local s=$1 a b
  a=$(docker exec "$NAME" sh -c "awk '/usage_usec/{print \$2}' /sys/fs/cgroup/cpu.stat")
  sleep "$s"
  b=$(docker exec "$NAME" sh -c "awk '/usage_usec/{print \$2}' /sys/fs/cgroup/cpu.stat")
  awk -v a="$a" -v b="$b" -v s="$s" 'BEGIN{printf "%.2f", (b-a)/1e6/s}'
}

docker rm -f "$NAME" >/dev/null 2>&1 || true
# 2 busy loops so the container *wants* 2 cores; the quota is what limits it.
docker run -d --name "$NAME" --cpus 1.0 "$IMG" \
  sh -c 'while :; do :; done & while :; do :; done' >/dev/null
sleep 1
before=$(measure 3)
echo "cpus=1.0 measured: ${before} cores"
docker update --cpus 0.5 "$NAME" >/dev/null
sleep 1
after=$(measure 3)
echo "cpus=0.5 measured: ${after} cores (after live docker update)"
echo "cpu.max now    : $(docker exec "$NAME" cat /sys/fs/cgroup/cpu.max)"

if awk -v a="$before" -v b="$after" 'BEGIN{exit !(a>0.8 && a<1.2 && b>0.35 && b<0.65)}'; then
  echo "RESULT: OK - live docker update works"
else
  echo "RESULT: FAIL - live update did not take effect; use restart-on-change (docs/14 R1) and log in docs/DEVIATIONS.md"
  exit 1
fi
