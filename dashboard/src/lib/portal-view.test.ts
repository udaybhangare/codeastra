// Run: node --test src/lib/portal-view.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGauges, gaugeTone, planUsedRatio, recoveryRemaining, statusCopy, explainCause, showbackRows, toLevel, withinRange, whatYouCanDo } from "./portal-view.ts";
import type { UsageResp } from "./portal.ts";

const usage: UsageResp = {
  tenant_id: "t",
  tier: "pro",
  usage: { totals: { requests: 100, ok: 80, rejected: 20, cost_units: 4500, cpu_ms: 0 }, by_task: [], series: [] },
  quota: { cost_per_s: 100, rps: 50, concurrency: 8, cost_allowance: 9000, cost_used_pct: 50 },
};

test("gauges derive ratios from usage and live", () => {
  const g = buildGauges(usage, { rps: 40, inflight: 8 });
  assert.equal(g.length, 4);
  assert.equal(g[0].ratio, 0.5);
  assert.equal(g[1].ratio, 0.8);
  assert.equal(g[2].ratio, 1);
  assert.equal(g[3].ratio, 0.2);
  assert.equal(planUsedRatio(g), 1);
  assert.deepEqual(buildGauges(null, undefined), []);
});

test("gauge tone thresholds", () => {
  assert.equal(gaugeTone(0.79), "ok");
  assert.equal(gaugeTone(0.8), "warn");
  assert.equal(gaugeTone(1), "bad");
});

test("status copy is calm and level-aware", () => {
  assert.match(statusCopy(0, 34).headline, /34%/);
  assert.match(statusCopy(2, 120).headline, /slowed down/);
  assert.equal(statusCopy(4, 0).tone, "bad");
  assert.deepEqual(whatYouCanDo(0), []);
  assert.ok(whatYouCanDo(3).length > whatYouCanDo(1).length);
});

test("recovery countdown only runs after calm", () => {
  assert.equal(recoveryRemaining(null, 5000), null);
  assert.equal(recoveryRemaining(1000, 6000), 15);
  assert.equal(recoveryRemaining(1000, 99_000), 0);
});

test("explainCause handles strings and action objects", () => {
  const r = explainCause({ level: 2, explanation: " Too hot ", actions: ["slow", { kind: "cgroup.cpus", value: 0.5 } as unknown as string] });
  assert.equal(r.cause, "Too hot");
  assert.deepEqual(r.actions, ["slow", "CPU capped at 0.5 cores"]);
  assert.match(explainCause({ level: 1 }).cause, /fair share/);
});

test("showback shares sum to 1 and zero total is safe", () => {
  const base = { currency: "USD", subtotal: 0, tier_multiplier: 1, free_allowance_credit: 0, total: 0, disclaimer: "", by_task: [] };
  const rows = showbackRows({ ...base, lines: [{ label: "a", amount: 1 }, { item: "b", cost: 3 }] });
  assert.equal(rows[1].label, "b");
  assert.equal(rows[0].share + rows[1].share, 1);
  assert.equal(showbackRows({ ...base, lines: [{ label: "z", amount: 0 }] })[0].share, 0);
});

test("level + range helpers", () => {
  assert.equal(toLevel(9), 0);
  assert.equal(toLevel(3), 3);
  assert.deepEqual(withinRange([{ t: 0 }, { t: 9000 }], 10_000, 5), [{ t: 9000 }]);
});
