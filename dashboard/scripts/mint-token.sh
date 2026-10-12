#!/usr/bin/env bash
# Mints a 15-min admin JWT from the running backend and writes dashboard/.env.local.
# Usage: pnpm mint-token   (backend must be up; reads ADMIN_API_KEY from ../deploy/.env, else ../.env)
set -euo pipefail
cd "$(dirname "$0")/.."
ENVF=../deploy/.env; [ -f "$ENVF" ] || ENVF=../.env   # the running stack uses deploy/.env
KEY=$(grep -E '^ADMIN_API_KEY=' "$ENVF" | cut -d= -f2-)
API=${API:-http://localhost:8080}
TOK=$(curl -fsS -X POST "$API/admin/auth/token" -H "X-Admin-Key: $KEY" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$TOK" ] || { echo "could not mint token: is the backend running at $API?" >&2; exit 1; }
echo "NEXT_PUBLIC_WS_URL=ws://localhost:8080/admin/stream?token=$TOK" > .env.local
echo "wrote dashboard/.env.local (valid 15 min). Restart 'pnpm dev' to pick it up."
