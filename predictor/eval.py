"""Baseline vs GBM on held-out (scenario, seed) groups. Usage: uv run python eval.py [rows.csv] [out.json]

Per run (scenario, seed, mode=off so overload is raw) we replay the series
through each model. Alert = tenant p >= THRESH. Lead time = onset of the first
host overload minus the start of the alert episode active within H s before it
(positive = early; None = missed). False alarms/hour = alert episodes while no overload occurs within
the next H seconds, normalised by observed seconds.
"""
from __future__ import annotations

import json
import pathlib
import sys

import numpy as np
from sklearn.metrics import average_precision_score

from app.baseline import Baseline
from app.gbm import ARTIFACT_DIR, GBM
from sim import H
from train import featurize, load_rows, split_groups

THRESH = 0.5


def replay(model, rows: list[dict]) -> dict[int, dict[str, float]]:
    """-> {t: {tenant: p}} for one run, feeding all tenants each second."""
    by_t: dict[int, list[dict]] = {}
    for r in rows:
        by_t.setdefault(int(r["t"]), []).append(r)
    from app.baseline import FEATURE_NAMES
    out = {}
    for t in sorted(by_t):
        rs = by_t[t]
        host = {"cpu_util": float(rs[0]["cpu_util"]), "mem_util": float(rs[0]["mem_util"]),
                "db_conn_util": float(rs[0]["db_conn_util"]), "capacity_cost_units_s": float(rs[0]["capacity"])}
        _, preds = model.step([(r["tenant"], [float(r[n]) for n in FEATURE_NAMES]) for r in rs], host)
        out[t] = {p.id: p.p_overload for p in preds}
    return out


def episodes(flags: list[bool]) -> list[int]:
    return [i for i, f in enumerate(flags) if f and (i == 0 or not flags[i - 1])]


def evaluate(path: str) -> dict:
    rows = load_rows(path)
    _, _, meta = featurize(rows)
    tag = split_groups(meta)
    test = {(m[0], m[1]) for m, t in zip(meta, tag) if t == "test"}
    runs: dict[tuple, list[dict]] = {}
    for r in rows:
        if (r["scenario"], int(r["seed"])) in test:
            runs.setdefault((r["scenario"], int(r["seed"]), r["mode"]), []).append(r)
    gbm = GBM.load(ARTIFACT_DIR)
    res = {"baseline": {"y": [], "p": []}, "gbm": {"y": [], "p": []}}
    lead = {"baseline": {}, "gbm": {}}
    fa = {"baseline": 0, "gbm": 0}
    seconds = 0
    for (scn, seed, mode), rs in sorted(runs.items()):
        preds = {"baseline": replay(Baseline(), rs), "gbm": replay(GBM(gbm.model, gbm.meta), rs)}
        T = max(int(r["t"]) for r in rs) + 1
        ho = [0] * T
        lab: dict[tuple, int] = {}
        for r in rs:
            ho[int(r["t"])] = int(r["host_overload"])
            lab[(int(r["t"]), r["tenant"])] = int(r["label"])
        onset = next((t for t in range(T) if ho[t]), None)
        seconds += T
        for name, pr in preds.items():
            for (t, tid), y in lab.items():
                res[name]["y"].append(y)
                res[name]["p"].append(pr[t][tid])
            alert = [max(pr[t].values()) >= THRESH for t in range(T)]
            if mode == "off" and onset is not None:
                first = None  # start of the alert episode active within H s before onset
                for e in episodes(alert):
                    end = e
                    while end + 1 < T and alert[end + 1]:
                        end += 1
                    if end >= onset - H and e <= onset:
                        first = e
                        break
                lead[name].setdefault(scn, []).append(None if first is None else onset - first)
            for e in episodes(alert):
                if not any(ho[e + 1: e + 1 + H]) and not ho[e]:
                    fa[name] += 1
    report = {"threshold": THRESH, "horizon_s": H, "test_groups": len(test),
              "note": "simulated data; shows method, not production accuracy", "models": {}}
    for name in ("baseline", "gbm"):
        y, p = np.array(res[name]["y"]), np.array(res[name]["p"])
        per = {}
        for scn, vals in sorted(lead[name].items()):
            got = [v for v in vals if v is not None]
            per[scn] = {"runs": len(vals), "detected": len(got),
                        "median_lead_s": float(np.median(got)) if got else None}
        allv = [v for vals in lead[name].values() for v in vals if v is not None]
        every = [v for vals in lead[name].values() for v in vals]
        report["models"][name] = {
            "detection_rate": round(len(allv) / len(every), 3) if every else None,
            "mean_lead_misses_as_0_s": round(sum(allv) / len(every), 2) if every else None,
            "pr_auc": round(float(average_precision_score(y, p)), 4) if y.sum() else None,
            "false_alarms_per_hour": round(fa[name] / (seconds / 3600.0), 1) if seconds else None,
            "median_lead_s": float(np.median(allv)) if allv else None,
            "lead_by_scenario": per,
        }
    b, g = report["models"]["baseline"], report["models"]["gbm"]
    report["verdict"] = ("gbm" if (g["pr_auc"] or 0) > (b["pr_auc"] or 0)
                         and (g["mean_lead_misses_as_0_s"] or 0) > (b["mean_lead_misses_as_0_s"] or 0)
                         else "baseline")
    report["default_model"] = "baseline"  # GBM stays opt-in until validated on real loadgen data (prompt 19)
    return report


if __name__ == "__main__":
    src = sys.argv[1] if len(sys.argv) > 1 else "ml/data/rows.csv"
    dst = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "ml/artifacts/eval.json")
    rep = evaluate(src)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(rep, indent=1))
    for n, m in rep["models"].items():
        print(n, "PR-AUC", m["pr_auc"], "detect", m["detection_rate"], "lead(miss=0)",
              m["mean_lead_misses_as_0_s"], "FA/h", m["false_alarms_per_hour"])
    print("verdict:", rep["verdict"])
