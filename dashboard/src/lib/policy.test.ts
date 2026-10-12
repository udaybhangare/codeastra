// Run: node --test src/lib/policy.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRows, diffPolicy, policyPatch, presetDraft, quotaUsage, sortRows, validatePolicy } from "./policy.ts";
import type { TenantMetrics } from "./ws-types.ts";

const met = (id: string, o: Partial<TenantMetrics> = {}): TenantMetrics => ({
  tenant_id: id, tier: "free", level: 0, rps: 5, queue_depth: 0, p50_ms: 10, p95_ms: 20, p99_ms: 30, cpu_share: 0.1, mem_mb: 64, ...o,
});

test("diff lists only changed fields with units, patch carries only those keys", () => {
  const a = presetDraft("pro");
  const b = { ...a, limit_cpu: 1, bandwidth_bps: 4 << 20 };
  const d = diffPolicy(a, b);
  assert.deepEqual(d.map((c) => c.key), ["limit_cpu", "bandwidth_bps"]);
  assert.equal(d[0].from, "1.50 cores");
  assert.equal(d[0].to, "1.00 cores");
  assert.equal(d[1].to, "4 MB/s");
  assert.deepEqual(policyPatch(a, b), { limit_cpu: 1, bandwidth_bps: 4 << 20 });
  assert.deepEqual(policyPatch(a, a), {});
});

test("tier change shows up first in diff and patch", () => {
  const d = diffPolicy(presetDraft("free"), presetDraft("pro"));
  assert.equal(d[0].key, "tier");
  assert.equal(policyPatch(presetDraft("free"), presetDraft("pro")).tier, "pro");
});

test("validate mirrors backend rules", () => {
  assert.deepEqual(validatePolicy(presetDraft("free")), []);
  const bad = { ...presetDraft("free"), reserve_cpu: 1, limit_cpu: 0.5, burst: 0 };
  assert.equal(validatePolicy(bad).length, 2);
});

test("buildRows prefers API policy, falls back to preset, sorted by id", () => {
  const api = [{ id: "b", tier: "pro" as const, policy: { ...presetDraft("pro"), limit_cpu: 2 } }];
  const rows = buildRows(api, [met("c"), met("b", { tier: "pro", level: 2 })]);
  assert.deepEqual(rows.map((r) => [r.id, r.source, r.level]), [["b", "api", 2], ["c", "preset", 0]]);
  assert.equal(rows[0].policy.limit_cpu, 2);
  assert.equal(buildRows(null, []).length, 0);
});

test("quotaUsage picks the binding resource; sortRows is stable and directional", () => {
  const rows = buildRows(null, [met("a", { rps: 9 }), met("b", { rps: 1, mem_mb: 250 }), met("c", { rps: 2 })]);
  assert.equal(quotaUsage(rows[0]).resource, "rate");
  assert.equal(quotaUsage(rows[1]).resource, "memory");
  assert.deepEqual(sortRows(rows, "quota", -1).map((r) => r.id), ["b", "a", "c"]);
  assert.deepEqual(sortRows(rows, "tenant", -1).map((r) => r.id), ["c", "b", "a"]);
});
