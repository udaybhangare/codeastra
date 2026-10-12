import random

from app.baseline import Baseline

CAP = 100.0
HOST = {"capacity_cost_units_s": CAP}


def feats(cost, queue=0.0):
    return [0, cost, queue]


def run_ramp(seed, start=10.0, slope=3.0, noise=3.0, lead_needed=3):
    """Ramp until cost crosses CAP/2 (tenant overload line). Return lead seconds or None."""
    rng = random.Random(seed)
    b = Baseline()
    for _ in range(20):  # calm warm-up
        b.step([("t", feats(start + rng.gauss(0, noise)))], HOST)
    cross = int((CAP * 0.5 - start) / slope)
    alert = None
    for i in range(cross + 10):
        c = start + slope * i + rng.gauss(0, noise)
        _, p = b.step([("t", feats(c))], HOST)
        if alert is None and p[0].p_overload >= 0.6:
            alert = i
    return None if alert is None else cross - alert


def test_ramps_alert_at_least_3s_before_crossing():
    leads = [run_ramp(s) for s in range(30)]
    ok = sum(1 for l in leads if l is not None and l >= 3)
    assert ok / len(leads) >= 0.8, leads


def test_steady_and_noisy_flat_no_false_alarms():
    for seed in range(10):
        rng = random.Random(seed)
        b = Baseline()
        for _ in range(3600):  # one hour of 1 s windows
            c = 20 + rng.gauss(0, 6)
            _, p = b.step([("t", feats(max(c, 0), 5 + rng.random() * 5))], HOST)
            assert p[0].p_overload < 0.6
    assert True


def test_explainable_output():
    b = Baseline()
    last = None
    for i in range(40):
        _, last = b.step([("t", feats(5 + 3 * i))], HOST)
    p = last[0]
    assert p.p_overload > 0.6 and p.top_factor == "cost_rate_trend" and p.eta_s == 0.0


def test_eta_on_ramp_and_none_when_flat():
    b = Baseline()
    for i in range(25):
        _, p = b.step([("t", feats(5 + 1.5 * i))], HOST)
    assert p[0].eta_s is not None and 0 < p[0].eta_s <= 30
    b = Baseline()
    for _ in range(25):
        _, p = b.step([("t", feats(10))], HOST)
    assert p[0].eta_s is None and p[0].top_factor == "none"


def test_short_features_and_stale_eviction():
    b = Baseline()
    b.step([("a", [1.0])], {})
    for _ in range(130):
        b.step([("b", feats(1))], {})
    assert "a" not in b.state and "b" in b.state


def test_api_roundtrip():
    from fastapi.testclient import TestClient
    from app.main import app
    c = TestClient(app)
    r = c.post("/predict", json={"ts": "2026-01-01T00:00:00Z", "host": {"capacity_cost_units_s": 100},
                                 "tenants": [{"id": "x", "features": [1, 2, 3]}]})
    assert r.status_code == 200 and r.json()["model"] == "baseline"
    assert c.get("/health").json()["status"] == "ok"
    assert c.post("/model/select", json={"model": "nope"}).status_code == 409
