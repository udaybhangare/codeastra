#!/usr/bin/env bash
# make demo: one-command warmup so the live demo starts hot and repeatable.
#  1. stack up (starts it via `make demo-local` if /healthz is not 200)
#  2. isolation ON, 3. every tenant worker container cold-started + baseline traffic
#  4. loadgen binary built, 5. schedule hashes printed (same seed => same hash)
# Usage: demo/warmup.sh [BASE_URL]   Exit 0 = ready.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT"
BASE=${1:-${BASE:-http://127.0.0.1:8080}}
KEYS=${KEYS:-$ROOT/deploy/keys.json}
SEEDS="S1=42 S2=7 S6=99"           # fixed demo seeds (docs/13)
LG=${LG:-$ROOT/demo/.loadgen}
step() { printf '\n== %s\n' "$*"; }
die()  { echo "FAIL: $*" >&2; exit 1; }
code() { curl -ksS -o /dev/null -w '%{http_code}' "$@" 2>/dev/null; }

step "1/5 stack"
if [ "$(code "$BASE/healthz")" != 200 ]; then
  echo "platform not answering; starting it (make demo-local, a few minutes on first run)"
  make demo-local || die "make demo-local failed"
  for _ in $(seq 1 30); do [ "$(code "$BASE/healthz")" = 200 ] && break; sleep 2; done
fi
[ "$(code "$BASE/healthz")" = 200 ] || die "no 200 from $BASE/healthz"
[ -f "$KEYS" ] || die "$KEYS missing (run: cd deploy && ./seed.sh)"
echo "ok $BASE"

step "2/5 isolation ON"
ADMIN_KEY=$(grep -E '^ADMIN_API_KEY=' deploy/.env | cut -d= -f2-)
AT=$(curl -ksS -X POST "$BASE/admin/auth/token" -H "X-Admin-Key: $ADMIN_KEY" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$AT" ] || die "admin token (check deploy/.env ADMIN_API_KEY)"
[ "$(code -X POST "$BASE/admin/isolation" -H "Authorization: Bearer $AT" -d '{"mode":"on"}')" = 200 ] || die "isolation toggle"
echo "isolation=on"

step "3/5 warm tenant workers"
tenants=$(python3 -I -c 'import json,sys;print(" ".join(json.load(open(sys.argv[1]))))' "$KEYS")
for t in $tenants; do
  key=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$KEYS" "$t")
  tok=$(curl -ksS -X POST "$BASE/v1/auth/token" -H "X-API-Key: $key" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  [ -n "$tok" ] || die "token for $t"
  c=000
  for _ in $(seq 1 25); do   # first call cold-starts the container
    c=$(code -X POST "$BASE/v1/invoke/echo" -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d '{"msg":"warm"}')
    [ "$c" = 200 ] && break; sleep 1
  done
  # light baseline so EWMA cost estimates / metric windows are populated (stays under every tier's rate limit)
  for _ in $(seq 1 15); do code -X POST "$BASE/v1/invoke/echo" -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' -d '{}' >/dev/null; sleep 0.2; done
  [ "$c" = 200 ] && echo "  warm  $t" || die "$t worker not serving (HTTP $c)"
done

step "4/5 loadgen binary"
(cd loadgen && go build -o "$LG" .) || die "go build loadgen"

step "5/5 seeds -> schedule hash (must match docs/RESULTS + recorded bundle)"
for p in $SEEDS; do
  s=${p%%=*}; seed=${p##*=}
  printf '  %-3s seed=%-3s ' "$s" "$seed"; "$LG" schedule "$s" --seed "$seed" 2>&1 | grep -i -m1 hash || echo "(no hash line)"
done
echo
echo "READY. Dashboard: https://localhost:8443   (top-bar Presentation toggle for big numbers)"
echo "Run order (docs/13): S1 OFF -> S1 ON -> S6 -> S2.  Fallback: Scenarios page -> 'Load recorded'."
