// Pure-function check for src/lib/hull.ts (no test runner in the repo). Run: node scripts/check-hull.mjs
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const dir = mkdtempSync(join(tmpdir(), "hull-"));
for (const f of ["ladder", "hull"]) {
  const src = readFileSync(new URL(`../src/lib/${f}.ts`, import.meta.url), "utf8");
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  writeFileSync(join(dir, `${f}.js`), out.outputText);
}
const { toHullTenants, displayUsage, layoutSlots, doorLevel } = require(join(dir, "hull.js"));

const snap = {
  type: "snapshot", ts: "2026-01-01T00:00:00Z", isolation: "on", host: { cpu_util: 0.4, mem_util: 0.3 },
  tenants: [
    { tenant_id: "a", tier: "free", level: 0, rps: 5, queue_depth: 10, p50_ms: 1, p95_ms: 2, p99_ms: 3, cpu_share: 0.03, mem_mb: 64 },
    { tenant_id: "b", tier: "pro", level: 3, rps: 90, queue_depth: 400, p50_ms: 1, p95_ms: 2, p99_ms: 9, cpu_share: 0.1, mem_mb: 100, p_overload: 0.8 },
  ],
};
const t = toHullTenants(snap);
assert.equal(t[0].usage, 0.25); // mem 64/256 beats cpu .03/.15=.2
assert.equal(t[1].usage, 1.2); // queue 400/100 clamps at 1.2
assert.equal(t[1].pOverload, 0.8);

assert.deepEqual(displayUsage([{ usage: 0.2 }, { usage: 1.1 }, { usage: 0.2 }], "on", 3), [0.2, 1.1, 0.2]);
const leaked = displayUsage([{ usage: 0.2 }, { usage: 1.1 }, { usage: 0.2 }], "off", 3);
assert.ok(leaked[0] > 0.2 && leaked[2] > 0.2 && leaked[1] === 1.1);
assert.equal(doorLevel("off", 5), 0);
assert.equal(doorLevel("on", 5), 5);
assert.equal(layoutSlots(5).rows, 1);
assert.equal(layoutSlots(8).rows, 2);
assert.equal(layoutSlots(8).slots.length, 8);
console.log("hull checks ok");
