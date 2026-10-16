/**
 * fixround6.test.js — public-run regression test for the M640-011
 * null source_ref crash (fix round 6, 2026-10-16).
 *
 * The round-5 own-descriptor-only admission added getDataDescriptor(),
 * which calls Object.getOwnPropertyDescriptor(obj, key) directly. The
 * source_ref guard checked only `typeof sourceRef !== "object"`, so null
 * passed (typeof null === "object") and the identity-field loop threw
 * TypeError: Cannot convert undefined or null to object — escaping
 * run() instead of producing the required structured
 * REFUSED/complete:false/empty-domain result. The prior reviewed head
 * e26199f returned REFUSED/INVALID_INPUT for the identical input, so
 * this is a regression in the narrow own-descriptor change.
 *
 * Fix: reject null/non-object source metadata explicitly BEFORE
 * descriptor inspection, and make getDataDescriptor null-safe
 * (returns undefined for nullish input = structurally absent).
 * Own-only access, grant-first ordering and zero accessor invocation
 * are preserved; no prototype fallback.
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
  return createHash("sha1").update(`fr6|${seed}`).digest("hex");
}

const PERIOD = { start: "2026-10-01T00:00:00Z", end: "2026-10-08T00:00:00Z" };
const TAX_ROWS = [
  { entry: "tag", tag: "AWARENESS" },
  { entry: "template", template_id: "tpl-1", text: "DRAFT — NOT PUBLISHED\n{product_label} {benefit} {cta}" },
  { entry: "template", template_id: "tpl-2", text: "DRAFT — NOT PUBLISHED\n{product_label}!" },
  { entry: "template", template_id: "tpl-3", text: "DRAFT — NOT PUBLISHED\n{product_label}?" },
  { entry: "cta", cta_id: "cta-1", text: "Learn more" },
];

function fx(fixture_id, kind, rows) {
  const obj = { fixture_id, kind, schema_version: "1", rows };
  const bytes = JSON.stringify(obj);
  return {
    bytes,
    source_ref: { repo: "t", path: `m/${fixture_id}.json`, commit: commitId(fixture_id), blob: gitBlobId(bytes), algorithm: "git-sha1", revision: "v1" },
  };
}

function registryFor(fixtures) {
  return Object.fromEntries(
    Object.entries(fixtures).map(([fid, e]) => [fid, { ...e.source_ref }])
  );
}

function baseFixtures() {
  return {
    "taxonomy-v1": fx("taxonomy-v1", "taxonomy", TAX_ROWS),
    "campaigns-01": fx("campaigns-01", "campaigns", [
      { campaign_id: "camp-a", name: "A", objective: { tag: "AWARENESS" }, currency: "USD" },
    ]),
    "complete-01": fx("complete-01", "completeness", [{ campaign_id: "camp-a", complete: true }]),
    "agg-01": fx("agg-01", "aggregate_counts", [
      { campaign_id: "camp-a", period_start: PERIOD.start, period_end: PERIOD.end, currency: "USD",
        impressions: 100, clicks: 5, conversions: 1, spend_minor: 1000, revenue_minor: 5000 },
    ]),
  };
}

function baseTask(fixtureRefs, opts = {}) {
  return {
    schema_version: "1",
    task_id: "fr6-test",
    operation: "analyze",
    fixture_refs: fixtureRefs,
    options: { period: { ...PERIOD }, mode: "aggregate_counts", include_drafts: false, ...opts },
  };
}

// Build the context literally (never baseContext(), which would run
// registryFor() over the tampered fixtures). The registry is the host's
// independently retained full SourceRef tuple.
function contextFor(fixtures, registry, grants) {
  return {
    clock: "2026-10-15T12:00:00Z",
    principal: { kind: "jason" },
    relays: [],
    grants: grants ?? Object.keys(fixtures),
    fixtures,
    source_registry: registry,
  };
}

const ALL_REFS = [
  { fixture_id: "taxonomy-v1", kind: "taxonomy" },
  { fixture_id: "campaigns-01", kind: "campaigns" },
  { fixture_id: "complete-01", kind: "completeness" },
  { fixture_id: "agg-01", kind: "aggregate_counts" },
];

function assertRefusal(result, code) {
  assert.equal(result.status, "REFUSED");
  assert.ok(
    result.diagnostics.some((d) => d.code === code),
    `expected ${code}, got: ` + JSON.stringify(result.diagnostics.map((d) => d.code))
  );
  assert.equal(result.complete, false, "refusal must have complete:false");
  assert.deepEqual(result.report.campaigns, [], "refusal carries no partial domain output");
  assert.deepEqual(result.report.metrics, [], "refusal carries no partial domain output");
}

describe("M640-011 round 6: null source_ref crash regression", () => {
  it("verdict probe: source_ref:null => structured REFUSED (never throws)", () => {
    const fixtures = baseFixtures();
    const registry = registryFor(fixtures); // host-retained, unaffected
    fixtures["agg-01"].source_ref = null; // tampered AFTER registry capture
    const context = contextFor(fixtures, registry);
    // On the regressed head this THREW TypeError out of run(); the fix
    // must return a structured refusal instead.
    let result;
    assert.doesNotThrow(() => { result = run(baseTask(ALL_REFS), context); }, "run() must never throw on null source_ref");
    assertRefusal(result, "READ_DENIED");
  });

  it("source_ref:undefined (missing) => structured REFUSED", () => {
    const fixtures = baseFixtures();
    const registry = registryFor(fixtures);
    delete fixtures["agg-01"].source_ref;
    const context = contextFor(fixtures, registry);
    let result;
    assert.doesNotThrow(() => { result = run(baseTask(ALL_REFS), context); }, "run() must never throw on missing source_ref");
    assertRefusal(result, "READ_DENIED");
  });

  it("within-limit own-data positive retained: plain fixtures => REPORT_READY", () => {
    const fixtures = baseFixtures();
    const registry = registryFor(fixtures);
    const context = contextFor(fixtures, registry);
    const result = run(baseTask(ALL_REFS), context);
    assert.equal(result.status, "REPORT_READY");
    assert.equal(result.complete, true);
    assert.ok(result.report.metrics.length > 0);
  });
});
