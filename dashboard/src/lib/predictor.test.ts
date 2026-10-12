// Run: node --test src/lib/predictor.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { alertSpans, analyzeAlerts, featureBars, pushForecast, seriesFor, type ForecastPoint } from "./predictor.ts";
import type { StreamEvent } from "./ws-types.ts";

const pt = (s: number, p?: number): ForecastPoint => ({ ts: s * 1000, host: { cpu: 0.2 }, t: { noisy: { p, p99: 10 + s } } });
const esc = (s: number, from = 0, to = 1): StreamEvent => ({ type: "event", ts: new Date(s * 1000).toISOString(), kind: "throttle", tenant_id: "noisy", from_level: from as 0, to_level: to as 1, message: "" });

test("pushForecast caps length and ignores duplicate timestamps", () => {
  let b: ForecastPoint[] = [];
  for (let i = 0; i < 5; i++) b = pushForecast(b, pt(i, 0), 3);
  assert.equal(b.length, 3);
  assert.equal(pushForecast(b, pt(4, 0), 3), b);
});

test("alertSpans needs a sustained crossing", () => {
  const rows = seriesFor([0, 0.1, 0.7, 0.9, 0.8, 0.1, 0.7, 0.1].map((p, i) => pt(i, p)), "noisy");
  assert.deepEqual(alertSpans(rows), []);
  assert.deepEqual(alertSpans(rows, 0.6, 2000), [{ from: 2000, to: 4000 }]);
  assert.equal(alertSpans(rows, 0.6, 0).length, 2);
});

test("lead time = threshold crossing to escalation; unwarned and no-follow-up are counted", () => {
  const buf = [0, 0, 0.7, 0.8, 0.9, 0.9, 0.2, 0, 0, 0].map((p, i) => pt(i, p));
  const r = analyzeAlerts(buf, [esc(5)], ["noisy"]);
  assert.equal(r.leads[0].leadS, 3);
  assert.equal(r.actedOn, 1);
  assert.equal(r.noFollowUp, 0);
  const none = analyzeAlerts(buf, [], ["noisy"]);
  assert.equal(none.noFollowUp, 1);
  const surprise = analyzeAlerts(buf.map((p) => ({ ...p, t: { noisy: { p: 0, p99: 1 } } })), [esc(5)], ["noisy"]);
  assert.equal(surprise.unwarned, 1);
  assert.equal(surprise.leads.length, 0);
});

test("featureBars normalises and drops junk", () => {
  assert.deepEqual(featureBars(undefined), []);
  const b = featureBars({ a: 2, b: 4, c: "x", d: 0 });
  assert.deepEqual(b, [{ name: "b", value: 1 }, { name: "a", value: 0.5 }]);
});
