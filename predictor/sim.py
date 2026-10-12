"""Per-second feature-row generator for S1-S7 (labels: overload within 10 s).

STAND-IN for the real export: it mirrors the scenario cast/phases of
docs/09 with a seeded fluid model (capacity 100 cost-units/s, 256 queue
slots) so the training pipeline runs without the compose stack. The real
loadgen+platform export (same CSV schema) is deferred to prompt 19; results
here show the method, not production accuracy (docs/07 "Honest limits").

CSV schema: scenario,seed,mode,t,tenant,<10 raw features>,cpu_util,mem_util,
db_conn_util,capacity,label,host_overload
"""
from __future__ import annotations

import csv
import sys

import numpy as np

from app.baseline import FEATURE_NAMES

CAP, SLOTS, DB_CAP, H = 100.0, 256.0, 30.0, 10
WARM, ATTACK, COOL = 20, 60, 30
T_TOTAL = WARM + ATTACK + COOL
TENANTS = ["acme-shop", "data-co", "bursty-news", "rogue-ml", "leaky-app"]
SCENARIOS = ["S1", "S2", "S3", "S4", "S5", "S6", "S7"]
CONTRIB_MIN = 0.35  # a tenant is blamed if it holds >= 35% of a resource
COLS = ["scenario", "seed", "mode", "t", "tenant"] + FEATURE_NAMES + [
    "cpu_util", "mem_util", "db_conn_util", "capacity", "label", "host_overload"]


def _demand(scn: str, t: int, rng: np.random.Generator, p: dict) -> dict:
    """Unmitigated per-tenant (cost, mem, db, rps) at second t."""
    a = t - WARM  # seconds into attack; <0 or >=ATTACK means off
    on = 0 <= a < ATTACK
    d = {
        "acme-shop": [18.0, 0.10, 3.0, 30.0],
        "data-co": [16.0, 0.12, 6.0, 8.0],
        "bursty-news": [3.0, 0.03, 1.0, 5.0],
        "rogue-ml": [2.0, 0.05, 1.0, 2.0],
        "leaky-app": [3.0, 0.08, 1.0, 5.0],
    }
    r = d["rogue-ml"]
    if scn == "S1" and on:      # cpu flood, step change
        r[0], r[3] = p["amp"] * 20.0 * 4.0, 20.0
    elif scn == "S2" and on:    # memory bomb: mem ramps fast, cost modest
        r[1] = min(0.85, 0.05 + a * p["mem_rate"])
        r[0] = 6.0
    elif scn == "S3" and on:    # db connection hog
        r[2] = min(DB_CAP, 1 + a * p["db_rate"])
        r[0] = 8.0
    elif scn == "S4" and on:    # retry storm: oscillating amplification
        r[0] = 10.0 + p["amp"] * 28 * (1 + np.sin(a / 3.0)) * min(1.0, a / 15)
        r[3] = r[0] / 2
    elif scn == "S5" and on:    # slow ramp to ~p["peak"] cost units
        r[0] = 2.0 + (p["peak"] - 2.0) * a / ATTACK
        r[3] = r[0] / 4
    elif scn == "S6" and 0 <= a < 20:  # legit flash crowd, within limits
        d["bursty-news"][0] = 3.0 * p["flash"]
        d["bursty-news"][3] = 5.0 * p["flash"]
    elif scn == "S7" and on:    # two abusers, staggered
        r[0] = p["amp"] * 12.0 + a * 0.6
        if a >= p["stagger"]:
            d["leaky-app"][0] = 3.0 + (a - p["stagger"]) * 0.9 + 20.0
    for v in d.values():
        v[0] *= float(rng.normal(1.0, 0.04))
    return d


def run(scn: str, seed: int, mode: str) -> list[dict]:
    """One run -> list of rows (one per tenant per second)."""
    # identical demand for ON and OFF: seed excludes mode
    rng = np.random.default_rng(int(scn[1:]) * 100003 + seed)
    p = {"amp": float(rng.uniform(0.8, 1.4)), "mem_rate": float(rng.uniform(0.01, 0.03)),
         "db_rate": float(rng.uniform(0.3, 0.8)), "peak": float(rng.uniform(70, 110)),
         "flash": float(rng.uniform(6, 11)), "stagger": int(rng.integers(5, 20))}
    mrng = np.random.default_rng(seed + 999)
    q = 0.0
    mitig_at: dict[str, int] = {}
    series: list[dict] = []
    for t in range(T_TOTAL):
        dem = _demand(scn, t, rng, p)
        eff = {}
        for tid, (c, m, db, rps) in dem.items():
            if mode == "on" and tid in mitig_at and t >= mitig_at[tid]:
                c, m, db, rps = c * 0.2, min(m, 0.15), min(db, 6.0), rps * 0.2
            eff[tid] = [c, m, db, rps]
        D = sum(v[0] for v in eff.values())
        q = min(SLOTS, q + (D - CAP) * 3.0) if D > CAP else q * 0.6
        cpu = min(1.0, D / CAP)
        mem = min(1.0, sum(v[1] for v in eff.values()))
        db = sum(v[2] for v in eff.values())
        host_ratio = max(D / CAP, mem / 0.95, db / DB_CAP, q / (SLOTS * 0.5))
        if mode == "on":  # mitigation: the detector reacts ~detect s after a tenant hits 40% of a resource
            for tid, v in dem.items():
                if tid not in mitig_at and tid != "bursty-news" and max(
                        v[0] / CAP, v[1] / 0.95, v[2] / DB_CAP) >= 0.4:
                    mitig_at[tid] = t + 4 + int(mrng.integers(0, 4))
        rows = {}
        for tid, v in eff.items():
            share = v[0] / D if D > 0 else 0.0
            qt = q * share
            rej = v[3] * 0.5 if q >= SLOTS else 0.0
            raw = [v[3] * float(rng.normal(1, 0.05)), v[0], qt, qt / CAP * 1000.0 + 20.0,
                   50.0 + v[0] / max(v[3], 1.0) * 100.0, v[0] / CAP, v[1], v[2], v[3] * 2.0, rej]
            rows[tid] = {"raw": raw,
                         "contrib": max(v[0] / CAP, v[1] / 0.95, v[2] / DB_CAP)}
        series.append({"rows": rows, "ratio": host_ratio, "cpu": cpu, "mem": mem, "db": db / DB_CAP})
    out = []
    over = [s["ratio"] >= 1.0 for s in series]
    for t, s in enumerate(series):
        fut = any(over[t + 1: t + 1 + H])
        for tid, r in s["rows"].items():
            lab = int(fut and any(
                series[u]["rows"][tid]["contrib"] >= CONTRIB_MIN for u in range(t + 1, min(T_TOTAL, t + 1 + H))
                if over[u]))
            row = dict(zip(COLS[:5], [scn, seed, mode, t, tid]))
            row.update(zip(FEATURE_NAMES, r["raw"]))
            row.update(cpu_util=s["cpu"], mem_util=s["mem"], db_conn_util=min(1.0, s["db"]),
                       capacity=CAP, label=lab, host_overload=int(over[t]))
            out.append(row)
    return out


def generate(scenarios=SCENARIOS, seeds=range(20), modes=("off", "on")) -> list[dict]:
    return [r for s in scenarios for sd in seeds for m in modes for r in run(s, sd, m)]


def write_csv(path: str, rows: list[dict]) -> None:
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "ml/data/rows.csv"
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 24
    import os
    os.makedirs(os.path.dirname(out), exist_ok=True)
    rows = generate(seeds=range(n))
    write_csv(out, rows)
    print(f"{len(rows)} rows, {sum(r['label'] for r in rows)} positive -> {out}")
