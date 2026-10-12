#!/usr/bin/env bash
# Repeatability: run scenario A/B N times (default S1 x5, different seeds) and report median + spread.
# Usage: repeat.sh [SCENARIO=S1] [N=5] [SCALE=1]
source "$(dirname "$0")/lib.sh"
S=${1:-S1}; N=${2:-5}; SCALE=${3:-1}
build_lg || exit 2
for i in $(seq 1 "$N"); do
  seed=$((100 + i))
  "$LG" ab "$S" --seed "$seed" --scale "$SCALE" --target "$BASE" --keys "$KEYS" --out "$OUT/runs" --json \
    >"$OUT/$S-ab-$i.json" 2>"$OUT/$S-ab-$i.log"
  echo "run $i/$N seed=$seed done (exit $?)"
done
python3 -I - "$OUT" "$S" "$N" <<'P'
import json,sys,statistics as st
out,s,n=sys.argv[1],sys.argv[2],int(sys.argv[3])
keys=["victim_p99_inflation","time_to_detect_s","time_to_mitigate_s","victim_errors","jain","abuser_goodput_rps","victim_throughput_ratio"]
rows={"off":[], "on":[]}; passes=0
for i in range(1,n+1):
    off,on=json.load(open(f"{out}/{s}-ab-{i}.json"))
    rows["off"].append(off["metrics"]); rows["on"].append(on["metrics"]); passes+=on["pass"]
print(f"{s} A/B x{n}: ON-run assertions passed in {passes}/{n} runs")
print(f'{"metric":28} {"mode":4} {"median":>10} {"min":>10} {"max":>10}   values')
for k in keys:
    for m in ("off","on"):
        v=[r[k] for r in rows[m]]
        f=lambda x:f"{x:.4g}"
        print(f'{k:28} {m:4} {f(st.median(v)):>10} {f(min(v)):>10} {f(max(v)):>10}   {[float(f(x)) for x in v]}')
P
