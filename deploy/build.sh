#!/usr/bin/env bash
# Build all images on the box (multi-stage, no host toolchain needed).
# Usage: deploy/build.sh [platform|worker|predictor|dashboard|loadgen ...]   (default: all but loadgen)
# Dashboard bakes NEXT_PUBLIC_API_URL=https://$SITE_ADDRESS from deploy/.env.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
SITE=${SITE_ADDRESS:-localhost}
targets=("$@"); [ ${#targets[@]} -gt 0 ] || targets=(platform worker predictor dashboard)
for t in "${targets[@]}"; do
  echo "== build $t"
  case $t in
    platform)  docker build -q -f docker/Dockerfile.platform  -t bulkhead/platform:prod  ../platform ;;
    worker)    docker build -q -f docker/Dockerfile.worker    -t bulkhead/worker:dev     ../worker ;;
    predictor) docker build -q -f docker/Dockerfile.predictor -t bulkhead/predictor:prod ../predictor ;;
    loadgen)   docker build -q -f docker/Dockerfile.loadgen   -t bulkhead/loadgen:prod   ../loadgen ;;
    dashboard) docker build -q -f docker/Dockerfile.dashboard -t bulkhead/dashboard:prod \
                 --build-arg NEXT_PUBLIC_API_URL="https://${SITE}${CADDY_HTTPS_PORT:+:$CADDY_HTTPS_PORT}" \
                 --build-arg NEXT_PUBLIC_WS_URL="${NEXT_PUBLIC_WS_URL:-auto}" ../dashboard ;;
    *) echo "unknown target $t" >&2; exit 2 ;;
  esac
done
