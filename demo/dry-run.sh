#!/usr/bin/env bash
# Timed headless rehearsal of the demo path: warmup + S1 A/B (seed 42) + S6 (seed 99) + S2 (seed 7).
# Usage: demo/dry-run.sh [N=1]   Prints wall time per run and whether ON assertions passed. Budget: < 300 s each.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd); cd "$ROOT"
N=${1:-1}; BASE=${BASE:-http://127.0.0.1:8080}; KEYS=$ROOT/deploy/keys.json
export LOADGEN_ADMIN_KEY=$(grep -E '^ADMIN_API_KEY=' deploy/.env | cut -d= -f2-)
LG=$ROOT/demo/.loadgen; OUT=$ROOT/runs/dryrun; mkdir -p "$OUT"
[ -x "$LG" ] || demo/warmup.sh >/dev/null || exit 2
rc=0
for i in $(seq 1 "$N"); do
  t0=$(date +%s); ok=1
  "$LG" ab  S1 --seed 42 --target "$BASE" --keys "$KEYS" --out "$OUT" --json >"$OUT/S1-$i.json" 2>"$OUT/S1-$i.log" || ok=0
  "$LG" run S6 --seed 99 --mode on --target "$BASE" --keys "$KEYS" --out "$OUT" --json >"$OUT/S6-$i.json" 2>>"$OUT/S6-$i.log" || ok=0
  "$LG" run S2 --seed 7  --mode on --target "$BASE" --keys "$KEYS" --out "$OUT" --json >"$OUT/S2-$i.json" 2>>"$OUT/S2-$i.log" || ok=0
  dt=$(( $(date +%s) - t0 ))
  [ "$dt" -lt 300 ] || ok=0
  echo "dry-run $i/$N: ${dt}s  $([ $ok = 1 ] && echo PASS || echo FAIL)  (assertion exit codes + <300s)"
  [ $ok = 1 ] || rc=1
done
exit $rc
