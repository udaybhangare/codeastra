#!/usr/bin/env bash
# Create deploy/.env with random secrets (refuses to overwrite).
# Usage: deploy/gen-env.sh <SITE_ADDRESS> [BULKHEAD_BIND_IP]
set -euo pipefail
cd "$(dirname "$0")"
[ ! -f .env ] || { echo ".env already exists; edit it by hand." >&2; exit 1; }
rnd() { head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
{
  echo "SITE_ADDRESS=${1:-localhost}"
  echo "POSTGRES_PASSWORD=$(rnd)"
  echo "JWT_SECRET=$(rnd)"
  echo "ADMIN_JWT_SECRET=$(rnd)"
  echo "ADMIN_API_KEY=$(rnd)"
  echo "ISOLATION=on"
  echo "BULKHEAD_BIND_IP=${2:-127.0.0.1}"
  [ "${1:-localhost}" != localhost ] || printf 'CADDY_HTTP_PORT=8088\nCADDY_HTTPS_PORT=8443\n'
} > .env
chmod 600 .env
echo "wrote deploy/.env (secrets are random, file is gitignored)"
