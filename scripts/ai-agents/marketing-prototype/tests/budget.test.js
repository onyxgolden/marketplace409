/**
 * budgets.test.js — exact object-count and span-count boundary proofs,
 * built from hand-counted minimal scenarios so the arithmetic is
 * independently verifiable here rather than inherited from fixtures.
 *
 * Object charging order (documented): task envelope (1), then per
 * fixture_ref in order: the store entry (1) + each row span charged
 * before parsing (1 each).
 *
 * Span charging order (documented): campaign rows 2, event rows 4,
 * bindings rows 2, header-claim rows 2 + 1 per evidence span, brief rows
 * 2, drafts 2 each, conversion/revenue attribution 2 each, duplicate
 * groups 1, integrity flags 1.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { run, BUDGET_LIMITS } from "../src/index.js";
import { Budget, BudgetError, presplitRows } from "../src/budget.js";

function gitBlobId(bytes) {
  const b = Buffer.from(bytes, "utf8");
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${b.length}\0`, "utf8"), b])).digest("hex");
}
function commitId(seed) {
  return createHash("sha1").update(`bud-test|${seed}`).digest("hex");
}

const TAX_ROWS = [
  { entry: "tag", tag: "AWARENESS" },
  { entry: "template", template_id: "tpl-1", text: "DRAFT — NOT PUBLISHED\n{product_label}" },
  { entry: "template", template_id: "tpl-2", text: "DRAFT — NOT PUBLISHED\n{product_label}!" },
  { entry: "template", template_id: "tpl-3", text: "DRAFT — NOT PUBLISHED\n{product_label}?" },
];
const PERIOD = { start: "2026-10-01T00:00:00Z", end: "2026-10-08T00:00:00Z" };
const TS = "2026-10-02T12:00:00Z";

function fx(fixture_id, kind, rows) {
  const obj = { fixture_id, kind, schema_version: "1", rows };
  const bytes = JSON.stringify(obj);
  return {
    bytes,
    source_ref: { repo: "t", path: `m/${fixture_id}.json`, commit: commitId(fixture_id), blob: gitBlobId(bytes), algorithm: "git-sha1", revision: "v1" },
  };
}

/** Minimal scenario with n impression events; hand-counted objects = 11 + n. */
function scenario(nEvents, { poisonTail = false } = {}) {
  const events = [];
  for (let i = 0; i < nEvents; i++) {
    events.push(
      poisonTail && i === nEvents - 1
        ? { event_id: "ev-canary-tail", campaign_id: "camp-a", timestamp: TS, kind: "BOGUS-KIND" }
        : { event_id: `imp-${i}`, campaign_id: "camp-a", timestamp: TS, kind: "IMPRESSION" }
    );
  }
  const fixtures = {
    "taxonomy-v1": fx("taxonomy-v1", "taxonomy", TAX_ROWS),
    "campaigns-01": fx("campaigns-01", "campaigns", [
      { campaign_id: "camp-a", name: "A", objective: { tag: "AWARENESS" }, currency: "USD" },
    ]),
    "events-01": fx("events-01", "events", events),
    "complete-01": fx("complete-01", "completeness", [{ campaign_id: "camp-a", complete: true }]),
  };
  const task = {
    schema_version: "1",
    task_id: `bud-${nEvents}`,
    operation: "analyze",
    fixture_refs: [
      { fixture_id: "taxonomy-v1", kind: "taxonomy" },
      { fixture_id: "campaigns-01", kind: "campaigns" },
      { fixture_id: "events-01", kind: "events" },
      { fixture_id: "complete-01", kind: "completeness" },
    ],
    options: { period: { ...PERIOD }, mode: "event_rows", include_drafts: false },
  };
  const context = {
    clock: "2026-10-15T12:00:00Z",
    principal: { kind: "jason" },
    relays: [],
    grants: Object.keys(fixtures),
    fixtures,
  };
  return { task, context };
}

describe("object budget", () => {
  it("exactly 64 charged objects succeeds (53 events: 11 + 53)", () => {
    const { task, context } = scenario(53);
    const r = run(task, context);
    assert.equal(r.status, "REPORT_READY");
    assert.equal(r.report.metrics[0].impressions, 53);
  });

  it("the 65th charged object refuses BEFORE inspection (56 events, poison tail)", () => {
    // Charges: task(1) + taxonomy(5) + campaigns(2) + events entry(1) = 9;
    // event row k is charge 9+k. Row 56 is charge 65 and refuses before
    // parsing. If it were inspected, the bogus kind would yield
    // INVALID_INPUT instead of BUDGET_EXCEEDED.
    const { task, context } = scenario(56, { poisonTail: true });
    const r = run(task, context);
    assert.equal(r.status, "REFUSED");
    assert.deepEqual(r.diagnostics.map((d) => d.code), ["BUDGET_EXCEEDED"]);
    const text = JSON.stringify(r);
    assert.ok(!text.includes("ev-canary-tail"), "poison tail row must be untouched by the refusal");
    assert.ok(!text.includes("BOGUS-KIND"), "poison tail payload must never be decoded");
  });
});

describe("span budget", () => {
  it("span 513 refuses before the span is checked (instrumented)", () => {
    const b = new Budget();
    for (let i = 0; i < 512; i++) b.chargeSpan(1);
    assert.throws(() => b.chargeSpan(1), (e) => e instanceof BudgetError && e.code === "BUDGET_EXCEEDED");
    assert.equal(b.spans, 513);
  });
  it("object 65 refuses before the object is inspected (instrumented)", () => {
    const b = new Budget();
    for (let i = 0; i < 64; i++) b.chargeObject(1);
    assert.throws(() => b.chargeObject(1), (e) => e instanceof BudgetError && e.code === "BUDGET_EXCEEDED");
  });
  it("limits match the brief", () => {
    assert.equal(BUDGET_LIMITS.maxObjects, 64);
    assert.equal(BUDGET_LIMITS.maxSpans, 512);
    assert.equal(BUDGET_LIMITS.maxInputBytes, 256 * 1024);
    assert.equal(BUDGET_LIMITS.maxOutputRecords, 256);
    assert.equal(BUDGET_LIMITS.maxOutputBytes, 256 * 1024);
    assert.equal(BUDGET_LIMITS.maxDepth, 32);
  });
});

describe("pre-splitter", () => {
  it("yields raw per-element spans without decoding fields", () => {
    const bytes = Buffer.from(JSON.stringify({ fixture_id: "f", kind: "events", schema_version: "1", rows: [{ a: 1 }, { b: "xéy" }] }), "utf8");
    const { header, rowSpans } = presplitRows(bytes);
    assert.deepEqual(header, { fixture_id: "f", kind: "events", schema_version: "1" });
    assert.equal(rowSpans.length, 2);
    assert.equal(bytes.toString("utf8", rowSpans[0][0], rowSpans[0][1]), '{"a":1}');
    assert.equal(bytes.toString("utf8", rowSpans[1][0], rowSpans[1][1]), '{"b":"xéy"}');
    // é is 2 UTF-8 bytes: span boundaries are byte-exact, not char-exact.
    assert.equal(rowSpans[1][1] - rowSpans[1][0], Buffer.byteLength('{"b":"xéy"}', "utf8"));
  });
  it("rejects depth > 32", () => {
    let nested = {};
    for (let i = 0; i < 33; i++) nested = [nested];
    const bytes = Buffer.from(JSON.stringify({ fixture_id: "f", kind: "events", schema_version: "1", rows: [nested] }), "utf8");
    assert.throws(() => presplitRows(bytes), (e) => e.code === "INPUT_TOO_DEEP");
  });
  it("accepts depth exactly 32", () => {
    let nested = {};
    for (let i = 0; i < 29; i++) nested = [nested];
    const bytes = Buffer.from(JSON.stringify({ fixture_id: "f", kind: "events", schema_version: "1", rows: [nested] }), "utf8");
    const { rowSpans } = presplitRows(bytes);
    assert.equal(rowSpans.length, 1);
  });
  it("rejects unknown top-level properties and non-array rows", () => {
    const bad1 = Buffer.from(JSON.stringify({ fixture_id: "f", kind: "events", schema_version: "1", rows: [], extra: 1 }), "utf8");
    assert.throws(() => presplitRows(bad1), (e) => e.code === "INVALID_INPUT");
    const bad2 = Buffer.from(JSON.stringify({ fixture_id: "f", kind: "events", schema_version: "1", rows: {} }), "utf8");
    assert.throws(() => presplitRows(bad2), (e) => e.code === "INVALID_INPUT");
  });
});
