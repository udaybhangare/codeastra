// Run: node --test src/lib/overview.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTenants, delta, pushCapped, trackLevels, whyEvent, RESOURCES, tankFill } from "./overview.ts";
import type { Snapshot, StreamEvent, TenantMetrics } from "./ws-types.ts";

const tenant = (id: string, over: Partial<TenantMetrics> = {}): TenantMetrics => ({
  tenant_id: id,
  tier: "pro",
  level: 0,
  rps: 10,
  queue_depth: 0,
  p50_ms: 10,
  p95_ms: 20,
  p99_ms: 30,
  cpu_share: 0.15,
  mem_mb: 256,
  ...over,
});
const snap = (tenants: TenantMetrics[]): Snapshot => ({
  type: "snapshot",
  ts: "2026-01-01T00:00:00Z",
  isolation: "on",
  host: { cpu_util: 0.5, mem_util: 0.4 },
  tenants,
});

test("pushCapped drops the oldest point", () => {
  assert.deepEqual(pushCapped([1, 2, 3], 4, 3), [2, 3, 4]);
  assert.deepEqual(pushCapped([], 1, 3), [1]);
});

test("delta compares against lagged value", () => {
  assert.equal(delta([1]), undefined);
  assert.equal(delta([1, 2, 5], 1), 3);
  assert.equal(delta([1, 2, 5], 10), 4);
});

test("classifyTenants: throttled = culprit, inflated unthrottled = victim", () => {
  const hist = [{ ts: 0, a: 30, b: 30 }, { ts: 1, a: 200, b: 32 }];
  const r = classifyTenants(hist, snap([tenant("a", { p99_ms: 200 }), tenant("b", { level: 3 })]));
  assert.deepEqual([...r.victims], ["a"]);
  assert.deepEqual([...r.culprits], ["b"]);
});

test("trackLevels keeps `since` while the level holds", () => {
  const s1 = trackLevels({}, snap([tenant("a")]), 100);
  const s2 = trackLevels(s1, snap([tenant("a")]), 200);
  assert.equal(s2, s1);
  const s3 = trackLevels(s2, snap([tenant("a", { level: 2 })]), 300);
  assert.deepEqual(s3.a, { level: 2, since: 300 });
});

test("whyEvent prefers the decision that reached the current level", () => {
  const ev = (to: 1 | 2): StreamEvent => ({ type: "event", ts: String(to), kind: "throttle", tenant_id: "a", to_level: to, message: "" });
  const events = [ev(1), ev(2)];
  assert.equal(whyEvent(events, "a", 2)?.to_level, 2);
  assert.equal(whyEvent(events, "a", 3)?.to_level, 1);
  assert.equal(whyEvent(events, "zzz", 1), undefined);
});

test("resource ratios use tier entitlement", () => {
  const t = tenant("a", { cpu_share: 0.6 });
  assert.equal(RESOURCES[0].ratio(t), 2);
  assert.equal(tankFill(2), 1);
  assert.equal(tankFill(-1), 0);
});
