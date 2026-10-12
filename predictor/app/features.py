"""Causal feature builder shared by training, eval and serving (docs/07).

``FeatureWindow.push`` consumes one 1-second raw vector and returns the model
features computed from samples <= now only, so a label that looks ahead can
never leak into the inputs.
"""
from __future__ import annotations

import math
from collections import deque

from .baseline import FEATURE_NAMES

QUEUE_SLOTS = 256.0
LONG = 30
HOST_NAMES = ["host_cpu", "host_mem", "host_db"]
DERIVED = [
    "cost_frac", "d1_cost", "d2_cost", "d1_queue", "mean5_cost", "mean30_cost",
    "max10_cost", "z_cost", "slope5_cost", "rate_ratio", "queue_frac",
]
NAMES = FEATURE_NAMES + DERIVED + HOST_NAMES

# Human-readable factor per feature, used for ``top_factor``.
FACTOR = {n: "cost_rate_trend" for n in
          ["cost_units_s", "cost_frac", "d1_cost", "d2_cost", "mean5_cost", "mean30_cost",
           "max10_cost", "slope5_cost", "rate", "rate_ratio"]}
FACTOR.update({n: "queue_growth" for n in
               ["queue_depth", "queue_wait_p95", "d1_queue", "queue_frac", "rejections_s", "exec_p95"]})
FACTOR.update({"z_cost": "anomaly_zscore", "cpu_share": "cpu_pressure", "mem_share": "memory_pressure",
               "host_mem": "memory_pressure", "host_cpu": "cpu_pressure", "db_conns": "db_conn_pressure",
               "host_db": "db_conn_pressure", "bytes_s": "bandwidth"})


class FeatureWindow:
    def __init__(self) -> None:
        self.cost: deque[float] = deque(maxlen=LONG)
        self.rate: deque[float] = deque(maxlen=LONG)
        self.queue_prev = 0.0

    def push(self, raw: list[float], host: dict) -> list[float]:
        f = list(raw)[: len(FEATURE_NAMES)]
        f += [0.0] * (len(FEATURE_NAMES) - len(f))
        rate, cost, queue = f[0], f[1], f[2]
        cap = float(host.get("capacity_cost_units_s") or 0.0) or 1.0
        h = list(self.cost)
        prev = h[-1] if h else cost
        prev2 = h[-2] if len(h) > 1 else prev
        d1, d2 = cost - prev, (cost - prev) - (prev - prev2)
        last5 = (h + [cost])[-5:]
        last10 = (h + [cost])[-10:]
        allc = h + [cost]
        m30 = sum(allc) / len(allc)
        sd = math.sqrt(sum((v - m30) ** 2 for v in allc) / len(allc))
        z = (cost - m30) / sd if len(allc) >= 8 and sd > 1e-9 else 0.0
        slope5 = (last5[-1] - last5[0]) / max(1, len(last5) - 1)
        rmean = (sum(self.rate) / len(self.rate)) if self.rate else rate
        d_queue = queue - self.queue_prev
        self.cost.append(cost)
        self.rate.append(rate)
        self.queue_prev = queue
        derived = [
            cost / cap, d1 / cap, d2 / cap, d_queue / QUEUE_SLOTS, (sum(last5) / len(last5)) / cap,
            m30 / cap, max(last10) / cap, z, slope5 / cap, rate / rmean if rmean > 1e-9 else 1.0,
            queue / QUEUE_SLOTS,
        ]
        hostv = [float(host.get("cpu_util") or 0), float(host.get("mem_util") or 0),
                 float(host.get("db_conn_util") or 0)]
        return f + derived + hostv
