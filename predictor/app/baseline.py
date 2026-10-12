"""Explainable baseline forecaster (docs/07): Holt smoothing + z-score anomaly.

No training, no clock: one call to ``Baseline.step`` == one 1-second window.
State is a small rolling cache keyed by tenant (see ``Baseline`` docstring).
"""
from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field

# Order of the per-second feature vector (docs/07 "Features"; shorter vectors
# are zero-padded, extra entries ignored).
FEATURE_NAMES = [
    "rate", "cost_units_s", "queue_depth", "queue_wait_p95", "exec_p95",
    "cpu_share", "mem_share", "db_conns", "bytes_s", "rejections_s",
]
IDX_COST, IDX_QUEUE = 1, 2

H = 10                  # forecast horizon, seconds
ALPHA, BETA = 0.5, 0.1  # Holt level / trend smoothing
K_LOGIT = 8.0           # steepness of p = logistic(K * (ratio - 1))
ZWIN = 30               # rolling window for the z-score
ZMIN = 8                # samples before z-score is trusted
TENANT_MID = 0.5        # a tenant alone using 50% of host capacity is "overload"
QUEUE_SLOTS = 256.0     # same default as detector.Capacity.QueueSlots
MIN_TREND_FRAC = 0.01   # ignore trend smaller than 1% of capacity per second
STALE_S = 120           # evict tenants not seen for this many calls of step()
ETA_MAX = 30
STREAK = 3              # windows of rising trend before a forecast is trusted


def _logistic(x: float) -> float:
    if x < -40:
        return 0.0
    if x > 40:
        return 1.0
    return 1.0 / (1.0 + math.exp(-x))


class Holt:
    """Double exponential smoothing; ``forecast(h)`` = level + h * trend."""

    def __init__(self) -> None:
        self.level: float | None = None
        self.trend = 0.0

    def update(self, x: float) -> None:
        if self.level is None:
            self.level = x
            return
        prev = self.level
        self.level = ALPHA * x + (1 - ALPHA) * (prev + self.trend)
        self.trend = BETA * (self.level - prev) + (1 - BETA) * self.trend

    def forecast(self, h: float) -> float:
        return (self.level or 0.0) + h * self.trend


@dataclass
class _T:
    cost: Holt = field(default_factory=Holt)
    queue: Holt = field(default_factory=Holt)
    hist: deque = field(default_factory=lambda: deque(maxlen=ZWIN))
    seen: int = 0
    streak: int = 0  # consecutive windows with a material upward trend


@dataclass
class TenantPrediction:
    id: str
    p_overload: float
    top_factor: str
    eta_s: float | None


class Baseline:
    """Rolling per-tenant state: two Holt filters + last ``ZWIN`` cost values.

    The cache is bounded (tenants unseen for ``STALE_S`` steps are evicted) and
    rebuildable in ~10 s of traffic, so losing it on restart is harmless.
    """

    def __init__(self) -> None:
        self.state: dict[str, _T] = {}
        self.calls = 0

    def step(self, tenants: list[tuple[str, list[float]]], host: dict) -> tuple[float, list[TenantPrediction]]:
        self.calls += 1
        cap = float(host.get("capacity_cost_units_s") or 0.0)
        out: list[TenantPrediction] = []
        total_proj = 0.0
        for tid, feats in tenants:
            s = self.state.setdefault(tid, _T())
            s.seen = self.calls
            f = list(feats) + [0.0] * (len(FEATURE_NAMES) - len(feats))
            cost, queue = f[IDX_COST], f[IDX_QUEUE]
            z = _zscore(s.hist, cost)
            s.hist.append(cost)
            s.cost.update(cost)
            s.queue.update(queue)
            proj = max(0.0, s.cost.forecast(H))
            total_proj += proj
            out.append(self._tenant(tid, s, cap, proj, z))
        for tid in [t for t, s in self.state.items() if self.calls - s.seen > STALE_S]:
            del self.state[tid]
        return self._host(cap, total_proj, host), out

    def _tenant(self, tid: str, s: _T, cap: float, proj_cost: float, z: float) -> TenantPrediction:
        load_ratio = (proj_cost / cap) / TENANT_MID if cap > 0 else 0.0
        q_ratio = max(0.0, s.queue.forecast(H)) / QUEUE_SLOTS
        ratio = max(load_ratio, q_ratio)
        p = _logistic(K_LOGIT * (ratio - 1.0))
        # Anomaly modulates (never creates) an alert: a noisy-flat trace has
        # low ratio so p stays ~0 even when z is large.
        p *= 0.7 + 0.3 * _logistic(z - 2.0)
        rising = s.cost.trend > MIN_TREND_FRAC * cap if cap > 0 else s.cost.trend > 0
        s.streak = s.streak + 1 if rising else 0
        if s.streak < STREAK and q_ratio < 1.0:
            p *= 0.3  # a one-off blip of trend is not a ramp
        factors = {
            "cost_rate_trend": load_ratio,
            "queue_growth": q_ratio,
            "anomaly_zscore": _logistic(z - 2.0) * 0.5,
        }
        top = max(factors, key=factors.get) if p > 0.05 else "none"
        return TenantPrediction(tid, round(p, 4), top, self._eta(s, cap, ratio))

    def _eta(self, s: _T, cap: float, ratio: float) -> float | None:
        if cap <= 0:
            return None
        if max(max(0.0, s.cost.level or 0.0) / cap / TENANT_MID,
               max(0.0, s.queue.level or 0.0) / QUEUE_SLOTS) >= 1.0:
            return 0.0
        if s.cost.trend <= MIN_TREND_FRAC * cap and s.queue.trend <= 0:
            return None
        for h in range(1, ETA_MAX + 1):
            lr = max(0.0, s.cost.forecast(h)) / cap / TENANT_MID
            qr = max(0.0, s.queue.forecast(h)) / QUEUE_SLOTS
            if max(lr, qr) >= 1.0:
                return float(h)
        return None

    @staticmethod
    def _host(cap: float, total_proj: float, host: dict) -> float:
        r = max(float(host.get("cpu_util") or 0), float(host.get("mem_util") or 0),
                float(host.get("db_conn_util") or 0)) / 0.95
        if cap > 0:
            r = max(r, total_proj / cap)
        return round(_logistic(K_LOGIT * (r - 1.0)), 4)


def _zscore(hist: deque, x: float) -> float:
    if len(hist) < ZMIN:
        return 0.0
    n = len(hist)
    m = sum(hist) / n
    sd = math.sqrt(sum((v - m) ** 2 for v in hist) / n)
    if sd < 1e-9:
        return 0.0
    return (x - m) / sd
