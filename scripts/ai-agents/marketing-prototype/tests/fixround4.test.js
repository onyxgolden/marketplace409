/**
 * fixround4.test.js — public-run regression tests for the M640-001
 * fixture-payload accessor bypass (fix round 4, 2026-10-16).
 *
 * The input-byte pre-scan (measureCanonicalBytes) deliberately skips
 * accessors without invoking them, so a granted fixture whose `bytes`
 * (or source identity metadata) is an enumerable getter admitted an
 * unmeasured, unlimited payload past the 262144-byte input cap.
 * Stable admission now rejects accessor-backed fixture fields WITHOUT
 * invoking them (ACCESSOR_REJECTED), after the grant check so denied
 * entries stay unread with zero getter calls.
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
  return createHash("sha1").update(`fr4|${seed}`).digest("hex");
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
    task_id: "fr4-test",
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

describe("M640-001 round 4: fixture-payload accessor bypass", () => {
  it("verdict regression: 307486-byte granted bytes getter => REFUSED/ACCESSOR_REJECTED, ZERO invocations", () => {
    const fixtures = baseFixtures();
    const original = fixtures["agg-01"];
    // Verdict probe shape: 300 KiB of leading whitespace (legal JSON) +
    // the original bytes, correct git blob hash, host registration
    // updated to the same valid source revision.
    const padded = " ".repeat(300 * 1024) + original.bytes;
    assert.ok(padded.length > 262144, `payload must exceed the input cap, got ${padded.length}`);
    let calls = 0;
    const evilEntry = {
      source_ref: { ...original.source_ref, blob: gitBlobId(padded) },
    };
    Object.defineProperty(evilEntry, "bytes", {
      enumerable: true,
      get() { calls++; return padded; },
    });
    fixtures["agg-01"] = evilEntry;
    // Host registry independently retains the padded blob (same valid
    // revision), so only the accessor admission is under test.
    const context = baseContext(fixtures);
    const result = run(baseTask(ALL_REFS), context);
    assertRefusal(result, "ACCESSOR_REJECTED");
    assert.equal(calls, 0, `expected ZERO bytes getter invocations, got ${calls}`);
  });

  it("admitted ordinary within-limit positive: data-property fixture => REPORT_READY", () => {
    const fixtures = baseFixtures();
    const result = run(baseTask(ALL_REFS), baseContext(fixtures));
    assert.equal(result.status, "REPORT_READY");
    assert.equal(result.complete, true);
    assert.ok(result.report.metrics.length > 0);
  });

  it("ordinary oversize negative: 307486-byte data-property bytes => REFUSED/INPUT_LIMIT", () => {
    const fixtures = baseFixtures();
    const original = fixtures["agg-01"];
    const padded = " ".repeat(300 * 1024) + original.bytes;
    fixtures["agg-01"] = {
      bytes: padded,
      source_ref: { ...original.source_ref, blob: gitBlobId(padded) },
    };
    const result = run(baseTask(ALL_REFS), baseContext(fixtures));
    assertRefusal(result, "INPUT_LIMIT");
  });

  it("denied-accessor zero-read positive: ungranted fixture bytes getter => READ_DENIED, ZERO invocations", () => {
    let calls = 0;
    const fixtures = baseFixtures();
    const original = fixtures["agg-01"];
    const evilEntry = { source_ref: { ...original.source_ref } };
    Object.defineProperty(evilEntry, "bytes", {
      enumerable: true,
      get() { calls++; return original.bytes; },
    });
    fixtures["agg-01"] = evilEntry;
    // agg-01 NOT in grants: the grant check must fire before any
    // descriptor read, so the getter stays unread.
    const context = baseContext(fixtures, { grants: ["taxonomy-v1", "campaigns-01", "complete-01"] });
    const result = run(baseTask(ALL_REFS), context);
    assertRefusal(result, "READ_DENIED");
    assert.equal(calls, 0, `expected ZERO bytes getter invocations, got ${calls}`);
  });

  it("source identity metadata: source_ref.repo getter => REFUSED/ACCESSOR_REJECTED, ZERO invocations", () => {
    let calls = 0;
    const fixtures = baseFixtures();
    // Host registry built from PRISTINE fixtures (data properties only),
    // mirroring the M640-007 tamper pattern: nothing in setup may invoke
    // the fixture's getter.
    const registry = registryFor(baseFixtures());
    const original = fixtures["agg-01"];
    const sourceRef = { ...original.source_ref };
    Object.defineProperty(sourceRef, "repo", {
      enumerable: true,
      get() { calls++; return "t"; },
    });
    fixtures["agg-01"] = { bytes: original.bytes, source_ref: sourceRef };
    // Build the context literally: baseContext() would eagerly run
    // registryFor() over the tampered fixtures (invoking the getter in
    // setup), so the pristine registry is attached directly.
    const context = {
      clock: "2026-10-15T12:00:00Z",
      principal: { kind: "jason" },
      relays: [],
      grants: Object.keys(fixtures),
      fixtures,
      source_registry: registry,
    };
    const result = run(baseTask(ALL_REFS), context);
    assertRefusal(result, "ACCESSOR_REJECTED");
    assert.equal(calls, 0, `expected ZERO repo getter invocations, got ${calls}`);
  });

  it("prototype-chain accessor on bytes is also rejected without invocation", () => {
    let calls = 0;
    const fixtures = baseFixtures();
    const original = fixtures["agg-01"];
    const proto = {};
    Object.defineProperty(proto, "bytes", {
      enumerable: true,
      get() { calls++; return original.bytes; },
    });
    const evilEntry = Object.create(proto);
    evilEntry.source_ref = { ...original.source_ref };
    fixtures["agg-01"] = evilEntry;
    const context = baseContext(fixtures);
    const result = run(baseTask(ALL_REFS), context);
    assertRefusal(result, "ACCESSOR_REJECTED");
    assert.equal(calls, 0, `expected ZERO bytes getter invocations, got ${calls}`);
  });
});
