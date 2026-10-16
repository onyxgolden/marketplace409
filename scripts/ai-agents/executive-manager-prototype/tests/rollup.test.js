import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveStatement, computeMetricDedupAndContradictions, computePopulationTotals, computeGroupTotals, computeHeaderComparisons } from "../src/rollup.js";

test("deriveStatement: single verified occurrence is valid, not invalid", () => {
  const d = deriveStatement("item-1", [{ report_id: "r1", support_strength: "verified", flags: [], source_label: "x" }]);
  assert.equal(d.support_strength, "verified");
  assert.equal(d.invalid, false);
});

test("deriveStatement: min-wins across tiers without a contradicted flag is NOT invalid", () => {
  const d = deriveStatement("item-1", [
    { report_id: "r1", support_strength: "verified", flags: [], source_label: "a" },
    { report_id: "r2", support_strength: "unverifiable", flags: [], source_label: "b" },
  ]);
  assert.equal(d.support_strength, "unverifiable");
  assert.equal(d.invalid, false);
});

test("deriveStatement: differing strengths WITH a contradicted flag is invalid", () => {
  const d = deriveStatement("item-1", [
    { report_id: "r1", support_strength: "verified", flags: [], source_label: "a" },
    { report_id: "r2", support_strength: "attributed_only", flags: ["contradicted"], source_label: "b" },
  ]);
  assert.equal(d.invalid, true);
  assert.equal(d.invalid_reason, "CONTRADICTORY_STRENGTHS");
  assert.equal(d.support_strength, null);
});

test("deriveStatement: contradicted flag present but SAME strength is NOT invalid (flags alone never trigger it)", () => {
  const d = deriveStatement("item-1", [
    { report_id: "r1", support_strength: "verified", flags: [], source_label: "a" },
    { report_id: "r2", support_strength: "verified", flags: ["contradicted"], source_label: "b" },
  ]);
  assert.equal(d.invalid, false);
  assert.equal(d.support_strength, "verified");
});

test("deriveStatement: unknown support label is always invalid, regardless of flags", () => {
  const d = deriveStatement("item-1", [{ report_id: "r1", support_strength: "green", flags: [], source_label: "a" }]);
  assert.equal(d.invalid, true);
  assert.equal(d.invalid_reason, "UNKNOWN_SUPPORT_LABEL");
});

test("deriveStatement: null support_strength folds into unverifiable tier for min-wins", () => {
  const d = deriveStatement("item-1", [{ report_id: "r1", support_strength: null, flags: ["mismatch"], source_label: "a" }]);
  assert.equal(d.support_strength, "unverifiable");
  assert.equal(d.invalid, false);
});

test("deriveStatement: flags are a set union across occurrences, order-independent", () => {
  const d = deriveStatement("item-1", [
    { report_id: "r1", support_strength: "verified", flags: ["mismatch"], source_label: "a" },
    { report_id: "r2", support_strength: "verified", flags: ["contradicted"], source_label: "b" },
  ]);
  assert.deepEqual(d.flags, ["contradicted", "mismatch"]);
});

test("deriveStatement: occurrences are preserved sorted by report_id, byte-for-byte source_label", () => {
  const d = deriveStatement("item-1", [
    { report_id: "r2", support_strength: "verified", flags: [], source_label: "second" },
    { report_id: "r1", support_strength: "verified", flags: [], source_label: "first" },
  ]);
  assert.deepEqual(d.occurrences.map((o) => o.report_id), ["r1", "r2"]);
  assert.equal(d.occurrences[0].source_label, "first");
});

function metric(over = {}) {
  return { report_id: "r1", line_item_id: "L1", metric_key: "tickets", population_id: "pop-a", unit: "count", period: "2026-q3", currency: null, value: 10, citation: {}, ...over };
}

test("computeMetricDedupAndContradictions: same full identity + same value dedups to one link", () => {
  const { dedupLinks, contradictions } = computeMetricDedupAndContradictions([metric({ report_id: "r1" }), metric({ report_id: "r2" })]);
  assert.equal(dedupLinks.length, 1);
  assert.equal(dedupLinks[0].occurrences.length, 2);
  assert.equal(contradictions.length, 0);
});

test("computeMetricDedupAndContradictions: same full identity + different value is a contradiction, no winner", () => {
  const { dedupLinks, contradictions, resolvedByFullKey } = computeMetricDedupAndContradictions([metric({ report_id: "r1", value: 10 }), metric({ report_id: "r2", value: 15 })]);
  assert.equal(dedupLinks.length, 0);
  assert.equal(contradictions.length, 1);
  assert.deepEqual(contradictions[0].occurrences.map((o) => o.value).sort(), [10, 15]);
  assert.equal(resolvedByFullKey.size, 0);
});

test("computeMetricDedupAndContradictions: different line_item_id under the same group is NOT a dedup candidate", () => {
  const { dedupLinks, contradictions } = computeMetricDedupAndContradictions([metric({ report_id: "r1", line_item_id: "L1", value: 10 }), metric({ report_id: "r2", line_item_id: "L2", value: 20 })]);
  assert.equal(dedupLinks.length, 2);
  assert.equal(contradictions.length, 0);
});

test("computePopulationTotals: sums distinct deduped line items within one population", () => {
  const metrics = [metric({ line_item_id: "L1", value: 10 }), metric({ line_item_id: "L2", value: 20 })];
  const { resolvedByFullKey } = computeMetricDedupAndContradictions(metrics);
  const totals = computePopulationTotals(metrics, resolvedByFullKey);
  const t = [...totals.values()][0];
  assert.equal(t.total_value, 30);
  assert.equal(t.evidence_state, "verified");
});

test("computePopulationTotals: a contradicted line item makes the WHOLE group unverifiable, others unaffected", () => {
  const metrics = [metric({ report_id: "r1", line_item_id: "L1", value: 10 }), metric({ report_id: "r2", line_item_id: "L1", value: 99 }), metric({ line_item_id: "L2", value: 20 })];
  const { resolvedByFullKey } = computeMetricDedupAndContradictions(metrics);
  const totals = computePopulationTotals(metrics, resolvedByFullKey);
  const t = [...totals.values()][0];
  assert.equal(t.evidence_state, "unverifiable");
  assert.equal(t.total_value, null);
  // L2 (uncontested) still counted as contributing even though the
  // group total itself is withheld — per-line evidence isn't erased.
  assert.ok(t.contributing_line_item_ids.includes("L2"));
});

test("computeGroupTotals: sums member populations only when group is disjoint:true and all members verified", () => {
  const metrics = [metric({ population_id: "pop-a", line_item_id: "L1", value: 10 }), metric({ population_id: "pop-b", line_item_id: "L2", value: 20 })];
  const { resolvedByFullKey } = computeMetricDedupAndContradictions(metrics);
  const totals = computePopulationTotals(metrics, resolvedByFullKey);
  const groups = computeGroupTotals(totals, [{ group_id: "combined", member_population_ids: ["pop-a", "pop-b"], disjoint: true }]);
  const g = [...groups.values()][0];
  assert.equal(g.total_value, 30);
  assert.equal(g.evidence_state, "verified");
});

test("computeGroupTotals: disjoint:false registered group is unverifiable even if members are individually clean", () => {
  const metrics = [metric({ population_id: "pop-a", line_item_id: "L1", value: 10 }), metric({ population_id: "pop-b", line_item_id: "L2", value: 20 })];
  const { resolvedByFullKey } = computeMetricDedupAndContradictions(metrics);
  const totals = computePopulationTotals(metrics, resolvedByFullKey);
  const groups = computeGroupTotals(totals, [{ group_id: "combined", member_population_ids: ["pop-a", "pop-b"], disjoint: false }]);
  const g = [...groups.values()][0];
  assert.equal(g.evidence_state, "unverifiable");
  assert.equal(g.total_value, null);
});

test("computeGroupTotals: a missing member population makes the group unverifiable (not fabricated from the partial members present)", () => {
  const metrics = [metric({ population_id: "pop-a", line_item_id: "L1", value: 10 })]; // pop-b never appears
  const { resolvedByFullKey } = computeMetricDedupAndContradictions(metrics);
  const totals = computePopulationTotals(metrics, resolvedByFullKey);
  const groups = computeGroupTotals(totals, [{ group_id: "combined", member_population_ids: ["pop-a", "pop-b"], disjoint: true }]);
  assert.equal(groups.size, 1);
  const g = [...groups.values()][0];
  assert.equal(g.evidence_state, "unverifiable");
  assert.equal(g.total_value, null);
});

test("computeGroupTotals: NO member of the group present in this dimension at all -> not applicable, no entry fabricated", () => {
  const metrics = [metric({ population_id: "pop-unrelated", line_item_id: "L1", value: 10 })];
  const { resolvedByFullKey } = computeMetricDedupAndContradictions(metrics);
  const totals = computePopulationTotals(metrics, resolvedByFullKey);
  const groups = computeGroupTotals(totals, [{ group_id: "combined", member_population_ids: ["pop-a", "pop-b"], disjoint: true }]);
  assert.equal(groups.size, 0);
});

test("computeHeaderComparisons: header value never feeds the total — mismatch is a successful, verified finding", () => {
  const metrics = [metric({ line_item_id: "L1", value: 10 })];
  const { resolvedByFullKey } = computeMetricDedupAndContradictions(metrics);
  const totals = computePopulationTotals(metrics, resolvedByFullKey);
  const groups = computeGroupTotals(totals, []);
  const headers = [{ claim_id: "h1", report_id: "r1", metric_key: "tickets", population_id: "pop-a", unit: "count", period: "2026-q3", currency: null, claimed_value: 999, citation: {} }];
  const out = computeHeaderComparisons(headers, totals, groups);
  assert.equal(out[0].evidence_state, "verified");
  assert.equal(out[0].computed_value, 10);
  assert.equal(out[0].match, false);
});

test("computeHeaderComparisons: unknown population/group reference is unverifiable, not guessed", () => {
  const headers = [{ claim_id: "h1", report_id: "r1", metric_key: "tickets", population_id: "nonexistent", unit: "count", period: "2026-q3", currency: null, claimed_value: 1, citation: {} }];
  const out = computeHeaderComparisons(headers, new Map(), new Map());
  assert.equal(out[0].evidence_state, "unverifiable");
  assert.equal(out[0].computed_value, null);
  assert.equal(out[0].match, null);
});
