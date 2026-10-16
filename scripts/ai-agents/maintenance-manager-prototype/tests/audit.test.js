import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyWorkOrder, aggregateWorkOrders, computePmCompliance, computeHeaderComparisons, ageBinOf } from "../src/audit.js";
import { dayIndexOfMs } from "../src/canonical.js";

const AS_OF = "2026-06-01T00:00:00Z";
const asOfMs = Date.parse(AS_OF);
const asOfDay = dayIndexOfMs(asOfMs);
const registeredAssets = new Set(["AST-1"]);

function wo(overrides) {
  return {
    work_order_id: "WO-1", asset_id: "AST-1", created_ms: asOfMs, status: "OPEN", priority: "P2",
    completed_ms: null, due_ms: null,
    ...overrides,
  };
}

test("ageBinOf is inclusive at every named boundary", () => {
  assert.equal(ageBinOf(0), "bin_0_7");
  assert.equal(ageBinOf(7), "bin_0_7");
  assert.equal(ageBinOf(8), "bin_8_30");
  assert.equal(ageBinOf(30), "bin_8_30");
  assert.equal(ageBinOf(31), "bin_31_90");
  assert.equal(ageBinOf(90), "bin_31_90");
  assert.equal(ageBinOf(91), "bin_91_plus");
  assert.equal(ageBinOf(1000), "bin_91_plus");
});

test("classifyWorkOrder: orphan asset is an integrity finding even when every other field is valid", () => {
  const c = classifyWorkOrder(wo({ asset_id: "AST-UNKNOWN" }), { asOfMs, asOfDay, registeredAssets });
  assert.equal(c.kind, "integrity");
  assert.equal(c.reason, "ORPHAN_ASSET");
});

test("classifyWorkOrder: future-created takes priority check order (checked before completion validity)", () => {
  const futureMs = asOfMs + 86400000;
  const c = classifyWorkOrder(wo({ created_ms: futureMs }), { asOfMs, asOfDay, registeredAssets });
  assert.equal(c.kind, "integrity");
  assert.equal(c.reason, "FUTURE_CREATED");
});

test("classifyWorkOrder: COMPLETED with null completed_ms is INVALID_COMPLETION, not a closure", () => {
  const c = classifyWorkOrder(wo({ status: "COMPLETED", completed_ms: null }), { asOfMs, asOfDay, registeredAssets });
  assert.equal(c.kind, "integrity");
  assert.equal(c.reason, "INVALID_COMPLETION");
});

test("classifyWorkOrder: COMPLETED with a future completed_ms (> as_of) is INVALID_COMPLETION", () => {
  const c = classifyWorkOrder(wo({ status: "COMPLETED", completed_ms: asOfMs + 86400000 }), { asOfMs, asOfDay, registeredAssets });
  assert.equal(c.kind, "integrity");
  assert.equal(c.reason, "INVALID_COMPLETION");
});

test("classifyWorkOrder: COMPLETED with completed_ms before created_ms is INVALID_COMPLETION", () => {
  const c = classifyWorkOrder(wo({ created_ms: asOfMs, status: "COMPLETED", completed_ms: asOfMs - 86400000 * 5 }), { asOfMs, asOfDay, registeredAssets });
  assert.equal(c.kind, "integrity");
  assert.equal(c.reason, "INVALID_COMPLETION");
});

test("classifyWorkOrder: a valid COMPLETED order classifies as completed, excluded from backlog", () => {
  const c = classifyWorkOrder(wo({ created_ms: asOfMs - 86400000 * 10, status: "COMPLETED", completed_ms: asOfMs - 86400000 * 2 }), { asOfMs, asOfDay, registeredAssets });
  assert.equal(c.kind, "completed");
});

test("classifyWorkOrder: CANCELLED is excluded from backlog with its own kind", () => {
  const c = classifyWorkOrder(wo({ status: "CANCELLED" }), { asOfMs, asOfDay, registeredAssets });
  assert.equal(c.kind, "cancelled");
});

test("classifyWorkOrder: overdue boundary — due==as_of is not overdue, due==as_of-1day is overdue, missing due is unknown", () => {
  const dueToday = classifyWorkOrder(wo({ due_ms: asOfMs }), { asOfMs, asOfDay, registeredAssets });
  const dueYesterday = classifyWorkOrder(wo({ due_ms: asOfMs - 86400000 }), { asOfMs, asOfDay, registeredAssets });
  const dueUnknown = classifyWorkOrder(wo({ due_ms: null }), { asOfMs, asOfDay, registeredAssets });
  assert.equal(dueToday.overdue, "not_overdue");
  assert.equal(dueYesterday.overdue, "overdue");
  assert.equal(dueUnknown.overdue, "unknown");
});

test("aggregateWorkOrders: a single integrity record excludes only itself, backlog/cancelled still counted", () => {
  const classified = [
    classifyWorkOrder(wo({ work_order_id: "WO-CLEAN", due_ms: null }), { asOfMs, asOfDay, registeredAssets }),
    classifyWorkOrder(wo({ work_order_id: "WO-BAD", asset_id: "AST-UNKNOWN" }), { asOfMs, asOfDay, registeredAssets }),
    classifyWorkOrder(wo({ work_order_id: "WO-CANC", status: "CANCELLED" }), { asOfMs, asOfDay, registeredAssets }),
  ];
  const agg = aggregateWorkOrders(classified);
  assert.equal(agg.backlog.total, 1);
  assert.equal(agg.cancelled_count, 1);
  assert.equal(agg.integrityFindings.length, 1);
  assert.equal(agg.integrityFindings[0].record_id, "WO-BAD");
});

function occ(overrides) {
  return {
    occurrence_id: "PM-1", asset_id: "AST-1", due_ms: Date.parse("2026-05-10T00:00:00Z"),
    window_start_ms: Date.parse("2026-05-05T00:00:00Z"), window_end_ms: Date.parse("2026-05-15T00:00:00Z"),
    linked_work_order_id: "WO-1",
    ...overrides,
  };
}

const windowStartMs = Date.parse("2026-01-01T00:00:00Z");
const windowEndMs = Date.parse("2026-12-31T00:00:00Z");

test("computePmCompliance: on-window completion counts in the numerator", () => {
  const woMap = new Map([["WO-1", { kind: "completed", completed_ms: Date.parse("2026-05-10T00:00:00Z") }]]);
  const r = computePmCompliance([occ()], { asOfMs, windowStartMs, windowEndMs, registeredAssets, workOrderById: woMap, workOrderIntegrityIds: new Set() }, true);
  assert.equal(r.section.basis_state, "VERIFIED");
  assert.equal(r.section.numerator, 1);
  assert.equal(r.section.denominator, 1);
});

test("computePmCompliance: early and late completions are tracked but never counted in the numerator", () => {
  const earlyMap = new Map([["WO-1", { kind: "completed", completed_ms: Date.parse("2026-05-01T00:00:00Z") }]]);
  const early = computePmCompliance([occ()], { asOfMs, windowStartMs, windowEndMs, registeredAssets, workOrderById: earlyMap, workOrderIntegrityIds: new Set() }, true);
  assert.equal(early.section.numerator, 0);
  assert.equal(early.section.early_count, 1);

  const lateMap = new Map([["WO-1", { kind: "completed", completed_ms: Date.parse("2026-05-20T00:00:00Z") }]]);
  const late = computePmCompliance([occ()], { asOfMs, windowStartMs, windowEndMs, registeredAssets, workOrderById: lateMap, workOrderIntegrityIds: new Set() }, true);
  assert.equal(late.section.numerator, 0);
  assert.equal(late.section.late_count, 1);
});

test("computePmCompliance: cancelled link and unlinked occurrence are tracked, never counted", () => {
  const cancelledMap = new Map([["WO-1", { kind: "cancelled" }]]);
  const cancelled = computePmCompliance([occ()], { asOfMs, windowStartMs, windowEndMs, registeredAssets, workOrderById: cancelledMap, workOrderIntegrityIds: new Set() }, true);
  assert.equal(cancelled.section.numerator, 0);
  assert.equal(cancelled.section.cancelled_link_count, 1);

  const unlinked = computePmCompliance([occ({ linked_work_order_id: null })], { asOfMs, windowStartMs, windowEndMs, registeredAssets, workOrderById: new Map(), workOrderIntegrityIds: new Set() }, true);
  assert.equal(unlinked.section.numerator, 0);
  assert.equal(unlinked.section.unlinked_count, 1);
});

test("computePmCompliance: denominator poisoning — a single orphan-asset occurrence poisons the WHOLE measure, not just itself", () => {
  const woMap = new Map([["WO-1", { kind: "completed", completed_ms: Date.parse("2026-05-10T00:00:00Z") }]]);
  const clean = occ({ occurrence_id: "PM-CLEAN" });
  const poisoned = occ({ occurrence_id: "PM-POISON", asset_id: "AST-UNKNOWN", linked_work_order_id: null });
  const r = computePmCompliance([clean, poisoned], { asOfMs, windowStartMs, windowEndMs, registeredAssets, workOrderById: woMap, workOrderIntegrityIds: new Set() }, true);
  assert.equal(r.section.basis_state, "UNVERIFIABLE");
  assert.equal(r.section.denominator, null, "must not silently reduce the denominator to the clean subset");
  assert.deepEqual(r.section.poisoning_occurrence_ids, ["PM-POISON"]);
});

test("computePmCompliance: dangling link (no such work order at all) poisons the measure", () => {
  const r = computePmCompliance([occ({ linked_work_order_id: "WO-NONEXISTENT" })], { asOfMs, windowStartMs, windowEndMs, registeredAssets, workOrderById: new Map(), workOrderIntegrityIds: new Set() }, true);
  assert.equal(r.section.basis_state, "UNVERIFIABLE");
  assert.equal(r.additionalFindings.some((f) => f.code === "DANGLING_PM_LINK"), true);
});

test("computePmCompliance: a link to an integrity-invalid work order poisons the measure", () => {
  const woMap = new Map([["WO-1", { kind: "integrity" }]]);
  const r = computePmCompliance([occ()], { asOfMs, windowStartMs, windowEndMs, registeredAssets, workOrderById: woMap, workOrderIntegrityIds: new Set(["WO-1"]) }, true);
  assert.equal(r.section.basis_state, "UNVERIFIABLE");
  assert.equal(r.additionalFindings.some((f) => f.code === "PM_LINK_TO_INVALID_WORK_ORDER"), true);
});

// ---------------------------------------------------------------------
// MM-S1-002: an unverifiable citation (span out of bounds) is its own
// integrity finding — never silently kept as a clean backlog/completed
// record, and never silently excluded from poisoning the PM measure.
// ---------------------------------------------------------------------
const VERIFIED_CITATION = { verification: "VERIFIED" };
const UNVERIFIED_CITATION = { verification: "UNVERIFIED" };

test("classifyWorkOrder: an unverified citation is its own integrity finding, checked after structural asset/date checks but before status classification", () => {
  const c = classifyWorkOrder(wo({}), { asOfMs, asOfDay, registeredAssets, citation: UNVERIFIED_CITATION });
  assert.equal(c.kind, "integrity");
  assert.equal(c.reason, "UNVERIFIABLE_CITATION");
  assert.equal(c.citation.verification, "UNVERIFIED");
});

test("classifyWorkOrder: orphan asset still wins over a bad citation (structural checks run first)", () => {
  const c = classifyWorkOrder(wo({ asset_id: "AST-UNKNOWN" }), { asOfMs, asOfDay, registeredAssets, citation: UNVERIFIED_CITATION });
  assert.equal(c.reason, "ORPHAN_ASSET");
});

test("classifyWorkOrder: an otherwise-clean backlog record carries its VERIFIED citation", () => {
  const c = classifyWorkOrder(wo({}), { asOfMs, asOfDay, registeredAssets, citation: VERIFIED_CITATION });
  assert.equal(c.kind, "backlog");
  assert.equal(c.citation.verification, "VERIFIED");
});

test("computePmCompliance: an unverifiable citation on a due occurrence poisons the whole measure and is recorded once, not duplicated", () => {
  const woMap = new Map([["WO-1", { kind: "completed", completed_ms: Date.parse("2026-05-10T00:00:00Z") }]]);
  const occA = occ({ occurrence_id: "PM-BADCITE" });
  const citations = new Map([["PM-BADCITE", UNVERIFIED_CITATION]]);
  const r = computePmCompliance([occA], { asOfMs, windowStartMs, windowEndMs, registeredAssets, workOrderById: woMap, workOrderIntegrityIds: new Set(), citations }, true);
  assert.equal(r.section.basis_state, "UNVERIFIABLE");
  assert.deepEqual(r.section.poisoning_occurrence_ids, ["PM-BADCITE"]);
  const citeFindings = r.additionalFindings.filter((f) => f.code === "UNVERIFIABLE_CITATION");
  assert.equal(citeFindings.length, 1, "exactly one UNVERIFIABLE_CITATION finding, not duplicated by the due-member poisoning pass");
  assert.equal(citeFindings[0].citation.verification, "UNVERIFIED");
});

test("computePmCompliance: an unverifiable citation on a NON-due occurrence is still its own finding, independent of PM-window relevance", () => {
  const outOfWindow = occ({ occurrence_id: "PM-BADCITE-NODUE", due_ms: Date.parse("2030-01-01T00:00:00Z") });
  const citations = new Map([["PM-BADCITE-NODUE", UNVERIFIED_CITATION]]);
  const r = computePmCompliance([outOfWindow], { asOfMs, windowStartMs, windowEndMs, registeredAssets, workOrderById: new Map(), workOrderIntegrityIds: new Set(), citations }, true);
  assert.equal(r.additionalFindings.some((f) => f.code === "UNVERIFIABLE_CITATION" && f.record_id === "PM-BADCITE-NODUE"), true);
});

// ---------------------------------------------------------------------
// MM-S1-003: claimed_summary header comparisons — a claim never seeds
// or overwrites the computed value; an unverified basis is UNKNOWN,
// never silently a MATCH.
// ---------------------------------------------------------------------
test("computeHeaderComparisons: returns [] when there's no claimed summary", () => {
  assert.deepEqual(computeHeaderComparisons(null, { basis_state: "VERIFIED", display_percent: "75.00%" }), []);
});

test("computeHeaderComparisons: exact match between claim and computed value", () => {
  const verifiedCitation = { verification: "VERIFIED", repo: "r", path: "p.md", commit: "c".repeat(40), blob: "b".repeat(40), algorithm: "git-sha1", revision: "rev", quoted_span: "75.00", span: { start_byte: 0, end_byte: 5, quoted_text: "75.00" } };
  const out = computeHeaderComparisons({ claims: [{ claim_id: "H1", metric: "pm_compliance_percent", claimed_value: "75.00" }] }, { basis_state: "VERIFIED", display_percent: "75.00%" }, new Map([["H1", verifiedCitation]]));
  assert.equal(out[0].evidence_state, "MATCH");
  assert.equal(out[0].computed_value, "75.00");
  assert.equal(out[0].claimed_value, "75.00", "the claimed value is preserved, not overwritten by the computed one");
  assert.equal(out[0].claim_citation.verification, "VERIFIED", "the verified provenance citation is carried into the comparison");
});

test("computeHeaderComparisons: the brief's named 98%-vs-computed case is a MISMATCH with both values retained", () => {
  const verifiedCitation = { verification: "VERIFIED", repo: "r", path: "p.md", commit: "c".repeat(40), blob: "b".repeat(40), algorithm: "git-sha1", revision: "rev", quoted_span: "98.00", span: { start_byte: 0, end_byte: 5, quoted_text: "98.00" } };
  const out = computeHeaderComparisons({ claims: [{ claim_id: "H2", metric: "pm_compliance_percent", claimed_value: "98.00" }] }, { basis_state: "VERIFIED", display_percent: "100.00%" }, new Map([["H2", verifiedCitation]]));
  assert.equal(out[0].evidence_state, "MISMATCH");
  assert.equal(out[0].claimed_value, "98.00");
  assert.equal(out[0].computed_value, "100.00");
});

test("computeHeaderComparisons: an unverified computed basis is UNKNOWN, never silently a MATCH", () => {
  const verifiedCitation = { verification: "VERIFIED", repo: "r", path: "p.md", commit: "c".repeat(40), blob: "b".repeat(40), algorithm: "git-sha1", revision: "rev", quoted_span: "50.00", span: { start_byte: 0, end_byte: 5, quoted_text: "50.00" } };
  const out = computeHeaderComparisons({ claims: [{ claim_id: "H3", metric: "pm_compliance_percent", claimed_value: "50.00" }] }, { basis_state: "UNVERIFIABLE", display_percent: null }, new Map([["H3", verifiedCitation]]));
  assert.equal(out[0].evidence_state, "UNKNOWN");
  assert.equal(out[0].computed_value, null);
});

test("computeHeaderComparisons: MM-S1-003 — a claim without verified provenance is UNKNOWN with explicit UNAVAILABLE citation, never MATCH", () => {
  // No citation supplied: the claim has no provenance.
  const out = computeHeaderComparisons({ claims: [{ claim_id: "H4", metric: "pm_compliance_percent", claimed_value: "75.00" }] }, { basis_state: "VERIFIED", display_percent: "75.00%" }, new Map());
  assert.equal(out[0].evidence_state, "UNKNOWN", "a claim without verified provenance can never be MATCH, even when the values agree");
  assert.equal(out[0].claim_citation.verification, "UNAVAILABLE");
  assert.ok(out[0].claim_citation.reason, "the unavailable state must carry an explicit reason");
});

test("computePmCompliance: zero due occurrences is a typed NO_DUE_OCCURRENCES when the population is complete, UNVERIFIABLE otherwise", () => {
  const complete = computePmCompliance([], { asOfMs, windowStartMs, windowEndMs, registeredAssets, workOrderById: new Map(), workOrderIntegrityIds: new Set() }, true);
  assert.equal(complete.section.basis_state, "NO_DUE_OCCURRENCES");
  assert.equal(complete.section.denominator, 0);

  const incomplete = computePmCompliance([], { asOfMs, windowStartMs, windowEndMs, registeredAssets, workOrderById: new Map(), workOrderIntegrityIds: new Set() }, false);
  assert.equal(incomplete.section.basis_state, "UNVERIFIABLE");
  assert.equal(incomplete.section.denominator, null);
});
