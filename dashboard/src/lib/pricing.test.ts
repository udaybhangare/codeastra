// Run: node --test src/lib/pricing.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimate, recommend } from "./pricing.ts";

test("team: base fee per node, no overage inside the included credits", () => {
  const e = estimate("team", 2, 50, "medium"); // 2*50*25k = 2.5M <= 10M
  assert.equal(e.baseCost, 1000);
  assert.equal(e.overagePacks, 0);
  assert.equal(e.total, 1000);
});

test("team: overage rounds up to whole 1M packs", () => {
  const e = estimate("team", 1, 100, "heavy"); // 10M used, 5M included -> 5M over
  assert.equal(e.overagePacks, 5);
  assert.equal(e.total, 500 + 5 * 30);
  const e2 = estimate("team", 1, 51, "heavy"); // 5.1M -> 0.1M over -> 1 pack
  assert.equal(e2.overagePacks, 1);
});

test("community: free when inside caps, does not fit beyond them", () => {
  assert.equal(estimate("community", 1, 5, "light").fits, true);
  assert.equal(estimate("community", 1, 5, "light").total, 0);
  assert.equal(estimate("community", 2, 5, "light").fits, false);
  assert.equal(estimate("community", 1, 6, "light").fits, false);
  assert.equal(estimate("community", 1, 5, "heavy").fits, false); // 500k > 100k and no overage sold
});

test("recommend: community when it fits, otherwise team", () => {
  assert.equal(recommend(1, 5, "light").plan, "community");
  assert.equal(recommend(3, 40, "medium").plan, "team");
});
