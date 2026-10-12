// Run: node --test src/lib/audit.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_AUDIT_FILTER, filterAudit, fromApi, mergeEvents, toCsv, windowRows } from "./audit.ts";
import type { StreamEvent } from "./ws-types.ts";

const ev = (ts: string, tenant: string, o: Partial<StreamEvent> = {}): StreamEvent => ({ type: "event", ts, kind: "throttle", tenant_id: tenant, from_level: 0, to_level: 1, message: "m", ...o });

test("mergeEvents dedupes stream vs REST copies of one decision and sorts newest first", () => {
  const s = [ev("2026-01-01T00:00:10.500Z", "a", { actor: "detector" })];
  const r = [fromApi({ id: 1, ts: "2026-01-01T00:00:10Z", tenant_id: "a", from_level: 0, to_level: 1, reason: "DETECTED" }), fromApi({ id: 2, ts: "2026-01-01T00:00:20Z", tenant_id: "b", from_level: 1, to_level: 2, reason: "X" })];
  const m = mergeEvents(s, r);
  assert.equal(m.length, 2);
  assert.equal(m[0].tenant_id, "b");
  assert.equal(m[1].actor, "detector");
});

test("filterAudit: kind, tenant, search and range relative to anchor", () => {
  const a = ev("2026-01-01T00:10:00Z", "acme", { message: "Hard throttle" });
  const b = ev("2026-01-01T00:00:00Z", "noisy", { kind: "oom", actor: "admin" });
  const anchor = Date.parse(a.ts);
  assert.equal(filterAudit([a, b], { ...DEFAULT_AUDIT_FILTER, range: "5m" }, anchor).length, 1);
  assert.equal(filterAudit([a, b], { ...DEFAULT_AUDIT_FILTER, kind: "oom" }, anchor)[0], b);
  assert.equal(filterAudit([a, b], { ...DEFAULT_AUDIT_FILTER, q: "HARD" }, anchor)[0], a);
  assert.equal(filterAudit([a, b], { ...DEFAULT_AUDIT_FILTER, actor: "admin" }, anchor)[0], b);
});

test("toCsv quotes commas and neutralises formulas", () => {
  const csv = toCsv([ev("2026-01-01T00:00:00Z", "a", { message: '=SUM(1,2) "x"' })]);
  assert.match(csv.split("\n")[1], /"'=SUM\(1,2\) ""x"""$/);
});

test("windowRows returns the visible slice with padding that preserves total height", () => {
  const h = Array(100).fill(50);
  const w = windowRows(h, 1000, 200, 2);
  assert.deepEqual([w.start, w.end], [17, 26]);
  assert.equal(w.padTop + (w.end - w.start) * 50 + w.padBottom, 5000);
});
