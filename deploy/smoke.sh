#!/usr/bin/env bash
# Smoke test: health, API-key -> JWT, invoke, throttle fires, admin API, WS stream.
# Usage: deploy/smoke.sh [BASE_URL]   (default: http://127.0.0.1:8080 on box #1)
# Needs deploy/.env (ADMIN_API_KEY) and deploy/keys.json. Exit 0 = all passed.
set -uo pipefail
cd "$(dirname "$0")"
BASE=${1:-http://127.0.0.1:8080}
ADMIN_KEY=$(grep -E '^ADMIN_API_KEY=' .env | cut -d= -f2-)
pass=0; fail=0
ok()  { echo "  PASS  $1"; pass=$((pass+1)); }
bad() { echo "  FAIL  $1  ($2)"; fail=$((fail+1)); }
tok() { sed -n 's/.*"token":"\([^"]*\)".*/\1/p'; }
key() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" keys.json; } # seed.sh's jq merge pretty-prints ("k": "v")

[ "$(curl -ksS -o /dev/null -w '%{http_code}' "$BASE/healthz")" = 200 ] && ok "healthz" || bad "healthz" "no 200 from $BASE"

KEY=$(key bursty-news)
T=$(curl -ksS -X POST "$BASE/v1/auth/token" -H "X-API-Key: $KEY" | tok)
[ -n "$T" ] && ok "tenant token (bursty-news)" || bad "tenant token" "key rejected? run deploy/seed.sh"

# first invoke cold-starts the tenant's worker container: retry up to ~20 s
for _ in $(seq 1 20); do
  code=$(curl -ksS -o /dev/null -w '%{http_code}' -X POST "$BASE/v1/invoke/echo" \
    -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"msg":"smoke"}')
  [ "$code" = 200 ] && break; sleep 1
done
[ "$code" = 200 ] && ok "invoke echo" || bad "invoke echo" "HTTP $code"

# throttle: hammer a free-tier tenant (10 rps, burst 20) -> expect at least one 429
n429=0
for _ in $(seq 1 80); do
  c=$(curl -ksS -o /dev/null -w '%{http_code}' -X POST "$BASE/v1/invoke/echo" \
    -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{}')
  [ "$c" = 429 ] && n429=$((n429+1))
done
[ "$n429" -gt 0 ] && ok "rate limit fired ($n429 x 429)" || bad "rate limit" "no 429 in 80 requests"

AT=$(curl -ksS -X POST "$BASE/admin/auth/token" -H "X-Admin-Key: $ADMIN_KEY" | tok)
[ -n "$AT" ] && ok "admin token" || bad "admin token" "check ADMIN_API_KEY"
n=$(curl -ksS "$BASE/admin/tenants" -H "Authorization: Bearer $AT" | grep -o '"id"' | wc -l)
[ "$n" -ge 5 ] && ok "admin tenants ($n)" || bad "admin tenants" "got $n"

# WS handshake: expect HTTP 101 Switching Protocols
hs=$(curl -ksS -m 3 -o /dev/null -w '%{http_code}' --http1.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: c21va2UtdGVzdC1rZXkxMg==' "$BASE/admin/stream?token=$AT" 2>/dev/null || true)
[ "$hs" = 101 ] && ok "websocket stream (101)" || bad "websocket stream" "HTTP $hs"

echo "smoke: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
