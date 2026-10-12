"""Train the GBM overload predictor (docs/07). Usage: uv run python train.py [rows.csv]

Split is by (scenario, seed) group, never by row. Calibration (isotonic) is
fit on a separate validation split of groups. Writes ml/artifacts/{gbm.joblib,
meta.json}.
"""
from __future__ import annotations

import csv
import json
import pathlib
import sys

import joblib
import numpy as np
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.frozen import FrozenEstimator

from app.baseline import FEATURE_NAMES
from app.features import NAMES, FeatureWindow

OUT = pathlib.Path(__file__).parent / "ml" / "artifacts"
VERSION = "gbm-1"


def load_rows(path: str) -> list[dict]:
    with open(path) as f:
        return list(csv.DictReader(f))


def featurize(rows: list[dict]):
    """Replay each (scenario,seed,mode,tenant) series causally -> X, y, meta."""
    series: dict[tuple, list[dict]] = {}
    for r in rows:
        series.setdefault((r["scenario"], int(r["seed"]), r["mode"], r["tenant"]), []).append(r)
    X, y, meta = [], [], []
    for key, rs in series.items():
        rs.sort(key=lambda r: int(r["t"]))
        w = FeatureWindow()
        for r in rs:
            host = {"cpu_util": float(r["cpu_util"]), "mem_util": float(r["mem_util"]),
                    "db_conn_util": float(r["db_conn_util"]), "capacity_cost_units_s": float(r["capacity"])}
            X.append(w.push([float(r[n]) for n in FEATURE_NAMES], host))
            y.append(int(r["label"]))
            meta.append((key[0], key[1], key[2], key[3], int(r["t"])))
    return np.array(X), np.array(y), meta


def split_groups(meta, test_frac=0.25, val_frac=0.2, rng_seed=7):
    groups = sorted({(m[0], m[1]) for m in meta})
    rng = np.random.default_rng(rng_seed)
    rng.shuffle(groups)
    n_test, n_val = int(len(groups) * test_frac), int(len(groups) * val_frac)
    test, val = set(groups[:n_test]), set(groups[n_test:n_test + n_val])
    tag = ["test" if (m[0], m[1]) in test else "val" if (m[0], m[1]) in val else "train" for m in meta]
    return np.array(tag)


def main(path: str) -> None:
    X, y, meta = featurize(load_rows(path))
    tag = split_groups(meta)
    tr, va = tag == "train", tag == "val"
    base = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.08, max_depth=5,
                                          class_weight="balanced", random_state=0)
    base.fit(X[tr], y[tr])
    cal = CalibratedClassifierCV(FrozenEstimator(base), method="isotonic")
    cal.fit(X[va], y[va])
    # global importance: permutation on the validation split (cheap, model-agnostic)
    rng = np.random.default_rng(0)
    ref = base.score(X[va], y[va])
    imp = []
    for j in range(X.shape[1]):
        Xp = X[va].copy()
        Xp[:, j] = rng.permutation(Xp[:, j])
        imp.append(max(0.0, ref - base.score(Xp, y[va])))
    s = sum(imp) or 1.0
    OUT.mkdir(parents=True, exist_ok=True)
    joblib.dump(cal, OUT / "gbm.joblib")
    meta_json = {
        "version": VERSION, "features": NAMES, "horizon_s": 10,
        "mean": X[tr].mean(0).tolist(), "std": X[tr].std(0).tolist(),
        "importance": [i / s for i in imp],
        "groups": {k: int(len({(m[0], m[1]) for m, t in zip(meta, tag) if t == k})) for k in ("train", "val", "test")},
        "source": path, "note": "trained on simulated data; shows method, not production accuracy",
    }
    (OUT / "meta.json").write_text(json.dumps(meta_json, indent=1))
    print(f"trained {VERSION}: rows={len(y)} pos={int(y.sum())} groups={meta_json['groups']} -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "ml/data/rows.csv")
