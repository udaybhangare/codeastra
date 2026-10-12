"""FastAPI sidecar: POST /predict, GET /health, GET /state, POST /model/select."""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

import os

from .baseline import Baseline

app = FastAPI(title="Bulkhead predictor")
_baseline = Baseline()
_gbm = None  # loaded lazily from ml/artifacts; baseline stays the default
_selected = "baseline"


def _load_gbm():
    global _gbm
    if _gbm is None:
        from .gbm import GBM
        _gbm = GBM.load()
    return _gbm


def _active():
    return _load_gbm() if _selected == "gbm" else _baseline


if os.environ.get("PREDICTOR_MODEL") == "gbm":
    try:
        _load_gbm()
        _selected = "gbm"
    except Exception:  # missing artifact -> stay on baseline
        pass
_stats = {"requests": 0}


class Tenant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    features: list[float]
    feature_names: list[str] | None = None


class Host(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cpu_util: float | None = Field(None, ge=0, le=1)
    mem_util: float | None = Field(None, ge=0, le=1)
    db_conn_util: float | None = Field(None, ge=0, le=1)
    capacity_cost_units_s: float | None = Field(None, ge=0)


class PredictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ts: str
    tenants: list[Tenant]
    host: Host


class ModelSelect(BaseModel):
    model: str


@app.post("/predict")
def predict(req: PredictRequest) -> dict:
    _stats["requests"] += 1
    p_host, preds = _active().step(
        [(t.id, t.features) for t in req.tenants], req.host.model_dump(exclude_none=True))
    return {
        "p_overload_host": p_host,
        "model": _selected,
        "tenants": [
            {"id": p.id, "p_overload": p.p_overload, "top_factor": p.top_factor, "eta_s": p.eta_s}
            for p in preds
        ],
    }


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": _selected}


@app.get("/state")
def state() -> dict:
    return {"model": _selected, "healthy": True, "accuracy": {},
            "tenants_cached": len(_active().state), "requests": _stats["requests"]}


@app.post("/model/select")
def select(body: ModelSelect) -> dict:
    global _selected
    if body.model not in ("baseline", "gbm"):
        raise HTTPException(409, f"model {body.model!r} not available; use 'baseline' or 'gbm'")
    if body.model == "gbm":
        try:
            _load_gbm()
        except Exception as e:
            raise HTTPException(409, f"gbm artifact unavailable: {e}") from e
    _selected = body.model
    return {"model": _selected}
