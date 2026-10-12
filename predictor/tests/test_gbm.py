"""Leakage, split and serving checks for the GBM challenger (prompt 12)."""
import pytest
from fastapi.testclient import TestClient

import sim
from app import main
from app.features import NAMES, FeatureWindow
from train import featurize, split_groups


def test_features_are_causal():
    """Features at t must not change if future samples differ."""
    host = {"capacity_cost_units_s": 100.0}
    a, b = FeatureWindow(), FeatureWindow()
    seq = [[10, 5 + i, 0, 0, 0, 0, 0, 0, 0, 0] for i in range(12)]
    fa = [a.push(r, host) for r in seq]
    seq2 = seq[:8] + [[10, 999, 50, 0, 0, 0, 0, 0, 0, 0]] * 4
    fb = [b.push(r, host) for r in seq2]
    assert fa[:8] == fb[:8]
    assert len(fa[0]) == len(NAMES)


def test_sim_is_deterministic_and_labels_sane():
    r1, r2 = sim.run("S5", 3, "off"), sim.run("S5", 3, "off")
    assert r1 == r2
    assert sum(r["label"] for r in r1) > 0
    assert sum(r["label"] for r in sim.run("S6", 3, "off")) == 0  # flash crowd: no overload
    # mitigation changes outcomes but not demand noise: ON has no more overload than OFF
    on, off = sim.run("S1", 1, "on"), sim.run("S1", 1, "off")
    assert sum(r["host_overload"] for r in on) <= sum(r["host_overload"] for r in off)


def test_split_is_by_scenario_seed_group():
    rows = sim.generate(scenarios=["S1", "S5"], seeds=range(6), modes=("off", "on"))
    _, _, meta = featurize(rows)
    tag = split_groups(meta)
    seen: dict[tuple, set] = {}
    for m, t in zip(meta, tag):
        seen.setdefault((m[0], m[1]), set()).add(t)
    assert all(len(v) == 1 for v in seen.values())  # a group never straddles splits
    assert {"train", "val", "test"} <= set(tag)


def test_select_gbm_and_predict():
    c = TestClient(main.app)
    body = {"ts": "2026-01-01T00:00:00Z", "host": {"capacity_cost_units_s": 100.0},
            "tenants": [{"id": "rogue-ml", "features": [20, 80, 10, 100, 60, 0.8, 0.1, 2, 40, 0]}]}
    assert c.post("/model/select", json={"model": "nope"}).status_code == 409
    r = c.post("/model/select", json={"model": "gbm"})
    if r.status_code == 409:
        pytest.skip("no trained artifact (run train.py)")
    out = c.post("/predict", json=body).json()
    assert out["model"] == "gbm" and 0 <= out["tenants"][0]["p_overload"] <= 1
    assert c.post("/model/select", json={"model": "baseline"}).json() == {"model": "baseline"}
    assert c.post("/predict", json=body).json()["model"] == "baseline"
