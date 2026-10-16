/**
 * fixround3.test.js — public-run regression tests for M640-001, M640-002,
 * M640-007, M640-010 (fix round 3, 2026-10-16).
 *
 * M640-001: registry/grant/task-accessor budget bypass. Meter each
 *   registry/grant/nested control candidate BEFORE reading its fields;
 *   refuse at candidate 65 without inspecting it or later candidates.
 *   Reject accessors on control data at admission without invoking them.
 * M640-002: exclusions carry record identity + verified row citations.
 * M640-007: registry binds the COMPLETE source identity tuple
 *   (repo,path,commit,blob,algorithm,revision); negative probes for
 *   repo, commit, revision as well as path/blob.
 * M640-010: returned citations/diagnostics detach from host inputs and
 *   previous outputs; mutation cannot poison context or earlier results.
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
  return createHash("sha1").update(`fr3|${seed}`).digest("hex");
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
    task_id: "fr3-test",
    operation: "analyze",
    fixture_refs: fixtureRefs,
    options: { period: { ...PERIOD }, mode: "aggregate_counts", include_drafts: false, ...opts },
  };
}

function baseContext(fixtures, overrides = {}) {
  return {
    clock: "2026-10-15T12:00:00Z",
    principal: { kind: "jason" },
    relays: [],
    grants: Object.keys(fixtures),
    fixtures,
    source_registry: registryFor(fixtures),
    ...overrides,
  };
}

const ALL_REFS = [
  { fixture_id: "taxonomy-v1", kind: "taxonomy" },
  { fixture_id: "campaigns-01", kind: "campaigns" },
  { fixture_id: "complete-01", kind: "completeness" },
  { fixture_id: "agg-01", kind: "aggregate_counts" },
];

describe("M640-001: registry/grant/task-accessor budget bypass", () => {
  it("100 registry entries (data): REFUSED/BUDGET_EXCEEDED, over-cap entries uninspected", () => {
    const fixtures = baseFixtures();
    const registry = registryFor(fixtures);
    for (let i = 0; i < 100; i++) {
      registry[`extra-${i}`] = {
        repo: "t", path: `m/extra-${i}.json`, commit: commitId(`extra-${i}`),
        blob: "a".repeat(40), algorithm: "git-sha1", revision: "v1",
      };
    }
    const context = baseContext(fixtures, { source_registry: registry });
    const result = run(baseTask(ALL_REFS), context);
    assert.equal(result.status, "REFUSED");
    assert.ok(
      result.diagnostics.some((d) => d.code === "BUDGET_EXCEEDED"),
      "expected BUDGET_EXCEEDED, got: " + JSON.stringify(result.diagnostics.map((d) => d.code))
    );
    assert.equal(result.complete, false);
    assert.deepEqual(result.report.campaigns, [], "refusal carries no partial domain output");
  });

  it("100 registry entries with path getters: REFUSED with ZERO getter invocations", () => {
    let pathReads = 0;
    const fixtures = baseFixtures();
    const registry = registryFor(fixtures);
    for (let i = 0; i < 100; i++) {
      const entry = {
        repo: "t", commit: commitId(`extra-${i}`),
        blob: "a".repeat(40), algorithm: "git-sha1", revision: "v1",
      };
      Object.defineProperty(entry, "path", {
        enumerable: true,
        get() { pathReads++; return `m/extra-${i}.json`; },
      });
      registry[`extra-${i}`] = entry;
    }
    const context = baseContext(fixtures, { source_registry: registry });
    const result = run(baseTask(ALL_REFS), context);
    assert.equal(result.status, "REFUSED");
    assert.equal(pathReads, 0, `expected ZERO path getter invocations, got ${pathReads}`);
  });

  it("100 grant entries: REFUSED/BUDGET_EXCEEDED", () => {
    const fixtures = baseFixtures();
    const grants = Object.keys(fixtures);
    for (let i = 0; i < 100; i++) grants.push(`unused-grant-${i}`);
    const context = baseContext(fixtures, { grants });
    const result = run(baseTask(ALL_REFS), context);
    assert.equal(result.status, "REFUSED");
    assert.ok(
      result.diagnostics.some((d) => d.code === "BUDGET_EXCEEDED"),
      "expected BUDGET_EXCEEDED, got: " + JSON.stringify(result.diagnostics.map((d) => d.code))
    );
  });

  it("task_id getter: REFUSED/ACCESSOR_REJECTED with ZERO invocations", () => {
    let getterReads = 0;
    const fixtures = baseFixtures();
    const task = baseTask(ALL_REFS);
    Object.defineProperty(task, "task_id", {
      enumerable: true,
      get() { getterReads++; return "fr3-test"; },
    });
    const result = run(task, baseContext(fixtures));
    assert.equal(result.status, "REFUSED");
    assert.ok(
      result.diagnostics.some((d) => d.code === "ACCESSOR_REJECTED"),
      "expected ACCESSOR_REJECTED, got: " + JSON.stringify(result.diagnostics.map((d) => d.code))
    );
    assert.equal(getterReads, 0, `expected ZERO task_id getter invocations, got ${getterReads}`);
  });
});

describe("M640-002: exclusions carry record identity and verified citations", () => {
  it("OUT_OF_WINDOW exclusion has event identity and VERIFIED row citation", () => {
    const fixtures = baseFixtures();
    // Events fixture with one out-of-window impression.
    const events = [
      { event_id: "imp-0", campaign_id: "camp-a", timestamp: "2026-09-01T00:00:00Z", kind: "IMPRESSION" },
      { event_id: "imp-1", campaign_id: "camp-a", timestamp: "2026-10-02T12:00:00Z", kind: "IMPRESSION" },
    ];
    fixtures["events-01"] = fx("events-01", "events", events);
    const task = baseTask(
      [
        { fixture_id: "taxonomy-v1", kind: "taxonomy" },
        { fixture_id: "campaigns-01", kind: "campaigns" },
        { fixture_id: "complete-01", kind: "completeness" },
        { fixture_id: "events-01", kind: "events" },
      ],
      { mode: "event_rows" }
    );
    const context = baseContext(fixtures);
    const result = run(task, context);
    assert.equal(result.status, "REPORT_READY");
    const excl = result.report.exclusions.find((e) => e.reason === "OUT_OF_WINDOW");
    assert.ok(excl, "expected an OUT_OF_WINDOW exclusion");
    assert.equal(excl.count, 1);
    assert.ok(Array.isArray(excl.evidence) && excl.evidence.length === 1, "exclusion must carry evidence");
    const ev = excl.evidence[0];
    assert.equal(ev.record_id, "imp-0", "exclusion evidence must identify the event");
    assert.ok(ev.citation, "exclusion evidence must carry a citation");
    assert.equal(ev.citation.verification, "VERIFIED");
    assert.ok(
      typeof ev.citation.quoted_span === "string" && ev.citation.quoted_span.includes("imp-0"),
      "citation must quote the actual row bytes"
    );
    assert.deepEqual(
      ev.citation.span.quoted_text,
      ev.citation.quoted_span,
      "both quote fields must equal the exact byte slice"
    );
  });
});

describe("M640-007: registry binds the complete source identity tuple", () => {
  function tamperedContext(field, value) {
    const fixtures = baseFixtures();
    const tampered = {
      bytes: fixtures["agg-01"].bytes,
      source_ref: { ...fixtures["agg-01"].source_ref, [field]: value },
    };
    fixtures["agg-01"] = tampered;
    // Host registry retains the ORIGINAL full tuple.
    const registry = registryFor(baseFixtures());
    return baseContext(fixtures, { source_registry: registry });
  }

  it("fabricated repo: SOURCE_NOT_REGISTERED, fail closed", () => {
    const result = run(baseTask(ALL_REFS), tamperedContext("repo", "invented-repo"));
    assert.equal(result.status, "REFUSED");
    assert.ok(result.diagnostics.some((d) => d.code === "SOURCE_NOT_REGISTERED"));
  });

  it("fabricated commit: SOURCE_NOT_REGISTERED, fail closed", () => {
    const result = run(baseTask(ALL_REFS), tamperedContext("commit", "f".repeat(40)));
    assert.equal(result.status, "REFUSED");
    assert.ok(result.diagnostics.some((d) => d.code === "SOURCE_NOT_REGISTERED"));
  });

  it("fabricated revision: SOURCE_NOT_REGISTERED, fail closed", () => {
    const result = run(baseTask(ALL_REFS), tamperedContext("revision", "invented-revision"));
    assert.equal(result.status, "REFUSED");
    assert.ok(result.diagnostics.some((d) => d.code === "SOURCE_NOT_REGISTERED"));
  });

  it("full-tuple positive: matching registry yields REPORT_READY with VERIFIED citations", () => {
    const fixtures = baseFixtures();
    const result = run(baseTask(ALL_REFS), baseContext(fixtures));
    assert.equal(result.status, "REPORT_READY");
    const metric = result.report.metrics.find((m) => m.campaign_id === "camp-a");
    assert.ok(metric && metric.citations && metric.citations.length > 0);
    assert.ok(metric.citations.some((c) => c.verification === "VERIFIED"));
  });
});

describe("M640-010: returned citations detach from host inputs and previous outputs", () => {
  it("mutating a returned citation cannot poison the host context (verdict probe)", () => {
    const fixtures = baseFixtures();
    const context = baseContext(fixtures);
    const originalBlob = fixtures["agg-01"].source_ref.blob;
    const r1 = run(baseTask(ALL_REFS), context);
    assert.equal(r1.status, "REPORT_READY");
    // Verdict probe: mutate the returned citation's source_ref.
    r1.report.metrics[0].citations[0].source_ref.blob = "f".repeat(40);
    // The host context must be unchanged.
    assert.equal(
      context.fixtures["agg-01"].source_ref.blob,
      originalBlob,
      "mutating a returned citation poisoned the host context"
    );
    // A rerun with the supposedly unchanged context must not HASH_MISMATCH.
    const r2 = run(baseTask(ALL_REFS), context);
    assert.equal(r2.status, "REPORT_READY");
    assert.ok(!r2.diagnostics.some((d) => d.code === "HASH_MISMATCH"));
  });

  it("mutating the host context after return cannot alter an earlier result", () => {
    const fixtures = baseFixtures();
    const context = baseContext(fixtures);
    const r1 = run(baseTask(ALL_REFS), context);
    assert.equal(r1.status, "REPORT_READY");
    const before = r1.report.metrics[0].citations[0].source_ref.blob;
    // Host mutates its own context after the run returned.
    context.fixtures["agg-01"].source_ref.blob = "e".repeat(40);
    assert.equal(
      r1.report.metrics[0].citations[0].source_ref.blob,
      before,
      "host context mutation altered an already-returned result"
    );
  });

  it("two independent runs do not cross-contaminate", () => {
    const fixtures1 = baseFixtures();
    const ctx1 = baseContext(fixtures1);
    const r1 = run(baseTask(ALL_REFS), ctx1);
    assert.equal(r1.status, "REPORT_READY");
    const blob1 = r1.report.metrics[0].citations[0].source_ref.blob;
    // Second run with a different (but valid) context.
    const fixtures2 = baseFixtures();
    fixtures2["agg-01"] = fx("agg-01", "aggregate_counts", [
      { campaign_id: "camp-a", period_start: PERIOD.start, period_end: PERIOD.end, currency: "USD",
        impressions: 200, clicks: 10, conversions: 2, spend_minor: 2000, revenue_minor: 10000 },
    ]);
    const ctx2 = baseContext(fixtures2);
    const r2 = run(baseTask(ALL_REFS), ctx2);
    assert.equal(r2.status, "REPORT_READY");
    // r1's citations still reference its own source bytes.
    assert.equal(r1.report.metrics[0].citations[0].source_ref.blob, blob1);
    assert.notEqual(r2.report.metrics[0].citations[0].source_ref.blob, blob1);
  });

  it("diagnostic source_refs are detached from host input", () => {
    const fixtures = baseFixtures();
    // Force a diagnostic with a source_ref: use an out-of-window event.
    const events = [
      { event_id: "imp-0", campaign_id: "camp-a", timestamp: "2026-09-01T00:00:00Z", kind: "IMPRESSION" },
    ];
    fixtures["events-01"] = fx("events-01", "events", events);
    const task = baseTask(
      [
        { fixture_id: "taxonomy-v1", kind: "taxonomy" },
        { fixture_id: "campaigns-01", kind: "campaigns" },
        { fixture_id: "complete-01", kind: "completeness" },
        { fixture_id: "events-01", kind: "events" },
      ],
      { mode: "event_rows" }
    );
    const context = baseContext(fixtures);
    const r = run(task, context);
    const diag = r.diagnostics.find((d) => d.code === "EVENT_OUT_OF_WINDOW");
    assert.ok(diag && diag.source_ref, "expected a diagnostic with a source_ref");
    const originalBlob = context.fixtures["events-01"].source_ref.blob;
    diag.source_ref.blob = "d".repeat(40);
    assert.equal(
      context.fixtures["events-01"].source_ref.blob,
      originalBlob,
      "mutating a diagnostic source_ref poisoned the host context"
    );
  });
});
