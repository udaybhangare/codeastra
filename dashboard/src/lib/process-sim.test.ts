// Run: node --test src/lib/process-sim.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { maxMinFair, ProcessSim, summarize, DURATION_S } from "./process-sim.ts";
import type { Isolation } from "./ws-types.ts";

function run(scenario: string, iso: Isolation, seed = 42) {
  const sim = new ProcessSim(scenario, seed, iso);
  while (!sim.done) sim.step(500);
  return { state: sim.snapshot(), sum: summarize(sim.snapshot()) };
}

test("maxMinFair gives small wants in full and splits the rest by weight", () => {
  const a = maxMinFair(60, [10, 100, 100], [1, 1, 1]);
  assert.deepEqual(a.map(Math.round), [10, 25, 25]);
});

test("same seed is deterministic; run lasts the full duration", () => {
  const a = run("S1", "on").state;
  const b = run("S1", "on").state;
  assert.equal(a.tS >= DURATION_S - 1e-6, true);
  assert.deepEqual(a.tenants, b.tenants);
});

test("S1 CPU flood: victims inflate badly OFF, stay near baseline ON, rogue reaches L3", () => {
  const off = run("S1", "off").sum;
  const on = run("S1", "on");
  assert.ok(off.victimInflation > 3, `off ${off.victimInflation}`);
  assert.ok(on.sum.victimInflation <= 1.5, `on ${on.sum.victimInflation}`);
  assert.equal(on.state.tenants.find((t) => t.id === "rogue-ml")?.peakLevel, 3);
});

test("S6 flash crowd within contract is never throttled", () => {
  const on = run("S6", "on").sum;
  assert.equal(on.falsePositives, 0);
});

test("S2 memory bomb: ON kills only the rogue; OFF takes everyone down", () => {
  const on = run("S2", "on").sum;
  assert.equal(on.victimKills, 0);
  assert.ok(on.abuserKills > 0);
  assert.equal(on.victimErrors, 0);
  const off = run("S2", "off").sum;
  assert.ok(off.victimKills > 0);
});

test("S4 retry storm and S7 multi-abuser are contained ON", () => {
  assert.ok(run("S4", "on").sum.victimInflation <= 2);
  assert.ok(run("S7", "on").sum.victimInflation <= 1.5);
});

test("S3 db hog and S8 bandwidth flood hurt OFF but not ON", () => {
  for (const s of ["S3", "S8"]) {
    assert.ok(run(s, "off").sum.victimInflation > run(s, "on").sum.victimInflation, s);
  }
});
