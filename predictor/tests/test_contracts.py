"""Validate the frozen contracts and the mock stream's output against them."""
import json
import pathlib
import subprocess

import jsonschema
import yaml
from openapi_spec_validator import validate

ROOT = pathlib.Path(__file__).resolve().parents[2]
C = ROOT / "contracts"


def load(name):
    return json.loads((C / name).read_text())


def test_json_schemas_are_valid():
    for n in ["ws-messages.schema.json", "scenario.schema.json", "predict.schema.json"]:
        jsonschema.Draft202012Validator.check_schema(load(n))


def test_openapi_is_valid():
    validate(yaml.safe_load((C / "openapi.yaml").read_text()))


def test_mock_stream_messages_match_ws_schema():
    out = subprocess.run(
        ["go", "run", "./cmd/mockstream", "-print", "20"],
        cwd=ROOT / "platform", capture_output=True, text=True, check=True,
    ).stdout.splitlines()
    v = jsonschema.Draft202012Validator(load("ws-messages.schema.json"))
    msgs = [json.loads(line) for line in out]
    for m in msgs:
        v.validate(m)
    kinds = {m["type"] for m in msgs}
    assert {"snapshot", "event"} <= kinds


def test_predict_examples():
    s = load("predict.schema.json")
    reg = {"$ref": "#/$defs/response", "$defs": s["$defs"]}
    jsonschema.validate(
        {"p_overload_host": 0.2, "model": "baseline",
         "tenants": [{"id": "a", "p_overload": 0.1, "top_factor": "cost_units_s", "eta_s": None}]}, reg)
    req = {"$ref": "#/$defs/request", "$defs": s["$defs"]}
    jsonschema.validate({"ts": "2026-01-01T00:00:00Z", "tenants": [{"id": "a", "features": [1, 2]}], "host": {}}, req)
