/**
 * fixround2.test.js — public-run regression tests for M640-001, M640-002,
 * M640-004/005, M640-007 (fix round 2, 2026-10-16).
 *
 * M640-001: getter/poison-canary tests assert ZERO over-cap/later/denied
 * reads (not merely absence of a canary word in output). Refusal carries
 * no partial domain output.
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
  return createHash("sha1").update(`fr2|${seed}`).digest("hex");
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
    Object.entries(fixtures).map(([fid, e]) => [fid, { path: e.source_ref.path, blob: e.source_ref.blob }])
  );
}

function baseFixtures() {
  return {
    "taxonomy-v1": fx("taxonomy-v1", "taxonomy", TAX_ROWS),
    "campaigns-01": fx("campaigns-01", "campaigns", [
      { campaign_id: "camp-a", name: "A", objective: { tag: "AWARENESS" }, currency: "USD" },
    ]),
    "complete-01": fx("complete-01", "completeness", [{ campaign_id: "camp-a", complete: true }]),
  };
}

function baseTask(fixtureRefs, opts = {}) {
  return {
    schema_version: "1",
    task_id: "fr2-test",
    operation: "analyze",
    fixture_refs: fixtureRefs,
    options: { period: { ...PERIOD }, mode: "aggregate_counts", include_drafts: false, ...opts },
  };
}

describe("M640-001: serialization is inspection — zero over-cap reads", () => {
  it("100 relay getters: refusal with ZERO relay_id getter invocations", () => {
    let getterCalls = 0;
    const relays = [];
    for (let i = 0; i < 100; i++) {
      const r = {};
      Object.defineProperty(r, "relay_id", {
        enumerable: true,
        get() { getterCalls++; return `relay-${i}`; },
      });
      r.registered_by = "Jason";
      r.revoked = false;
      r.valid_from = "2026-01-01T00:00:00Z";
      r.expires_at = "2027-01-01T00:00:00Z";
      relays.push(r);
    }
    const fixtures = baseFixtures();
    const task = baseTask([
      { fixture_id: "taxonomy-v1", kind: "taxonomy" },
      { fixture_id: "campaigns-01", kind: "campaigns" },
      { fixture_id: "complete-01", kind: "completeness" },
    ]);
    const context = {
      clock: "2026-10-15T12:00:00Z",
      principal: { kind: "relay", relay_id: "relay-0" },
      relays,
      grants: Object.keys(fixtures),
      fixtures,
      source_registry: registryFor(fixtures),
    };
    const result = run(task, context);
    assert.equal(result.status, "REFUSED");
    assert.equal(result.complete, false);
    // The budget must refuse BEFORE any relay candidate is inspected.
    assert.equal(getterCalls, 0, `expected ZERO relay_id getter invocations, got ${getterCalls}`);
    // No partial domain output.
    assert.deepEqual(result.report.campaigns, []);
  });

  it("denied fixture bytes getter: READ_DENIED with ZERO byte reads", () => {
    let byteReads = 0;
    const fixtures = baseFixtures();
    const aggBytes = JSON.stringify({ fixture_id: "agg-01", kind: "aggregate_counts", schema_version: "1", rows: [] });
    // agg-01 NOT in grants; its bytes are a getter that counts reads.
    const evilEntry = {};
    Object.defineProperty(evilEntry, "bytes", {
      enumerable: true,
      get() { byteReads++; return aggBytes; },
    });
    evilEntry.source_ref = {
      repo: "t", path: "m/agg-01.json", commit: commitId("agg-01"),
      blob: gitBlobId(aggBytes), algorithm: "git-sha1", revision: "v1",
    };
    fixtures["agg-01"] = evilEntry;
    const task = baseTask([
      { fixture_id: "taxonomy-v1", kind: "taxonomy" },
      { fixture_id: "campaigns-01", kind: "campaigns" },
      { fixture_id: "agg-01", kind: "aggregate_counts" },
    ]);
    // Grants EXCLUDE agg-01.
    const context = {
      clock: "2026-10-15T12:00:00Z",
      principal: { kind: "jason" },
      relays: [],
      grants: ["taxonomy-v1", "campaigns-01"],
      fixtures,
      source_registry: registryFor(fixtures),
    };
    const result = run(task, context);
    assert.equal(result.status, "REFUSED");
    assert.ok(result.diagnostics.some((d) => d.code === "READ_DENIED"), "expected READ_DENIED");
    assert.equal(byteReads, 0, `expected ZERO denied byte reads, got ${byteReads}`);
  });
});

describe("M640-007: source membership", () => {
  it("fabricated path with valid blob hash: SOURCE_NOT_REGISTERED, fail closed", () => {
    const fixtures = baseFixtures();
    // Tamper: change path to fabricated.json, keep bytes/blob valid.
    // The host registry retains the ORIGINAL path.
    const orig = fixtures["campaigns-01"];
    const tampered = {
      bytes: orig.bytes,
      source_ref: { ...orig.source_ref, path: "fabricated.json", commit: "f".repeat(40) },
    };
    fixtures["campaigns-01"] = tampered;
    const task = baseTask([
      { fixture_id: "taxonomy-v1", kind: "taxonomy" },
      { fixture_id: "campaigns-01", kind: "campaigns" },
      { fixture_id: "complete-01", kind: "completeness" },
    ]);
    const context = {
      clock: "2026-10-15T12:00:00Z",
      principal: { kind: "jason" },
      relays: [],
      grants: Object.keys(fixtures),
      fixtures,
      // Host registry has the ORIGINAL (path, blob) — tampered tuple not a member.
      source_registry: {
        "taxonomy-v1": { path: "m/taxonomy-v1.json", blob: fixtures["taxonomy-v1"].source_ref.blob },
        "campaigns-01": { path: "m/campaigns-01.json", blob: orig.source_ref.blob },
        "complete-01": { path: "m/complete-01.json", blob: fixtures["complete-01"].source_ref.blob },
      },
    };
    const result = run(task, context);
    assert.equal(result.status, "REFUSED");
    assert.ok(
      result.diagnostics.some((d) => d.code === "SOURCE_NOT_REGISTERED"),
      "expected SOURCE_NOT_REGISTERED fail-closed, got: " + JSON.stringify(result.diagnostics.map((d) => d.code))
    );
    assert.equal(result.complete, false);
  });

  it("unused brief (include_drafts:false) is NOT in source_refs", () => {
    const fixtures = {
      ...baseFixtures(),
      "brief-01": fx("brief-01", "content_brief", [
        { brief_id: "br-1", campaign_id: "camp-a", product_label: "Widget", benefit_id: "b1", cta_id: "cta-1" },
      ]),
      "benefit-01": fx("benefit-01", "benefit_registry", [
        { benefit_id: "b1", benefit_text: "Saves time" },
      ]),
      "agg-01": fx("agg-01", "aggregate_counts", [
        { campaign_id: "camp-a", period_start: PERIOD.start, period_end: PERIOD.end, currency: "USD", impressions: 100, clicks: 5, conversions: 1, spend_minor: 1000, revenue_minor: 5000 },
      ]),
    };
    const task = baseTask(
      [
        { fixture_id: "taxonomy-v1", kind: "taxonomy" },
        { fixture_id: "campaigns-01", kind: "campaigns" },
        { fixture_id: "complete-01", kind: "completeness" },
        { fixture_id: "brief-01", kind: "content_brief" },
        { fixture_id: "benefit-01", kind: "benefit_registry" },
        { fixture_id: "agg-01", kind: "aggregate_counts" },
      ],
      { include_drafts: false }
    );
    const context = {
      clock: "2026-10-15T12:00:00Z",
      principal: { kind: "jason" },
      relays: [],
      grants: Object.keys(fixtures),
      fixtures,
      source_registry: registryFor(fixtures),
    };
    const result = run(task, context);
    assert.equal(result.status, "REPORT_READY");
    const paths = result.source_refs.map((r) => r.path);
    assert.ok(!paths.includes("m/brief-01.json"), `ignored brief must not be in source_refs, got: ${paths}`);
    assert.ok(!paths.includes("m/benefit-01.json"), `unused benefit registry must not be in source_refs, got: ${paths}`);
  });
});

describe("M640-004/005: absent aggregates are null, header blocks completeness", () => {
  it("absent aggregate: nulls not zeros; header '0' claim does NOT match", () => {
    const fixtures = {
      ...baseFixtures(),
      "agg-01": fx("agg-01", "aggregate_counts", []), // empty rows
      "header-01": fx("header-01", "header_claims", [
        {
          claim_id: "h1", campaign_id: "camp-a", metric: "SPEND_MINOR", claimed_value: "0",
          period_start: PERIOD.start, period_end: PERIOD.end, currency: "USD",
          evidence_spans: [],
        },
      ]),
    };
    const task = baseTask([
      { fixture_id: "taxonomy-v1", kind: "taxonomy" },
      { fixture_id: "campaigns-01", kind: "campaigns" },
      { fixture_id: "complete-01", kind: "completeness" },
      { fixture_id: "agg-01", kind: "aggregate_counts" },
      { fixture_id: "header-01", kind: "header_claims" },
    ]);
    const context = {
      clock: "2026-10-15T12:00:00Z",
      principal: { kind: "jason" },
      relays: [],
      grants: Object.keys(fixtures),
      fixtures,
      source_registry: registryFor(fixtures),
    };
    const result = run(task, context);
    // Campaign camp-a has no aggregate ROW (agg-01 is empty) -> metric UNVERIFIABLE with nulls.
    // Actually agg-01 IS present but empty; the "no row" path triggers per-campaign.
    // Here camp-a has no row in agg-01, so the absent path applies.
    const m = result.report.metrics.find((x) => x.campaign_id === "camp-a");
    assert.ok(m, "metric for camp-a exists");
    // Absent counts are null, never numeric zero.
    assert.equal(m.impressions, null);
    assert.equal(m.spend_minor, null);
    // Header claim of "0" must NOT match absent evidence.
    const h = result.report.header_comparisons.find((x) => x.claim_id === "h1");
    assert.ok(h, "header comparison exists");
    assert.notEqual(h.status, "MATCH", "header '0' must not MATCH absent evidence");
  });

  it("header grain mismatch (EUR vs USD): PARTIAL, not REPORT_READY", () => {
    const fixtures = {
      ...baseFixtures(),
      "agg-01": fx("agg-01", "aggregate_counts", [
        { campaign_id: "camp-a", period_start: PERIOD.start, period_end: PERIOD.end, currency: "USD", impressions: 1000, clicks: 10, conversions: 1, spend_minor: 5000, revenue_minor: 15000 },
      ]),
      "header-01": fx("header-01", "header_claims", [
        {
          claim_id: "h1", campaign_id: "camp-a", metric: "IMPRESSIONS", claimed_value: "1000",
          period_start: PERIOD.start, period_end: PERIOD.end, currency: "EUR",
          evidence_spans: [],
        },
      ]),
    };
    const task = baseTask([
      { fixture_id: "taxonomy-v1", kind: "taxonomy" },
      { fixture_id: "campaigns-01", kind: "campaigns" },
      { fixture_id: "complete-01", kind: "completeness" },
      { fixture_id: "agg-01", kind: "aggregate_counts" },
      { fixture_id: "header-01", kind: "header_claims" },
    ]);
    const context = {
      clock: "2026-10-15T12:00:00Z",
      principal: { kind: "jason" },
      relays: [],
      grants: Object.keys(fixtures),
      fixtures,
      source_registry: registryFor(fixtures),
    };
    const result = run(task, context);
    const h = result.report.header_comparisons.find((x) => x.claim_id === "h1");
    assert.equal(h.status, "UNCOMPARABLE");
    // Unresolved material header verification blocks completeness.
    assert.equal(result.complete, false);
    assert.equal(result.status, "PARTIAL");
  });
});

describe("M640-002: citation coverage", () => {
  it("draft carries brief, benefit, template, and CTA citations", () => {
    const fixtures = {
      ...baseFixtures(),
      "brief-01": fx("brief-01", "content_brief", [
        { brief_id: "br-1", campaign_id: "camp-a", product_label: "Widget", benefit_id: "b1", cta_id: "cta-1" },
      ]),
      "benefit-01": fx("benefit-01", "benefit_registry", [
        { benefit_id: "b1", benefit_text: "Saves time" },
      ]),
    };
    const task = baseTask(
      [
        { fixture_id: "taxonomy-v1", kind: "taxonomy" },
        { fixture_id: "campaigns-01", kind: "campaigns" },
        { fixture_id: "complete-01", kind: "completeness" },
        { fixture_id: "brief-01", kind: "content_brief" },
        { fixture_id: "benefit-01", kind: "benefit_registry" },
      ],
      { include_drafts: true, mode: "event_rows" }
    );
    // Event mode needs events fixture; use aggregate mode instead for simplicity.
    task.options.mode = "aggregate_counts";
    fixtures["agg-01"] = fx("agg-01", "aggregate_counts", [
      { campaign_id: "camp-a", period_start: PERIOD.start, period_end: PERIOD.end, currency: "USD", impressions: 100, clicks: 5, conversions: 1, spend_minor: 1000, revenue_minor: 5000 },
    ]);
    task.fixture_refs.push({ fixture_id: "agg-01", kind: "aggregate_counts" });
    const context = {
      clock: "2026-10-15T12:00:00Z",
      principal: { kind: "jason" },
      relays: [],
      grants: Object.keys(fixtures),
      fixtures,
      source_registry: registryFor(fixtures),
    };
    const result = run(task, context);
    const camp = result.report.campaigns.find((c) => c.campaign_id === "camp-a");
    assert.ok(camp.drafts.length > 0, "drafts rendered");
    const d = camp.drafts[0];
    assert.ok(Array.isArray(d.citations) && d.citations.length >= 4, `draft must cite brief+benefit+template+CTA, got ${d.citations?.length}`);
    // All citations verified (bytes retained).
    for (const c of d.citations) {
      assert.equal(c.verification, "VERIFIED", "draft dependency citations must be VERIFIED");
      assert.ok(c.quoted_span !== null && c.span !== null, "citation must have byte span");
    }
  });

  it("campaign classification cites the taxonomy rule", () => {
    const fixtures = {
      ...baseFixtures(),
      "agg-01": fx("agg-01", "aggregate_counts", [
        { campaign_id: "camp-a", period_start: PERIOD.start, period_end: PERIOD.end, currency: "USD", impressions: 100, clicks: 5, conversions: 1, spend_minor: 1000, revenue_minor: 5000 },
      ]),
    };
    const task = baseTask([
      { fixture_id: "taxonomy-v1", kind: "taxonomy" },
      { fixture_id: "campaigns-01", kind: "campaigns" },
      { fixture_id: "complete-01", kind: "completeness" },
      { fixture_id: "agg-01", kind: "aggregate_counts" },
    ]);
    const context = {
      clock: "2026-10-15T12:00:00Z",
      principal: { kind: "jason" },
      relays: [],
      grants: Object.keys(fixtures),
      fixtures,
      source_registry: registryFor(fixtures),
    };
    const result = run(task, context);
    const camp = result.report.campaigns.find((c) => c.campaign_id === "camp-a");
    // Citations: [campaign row, taxonomy tag rule].
    assert.ok(camp.citations.length >= 2, `classification must cite row AND taxonomy rule, got ${camp.citations.length}`);
    assert.ok(camp.citations.some((c) => c.verification === "VERIFIED"));
  });
});
