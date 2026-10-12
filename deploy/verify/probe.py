#!/usr/bin/env python3
"""Tiny open-loop prober: probe.py TENANT TASK RPS SECONDS [PARAMS_JSON] -> one JSON line.
Env: BASE, KEYS (json tenant->key). Counts HTTP codes and latency percentiles (ms)."""
import json, os, sys, time, threading, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
tenant, task, rps, secs = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
params = sys.argv[5] if len(sys.argv) > 5 else "{}"
base = os.environ.get("BASE", "http://127.0.0.1:8080")
key = json.load(open(os.environ["KEYS"]))[tenant]
def call(req, timeout):
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception:
        return 0, b""
st, body = call(urllib.request.Request(base + "/v1/auth/token", method="POST", headers={"X-API-Key": key}), 10)
tok = json.loads(body)["token"]
lat, codes, lock = [], {}, threading.Lock()
def one():
    t0 = time.monotonic()
    c, _ = call(urllib.request.Request(base + "/v1/invoke/" + task, data=params.encode(), method="POST",
        headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"}), 70)
    ms = (time.monotonic() - t0) * 1000
    with lock:
        codes[str(c)] = codes.get(str(c), 0) + 1
        if c == 200: lat.append(ms)
n = int(rps * secs); start = time.monotonic()
with ThreadPoolExecutor(max_workers=256) as ex:
    for i in range(n):
        d = start + i / rps - time.monotonic()
        if d > 0: time.sleep(d)
        ex.submit(one)
lat.sort()
q = lambda p: round(lat[min(len(lat) - 1, int(p * len(lat)))], 1) if lat else None
print(json.dumps({"tenant": tenant, "task": task, "sent": n, "codes": codes, "ok": codes.get("200", 0), "p50_ms": q(.5), "p99_ms": q(.99)}))
