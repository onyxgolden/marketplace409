import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyWorkOrder, aggregateWorkOrders, computePmCompliance, ageBinOf } from "../src/audit.js";
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

test("computePmCompliance: zero due occurrences is a typed NO_DUE_OCCURRENCES when the population is complete, UNVERIFIABLE otherwise", () => {
  const complete = computePmCompliance([], { asOfMs, windowStartMs, windowEndMs, registeredAssets, workOrderById: new Map(), workOrderIntegrityIds: new Set() }, true);
  assert.equal(complete.section.basis_state, "NO_DUE_OCCURRENCES");
  assert.equal(complete.section.denominator, 0);

  const incomplete = computePmCompliance([], { asOfMs, windowStartMs, windowEndMs, registeredAssets, workOrderById: new Map(), workOrderIntegrityIds: new Set() }, false);
  assert.equal(incomplete.section.basis_state, "UNVERIFIABLE");
  assert.equal(incomplete.section.denominator, null);
});
