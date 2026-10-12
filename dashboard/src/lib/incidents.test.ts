// Run: node --test src/lib/incidents.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { axisTicks, buildLanes, DEFAULT_FILTER, filterEvents, fitView, groupIncidents, mean, zoomView } from "./incidents.ts";
import type { Level, StreamEvent } from "./ws-types.ts";

const T0 = Date.parse("2026-01-01T00:00:00Z");
const ev = (tenant: string, sec: number, to: Level, kind: StreamEvent["kind"] = "throttle"): StreamEvent => ({
  type: "event",
  ts: new Date(T0 + sec * 1000).toISOString(),
  kind,
  tenant_id: tenant,
  from_level: 0,
  to_level: to,
  message: "m",
});

test("filterEvents applies tenant, level, kind and range; newest first", () => {
  const all = [ev("a", 0, 1), ev("b", 100, 3), ev("a", 200, 5), ev("a", 210, 3, "predict")];
  const anchor = T0 + 210_000;
  assert.deepEqual(filterEvents(all, DEFAULT_FILTER, anchor).map((e) => e.ts.slice(14, 19)), ["03:30", "03:20", "01:40", "00:00"]);
  assert.equal(filterEvents(all, { ...DEFAULT_FILTER, tenant: "a" }, anchor).length, 3);
  assert.equal(filterEvents(all, { ...DEFAULT_FILTER, minLevel: 5 }, anchor).length, 1);
  assert.equal(filterEvents(all, { ...DEFAULT_FILTER, kind: "predict" }, anchor).length, 1);
  assert.equal(filterEvents(all, { ...DEFAULT_FILTER, range: "1m" }, anchor).length, 2);
});

test("buildLanes makes dwell segments that skip predicted events and extend to now", () => {
  const lanes = buildLanes([ev("a", 10, 1), ev("a", 20, 3), ev("a", 25, 3, "predict"), ev("b", 5, 2)], T0 + 60_000);
  assert.deepEqual(lanes.map((l) => l.tenant), ["a", "b"]);
  const a = lanes[0];
  assert.equal(a.events.length, 3);
  assert.deepEqual(a.segments.map((s) => [s.level, (s.to - s.from) / 1000]), [[1, 10], [3, 40]]);
});

test("groupIncidents orders by recent activity and reports peak/active", () => {
  const g = groupIncidents([ev("a", 0, 3), ev("a", 30, 0), ev("b", 10, 2)]);
  assert.deepEqual(g.map((i) => i.culprit), ["a", "b"]);
  assert.equal(g[0].peak, 3);
  assert.equal(g[0].active, false);
  assert.equal(g[1].active, true);
});

test("fitView covers events and zoomView keeps the focus time fixed", () => {
  const v = fitView([ev("a", 0, 1), ev("a", 120, 3)], T0 + 120_000);
  assert.ok(v.start <= T0 && v.start + v.span >= T0 + 120_000);
  const z = zoomView({ start: 1000, span: 100_000 }, 0.5, 0.25, 1e9);
  assert.equal(z.span, 50_000);
  assert.equal(z.start + z.span * 0.25, 1000 + 100_000 * 0.25);
  assert.equal(zoomView({ start: 0, span: 6000 }, 0.1, 0.5, 1e9).span, 5000);
});

test("axisTicks stays in the window and is bounded", () => {
  const t = axisTicks({ start: T0, span: 90_000 });
  assert.ok(t.length >= 2 && t.length <= 8);
  assert.ok(t.every((x) => x >= T0 && x <= T0 + 90_000));
});

test("mean handles empty", () => {
  assert.equal(mean([]), undefined);
  assert.equal(mean([2, 4]), 3);
});
