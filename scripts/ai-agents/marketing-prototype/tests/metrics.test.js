/**
 * metrics.test.js — domain-rule unit tests: funnel math, dedup,
 * attribution, classification, pooling, header comparison.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { run } from "../src/index.js";

function gitBlobId(bytes) {
  const b = Buffer.from(bytes, "utf8");
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${b.length}\0`, "utf8"), b])).digest("hex");
}
function commitId(seed) {
  return createHash("sha1").update(`metrics-test|${seed}`).digest("hex");
}
function fx(fixture_id, kind, rows) {
  const obj = { fixture_id, kind, schema_version: "1", rows };
  const bytes = JSON.stringify(obj);
  return {
    bytes,
    source_ref: { repo: "t", path: `m/${fixture_id}.json`, commit: commitId(fixture_id), blob: gitBlobId(bytes), algorithm: "git-sha1", revision: "v1" },
  };
}

const TAX = [
  { entry: "tag", tag: "AWARENESS" },
  { entry: "tag", tag: "CONSIDERATION" },
  { entry: "tag", tag: "CONVERSION" },
  { entry: "template", template_id: "tpl-1", text: "DRAFT — NOT PUBLISHED\n{product_label}" },
  { entry: "template", template_id: "tpl-2", text: "DRAFT — NOT PUBLISHED\n{product_label}!" },
  { entry: "template", template_id: "tpl-3", text: "DRAFT — NOT PUBLISHED\n{product_label}?" },
];
const PERIOD = { start: "2026-10-01T00:00:00Z", end: "2026-10-08T00:00:00Z" };
const TS = "2026-10-02T12:00:00Z";
const camp = (id, tag) => ({ campaign_id: id, name: id, objective: { tag }, currency: "USD" });

function runCase({ campaigns, events = [], bindings = [], claims = [], complete = true, options = {}, refs = null }) {
  const fixtures = {
    "taxonomy-v1": fx("taxonomy-v1", "taxonomy", TAX),
    "campaigns-01": fx("campaigns-01", "campaigns", campaigns),
    "events-01": fx("events-01", "events", events),
  };
  if (bindings.length) fixtures["bindings-01"] = fx("bindings-01", "bindings", bindings);
  if (claims.length) fixtures["header-01"] = fx("header-01", "header_claims", claims);
  if (complete !== null) {
    fixtures["complete-01"] = fx("complete-01", "completeness", campaigns.map((c) => ({ campaign_id: c.campaign_id, complete })));
  }
  const refList = refs ?? [
    { fixture_id: "taxonomy-v1", kind: "taxonomy" },
    { fixture_id: "campaigns-01", kind: "campaigns" },
    { fixture_id: "events-01", kind: "events" },
    ...(bindings.length ? [{ fixture_id: "bindings-01", kind: "bindings" }] : []),
    ...(claims.length ? [{ fixture_id: "header-01", kind: "header_claims" }] : []),
    ...(complete !== null ? [{ fixture_id: "complete-01", kind: "completeness" }] : []),
  ];
  const task = {
    schema_version: "1",
    task_id: "metrics-unit",
    operation: "analyze",
    fixture_refs: refList,
    options: { period: { ...PERIOD }, mode: "event_rows", include_drafts: false, ...options },
  };
  const context = {
    clock: "2026-10-15T12:00:00Z",
    principal: { kind: "jason" },
    relays: [],
    grants: Object.keys(fixtures),
    fixtures,
  };
  return run(task, context);
}

const imp = (id, c) => ({ event_id: id, campaign_id: c, timestamp: TS, kind: "IMPRESSION" });

describe("funnel math", () => {
  it("CTR uses unique valid clicks over impressions", () => {
    const r = runCase({
      campaigns: [camp("a", "AWARENESS")],
      events: [imp("i1", "a"), imp("i2", "a"), { event_id: "c1", campaign_id: "a", timestamp: TS, kind: "CLICK" }],
    });
    const m = r.report.metrics[0];
    assert.equal(m.ctr.display, "50.00%");
    assert.deepEqual([m.ctr.numerator, m.ctr.denominator], ["1", "2"]);
  });

  it("conversion rate denominator is clicks, never impressions", () => {
    const r = runCase({
      campaigns: [camp("a", "CONVERSION")],
      events: [
        imp("i1", "a"),
        { event_id: "c1", campaign_id: "a", timestamp: TS, kind: "CLICK" },
        { event_id: "v1", campaign_id: "a", timestamp: TS, kind: "CONVERSION", conversion_id: "cv1" },
      ],
      bindings: [{ event_id: "v1", campaign_id: "a" }],
    });
    const m = r.report.metrics[0];
    assert.equal(m.conversion_rate.display, "100.00%"); // 1/1 clicks, not 1/2 impressions
  });

  it("zero denominators are typed UNDEFINED", () => {
    const r = runCase({ campaigns: [camp("a", "AWARENESS")], events: [] });
    const m = r.report.metrics[0];
    assert.equal(m.ctr.status, "UNDEFINED");
    assert.equal(m.ctr.display, "UNDEFINED");
    assert.equal(m.conversion_rate.status, "UNDEFINED");
    assert.equal(m.roas.status, "UNDEFINED");
  });
});

describe("classification", () => {
  it("recognizes the three taxonomy tags exactly", () => {
    const r = runCase({ campaigns: [camp("a", "AWARENESS"), camp("b", "CONSIDERATION"), camp("c", "CONVERSION")] });
    const cls = Object.fromEntries(r.report.campaigns.map((c) => [c.campaign_id, c.classification]));
    assert.deepEqual(cls, { a: "AWARENESS", b: "CONSIDERATION", c: "CONVERSION" });
  });
  it("unknown tags become UNKNOWN_TAG and are never forced", () => {
    const r = runCase({ campaigns: [camp("a", "awareness")] });
    assert.equal(r.report.campaigns[0].classification, "UNKNOWN_TAG");
  });
});

describe("attribution", () => {
  it("attributed revenue counts; unattributed does not", () => {
    const events = [
      { event_id: "s1", campaign_id: "a", timestamp: TS, kind: "SPEND", amount_minor: 1000 },
      { event_id: "r1", campaign_id: "a", timestamp: TS, kind: "REVENUE", amount_minor: 5000, conversion_id: "cv1" },
      { event_id: "r2", campaign_id: "a", timestamp: TS, kind: "REVENUE", amount_minor: 7000, conversion_id: "cv2" },
    ];
    const r = runCase({
      campaigns: [camp("a", "CONVERSION")],
      events,
      bindings: [{ event_id: "r1", campaign_id: "a" }], // r2 has no binding
    });
    const m = r.report.metrics[0];
    assert.equal(m.status, "UNAVAILABLE");
    assert.equal(m.revenue_minor, null);
    assert.equal(m.roas.status, "UNAVAILABLE");
    assert.equal(m.spend_minor, "1000"); // spend needs no attribution
  });
});

describe("pooling", () => {
  it("sums denominators instead of averaging rates", () => {
    const events = [];
    for (let i = 0; i < 5; i++) events.push(imp(`ia${i}`, "a"));
    events.push({ event_id: "ca", campaign_id: "a", timestamp: TS, kind: "CLICK" }); // 1/5 = 20%
    for (let i = 0; i < 15; i++) events.push(imp(`ib${i}`, "b"));
    for (let i = 0; i < 9; i++) events.push({ event_id: `cb${i}`, campaign_id: "b", timestamp: TS, kind: "CLICK" }); // 9/15 = 60%
    const r = runCase({
      campaigns: [camp("a", "AWARENESS"), camp("b", "AWARENESS")],
      events,
      options: { pool_groups: [["a", "b"]] },
    });
    const p = r.report.pooled[0];
    assert.equal(p.ctr.display, "50.00%"); // (1+9)/(5+15) = 50%, not mean 40%
  });
});

describe("header comparison", () => {
  it("compares exact values, not display strings", () => {
    // CTR 1/6 displays 16.67%; a claim of "16.67%" must MISMATCH the exact 1/6.
    const events = [];
    for (let i = 0; i < 6; i++) events.push(imp(`i${i}`, "a"));
    events.push({ event_id: "c1", campaign_id: "a", timestamp: TS, kind: "CLICK" });
    const r = runCase({
      campaigns: [camp("a", "AWARENESS")],
      events,
      claims: [{ claim_id: "cl1", campaign_id: "a", metric: "CTR", claimed_value: "16.67%" }],
    });
    assert.equal(r.report.header_comparisons[0].status, "MISMATCH");
    assert.ok(r.diagnostics.some((d) => d.code === "HEADER_MISMATCH"));
  });
});
