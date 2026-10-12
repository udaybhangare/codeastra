"""GBM challenger served behind the same ``step`` interface as Baseline."""
from __future__ import annotations

import json
import pathlib

import joblib

from .baseline import STALE_S, TenantPrediction
from .features import FACTOR, NAMES, FeatureWindow

ARTIFACT_DIR = pathlib.Path(__file__).resolve().parents[1] / "ml" / "artifacts"


class GBM:
    def __init__(self, model, meta: dict) -> None:
        self.model = model
        self.meta = meta
        self.state: dict[str, tuple[FeatureWindow, int]] = {}
        self.calls = 0
        assert meta["features"] == NAMES, "artifact feature list does not match app.features.NAMES"
        self._mean, self._std = meta["mean"], meta["std"]
        self._imp = meta["importance"]

    @classmethod
    def load(cls, directory: pathlib.Path = ARTIFACT_DIR) -> "GBM":
        meta = json.loads((directory / "meta.json").read_text())
        return cls(joblib.load(directory / "gbm.joblib"), meta)

    def step(self, tenants: list[tuple[str, list[float]]], host: dict):
        self.calls += 1
        rows, wins = [], []
        for tid, feats in tenants:
            w = self.state.get(tid, (FeatureWindow(), 0))[0]
            self.state[tid] = (w, self.calls)
            rows.append(w.push(feats, host))
            wins.append(tid)
        for t in [t for t, (_, seen) in self.state.items() if self.calls - seen > STALE_S]:
            del self.state[t]
        if not rows:
            return 0.0, []
        probs = self.model.predict_proba(rows)[:, 1]
        out = []
        for tid, x, p in zip(wins, rows, probs):
            out.append(TenantPrediction(tid, round(float(p), 4), self._top(x, p), None))
        return round(float(max(probs)), 4), out

    def _top(self, x: list[float], p: float) -> str:
        if p <= 0.05:
            return "none"
        best, score = "none", 0.0
        for i, n in enumerate(NAMES):
            s = abs(x[i] - self._mean[i]) / (self._std[i] or 1.0) * self._imp[i]
            if s > score:
                best, score = FACTOR.get(n, n), s
        return best
