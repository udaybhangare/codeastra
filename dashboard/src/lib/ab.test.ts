// Run: node --test src/lib/ab.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { bigRatio, changeLabel, deltaRows, doorStates, phaseMarks, sharedYMax, verdict } from "./ab.ts";
import { METRICS, type RunBundle } from "./runs.ts";

const infl = METRICS.find((m) => m.key === "victim_p99_inflation")!;
const jain = METRICS.find((m) => m.key === "jain")!;

test("deltaRows marks the better side per metric direction", () => {
  const rows = deltaRows({ victim_p99_inflation: 30, jain: 0.4, victim_errors: 5 }, { victim_p99_inflation: 1.2, jain: 0.9, victim_errors: 5 });
  assert.equal(rows.find((r) => r.def.key === "victim_p99_inflation")?.better, "on");
  assert.equal(rows.find((r) => r.def.key === "jain")?.better, "on");
  assert.equal(rows.find((r) => r.def.key === "victim_errors")?.better, "same");
});

test("verdict prefers the headline metric, falls back to majority, ties", () => {
  assert.equal(verdict({ victim_p99_inflation: 9, jain: 0.9 }, { victim_p99_inflation: 1, jain: 0.5 }).winner, "on");
  assert.equal(verdict({ jain: 0.4, victim_errors: 9 }, { jain: 0.8, victim_errors: 1 }).winner, "on");
  assert.equal(verdict({ jain: 0.8 }, { jain: 0.8 }).winner, "tie");
  assert.equal(verdict({ victim_p99_inflation: 1 }, { victim_p99_inflation: 3 }).winner, "off");
});

test("bigRatio compacts runaway values", () => {
  assert.equal(bigRatio(1.234), "1.23×");
  assert.equal(bigRatio(29199.1), "29.2k×");
  assert.equal(bigRatio(2_500_000), "2.5M×");
});

test("changeLabel", () => {
  assert.equal(changeLabel(infl, 30, 1.5), "−95%");
  assert.equal(changeLabel(jain, 0.4, 0.9), "+0.50");
  assert.equal(changeLabel(infl, 5, 5), null);
  assert.equal(changeLabel(infl, 10000, 3), null);
  assert.equal(changeLabel(infl, undefined, 3), null);
});

test("sharedYMax / phaseMarks / doorStates", () => {
  const b: RunBundle = { run_id: "r", scenario: "S1", isolation: "on", summary: {}, series: [{ t: 0, phase: "warmup", a: 5 }, { t: 5, phase: "attack", a: 40, b: 12 }, { t: 9, phase: "attack", a: 3 }] };
  assert.equal(sharedYMax([b]), 40);
  assert.deepEqual(phaseMarks(b.series), [{ t: 0, phase: "warmup" }, { t: 5, phase: "attack" }]);
  assert.deepEqual(doorStates("attack"), ["done", "active", "pending"]);
  assert.deepEqual(doorStates(null), ["pending", "pending", "pending"]);
  assert.deepEqual(doorStates("warmup", true), ["done", "done", "done"]);
});
