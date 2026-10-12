#!/usr/bin/env python3
"""Offline loader for recorded A/B bundles (fallback when the live run stalls or the network is off).

  demo/recorded/load.py            list bundles + print big-number tables
  demo/recorded/load.py S1         one scenario
  demo/recorded/load.py --sync     copy bundles into dashboard/public/recorded/ (what 'Load recorded' fetches)

Needs only the Python stdlib; touches no network."""
import json, pathlib, shutil, sys

HERE = pathlib.Path(__file__).resolve().parent
PUB = HERE.parents[1] / "dashboard" / "public" / "recorded"
ROWS = [("victim_p99_inflation", "Victim p99 inflation", "{:.2f}x"),
        ("victim_throughput_ratio", "Victim throughput ratio", "{:.2f}"),
        ("abuser_goodput_rps", "Abuser goodput (rps)", "{:.2f}"),
        ("victim_errors", "Victim errors", "{:.0f}"),
        ("jain", "Jain index", "{:.2f}")]

def load(p):
    d = json.loads(p.read_text())
    if d.get("version") != 1 or "off" not in d or "on" not in d:
        raise ValueError(f"{p.name}: not a v1 A/B bundle")
    return d

def show(p):
    d = load(p)
    m = {k: d[k]["summary"].get("metrics", {}) for k in ("off", "on")}
    print(f"\n{d['scenario']}  seed={d.get('seed')}  schedule={d['on']['summary'].get('schedule_hash','?')[:12]}  ({len(d['on'].get('series', []))} series points)")
    print(f"  {'metric':26}{'OFF':>12}{'ON':>12}")
    for k, label, f in ROWS:
        a, b = m["off"].get(k), m["on"].get(k)
        print(f"  {label:26}{(f.format(a) if a is not None else '-'):>12}{(f.format(b) if b is not None else '-'):>12}")

def main(argv):
    files = sorted(HERE.glob("*.json"))
    if "--sync" in argv:
        PUB.mkdir(parents=True, exist_ok=True)
        for p in files:
            load(p); shutil.copy2(p, PUB / p.name); print("synced", p.name)
        return 0
    want = [a for a in argv if not a.startswith("-")]
    sel = [p for p in files if not want or p.stem in want]
    if not sel:
        print("no recorded bundles match", want or "(none present)", file=sys.stderr); return 1
    for p in sel:
        show(p)
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
