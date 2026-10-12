# Shared helpers for deploy/verify/*.sh (source me). Targets the running prod-like compose stack.
VERIFY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEPLOY=$(dirname "$VERIFY_DIR"); ROOT=$(dirname "$DEPLOY")
BASE=${BASE:-http://127.0.0.1:8080}
KEYS=${KEYS:-$DEPLOY/keys.json}
OUT=${OUT:-$ROOT/runs/verify}; mkdir -p "$OUT"
ADMIN_KEY=$(grep -E '^ADMIN_API_KEY=' "$DEPLOY/.env" | cut -d= -f2-)
export LOADGEN_ADMIN_KEY=$ADMIN_KEY
export BASE KEYS
LG=${LG:-$OUT/loadgen}
pass=0; fail=0
ok()  { echo "  PASS  $1"; pass=$((pass+1)); }
bad() { echo "  FAIL  $1  ($2)"; fail=$((fail+1)); }
check() { # check "name" "detail" <exit-status-of-test-command>
  if [ "$3" = 0 ]; then ok "$1"; else bad "$1" "$2"; fi; }
build_lg() { (cd "$ROOT/loadgen" && go build -o "$LG" .); }
tenant_key() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" "$KEYS"; }
tenant_token() { curl -sS -X POST "$BASE/v1/auth/token" -H "X-API-Key: $(tenant_key "$1")" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'; }
admin_token() { curl -sS -X POST "$BASE/admin/auth/token" -H "X-Admin-Key: $ADMIN_KEY" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p'; }
code() { curl -sS -o /dev/null -w '%{http_code}' "$@"; }
probe() { python3 -I "$VERIFY_DIR/probe.py" "$@"; } # probe TENANT TASK RPS SECONDS [JSON-PARAMS]
summary() { echo "== $1: $pass passed, $fail failed"; [ "$fail" -eq 0 ]; }
