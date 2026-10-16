/**
 * fixround5.test.js — public-run regression tests for the M640-001
 * inherited-data bypass (fix round 5, 2026-10-16).
 *
 * The input-byte pre-scan (measureCanonicalBytes) only measures OWN
 * properties. The round-4 getDataDescriptor walked the prototype chain
 * and accepted inherited data properties, so an inherited 307486-byte
 * payload admitted an unmeasured, unlimited source past the 262144-byte
 * input cap with no getter, proxy, race or forged registration.
 *
 * Admission is now OWN-data-descriptor-only for the fixture-ID entry,
 * bytes, source_ref and every source-identity field. Missing or
 * inherited-only fields refuse structurally (not registered) — the
 * resolver never walks a prototype to recover values the pre-scan
 * never charged.
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
  return createHash("sha1").update(`fr5|${seed}`).digest("hex");
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
    task_id: "fr5-test",
    operation: "analyze",
    fixture_refs: fixtureRefs,
    options: { period: { ...PERIOD }, mode: "aggregate_counts", include_drafts: false, ...opts },
  };
}

function paddedEntry(original) {
  const padded = " ".repeat(300 * 1024) + original.bytes;
  assert.ok(padded.length > 262144, `payload must exceed the input cap, got ${padded.length}`);
  return {
    bytes: padded,
    source_ref: { ...original.source_ref, blob: gitBlobId(padded) },
  };
}

// Build the context literally (never baseContext(), which would run
// registryFor() over the tampered fixtures). The registry is the host's
// independently retained full SourceRef tuple for the padded revision.
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

describe("M640-001 round 5: inherited-data bypass", () => {
  it("verdict probe 1: inherited bytes (307486 B via prototype) => REFUSED, no REPORT_READY", () => {
    const fixtures = baseFixtures();
    const pristine = { ...baseFixtures(), "agg-01": paddedEntry(baseFixtures()["agg-01"]) };
    const registry = registryFor(pristine);
    const evilEntry = { source_ref: { ...pristine["agg-01"].source_ref } };
    delete evilEntry.bytes; // own bytes absent
    Object.setPrototypeOf(evilEntry, { bytes: pristine["agg-01"].bytes });
    fixtures["agg-01"] = evilEntry;
    const context = contextFor(fixtures, registry, ["taxonomy-v1", "campaigns-01", "complete-01", "agg-01"]);
    const result = run(baseTask(ALL_REFS), context);
    assertRefusal(result, "READ_DENIED");
  });

  it("verdict probe 2: inherited fixture entry (fixtures prototype) => REFUSED, no REPORT_READY", () => {
    const fixtures = baseFixtures();
    const padded = paddedEntry(fixtures["agg-01"]);
    const registry = registryFor({ ...baseFixtures(), "agg-01": padded });
    delete fixtures["agg-01"];
    Object.setPrototypeOf(fixtures, { "agg-01": padded });
    // agg-01 is granted (explicit grants — Object.keys would drop the
    // deleted own key) so the descriptor admission path is exercised.
    const context = contextFor(fixtures, registry, ["taxonomy-v1", "campaigns-01", "complete-01", "agg-01"]);
    const result = run(baseTask(ALL_REFS), context);
    assertRefusal(result, "READ_DENIED");
  });

  it("inherited source-identity field (source_ref.repo on prototype) => REFUSED/READ_DENIED", () => {
    const fixtures = baseFixtures();
    const original = fixtures["agg-01"];
    const registry = registryFor(baseFixtures());
    const sourceRef = {
      path: original.source_ref.path,
      commit: original.source_ref.commit,
      blob: original.source_ref.blob,
      algorithm: original.source_ref.algorithm,
      revision: original.source_ref.revision,
    };
    Object.setPrototypeOf(sourceRef, { repo: original.source_ref.repo });
    fixtures["agg-01"] = { bytes: original.bytes, source_ref: sourceRef };
    const context = contextFor(fixtures, registry);
    const result = run(baseTask(ALL_REFS), context);
    assertRefusal(result, "READ_DENIED");
  });

  it("within-limit own-data positive: plain fixtures => REPORT_READY", () => {
    const fixtures = baseFixtures();
    const registry = registryFor(fixtures);
    const context = contextFor(fixtures, registry);
    const result = run(baseTask(ALL_REFS), context);
    assert.equal(result.status, "REPORT_READY");
    assert.equal(result.complete, true);
    assert.ok(result.report.metrics.length > 0);
  });

  it("ordinary oversize negative: 307486-byte own-data bytes => REFUSED/INPUT_LIMIT", () => {
    const fixtures = baseFixtures();
    fixtures["agg-01"] = paddedEntry(fixtures["agg-01"]);
    const registry = registryFor(fixtures);
    const context = contextFor(fixtures, registry);
    const result = run(baseTask(ALL_REFS), context);
    assertRefusal(result, "INPUT_LIMIT");
  });

  it("missing own entry for a granted fixture => REFUSED/READ_DENIED", () => {
    const fixtures = baseFixtures();
    delete fixtures["agg-01"];
    const registry = registryFor(baseFixtures());
    const context = contextFor(fixtures, registry, ["taxonomy-v1", "campaigns-01", "complete-01", "agg-01"]);
    const result = run(baseTask(ALL_REFS), context);
    assertRefusal(result, "READ_DENIED");
  });
});
