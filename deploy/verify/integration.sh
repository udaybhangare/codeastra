#!/usr/bin/env bash
# Scenario integration: runs S1,S2,S3,S6 (isolation ON) via loadgen against the live stack and
# prints every scenario assertion. Usage: integration.sh [SCALE=1] [SCENARIOS="S1 S2 S3 S6"]
source "$(dirname "$0")/lib.sh"
SCALE=${1:-1}; SCEN=${2:-"S1 S2 S3 S6"}
build_lg || exit 2
echo "== integration (scale=$SCALE, seed=scenario default)"
for s in $SCEN; do
  f="$OUT/$s-on.json"
  "$LG" run "$s" --scale "$SCALE" --target "$BASE" --keys "$KEYS" --mode on --out "$OUT/runs" --json >"$f" 2>"$OUT/$s.log"
  python3 -I - "$f" "$s" <<'P'
import json,sys
r=json.load(open(sys.argv[1]))[0]
for a in r["assertions"]:
    aa=a.get("Assertion",a); who=aa.get("applies_to") or ""
    print(("  PASS  " if a.get("pass") else "  FAIL  ")+f'{sys.argv[2]} {aa.get("metric")} {who} {aa.get("op")} {aa.get("value")}  (actual {a.get("actual"):.3g}{"; "+a["note"] if a.get("note") else ""})')
m=r["metrics"]
print(f'        {sys.argv[2]} extras: jain={m["jain"]:.2f} victim_errors={m["victim_errors"]:.0f} detect={m["time_to_detect_s"]:.3g}s mitigate={m["time_to_mitigate_s"]:.3g}s')
P
done
