/**
 * compare.js — deterministic comparison core per contract §8.
 *
 * Input:  {task_id, lane, confirmed_set_ref, feature_taxonomy_ref,
 *          competitor_source_refs, forge_base_pin, requested_action,
 *          as_of_date, cells: pre-evaluated cell sets per subject}
 * Output: {schema_version, task_id, internal_only, status, cells,
 *          comparisons, source_index, contradictions, research_gaps,
 *          opportunities, diagnostics, authorization_granted:false,
 *          publication_performed:false, ...}
 *
 * The core is read-only and deterministic: stable ID ordering, canonical
 * output, bounded sizes. It never fetches, never writes, never publishes.
 */

import {
  SCHEMA_VERSION,
  LIMITS,
  validateTaskInput,
  refusal,
} from "./schemas.js";
import { PROPOSITION_IDS } from "./taxonomy.js";
import { validateCell } from "./cells.js";
import { scoreComparison, summarizeComparisons } from "./rubric.js";

function stableSort(arr, keyFn) {
  return [...arr].sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/**
 * Run one internal comparison task.
 * cellsBySubject: {forge: Cell[], "<vendor_id>": Cell[]} — pre-evaluated.
 */
export function runComparison(input, cellsBySubject) {
  const inputErrors = validateTaskInput(input);
  if (inputErrors.length > 0) {
    return refusal("REFUSED", "INPUT_INVALID", inputErrors);
  }
  const subjects = Object.keys(cellsBySubject || {});
  if (!subjects.includes("forge")) {
    return refusal("REFUSED", "INPUT_INVALID", ["cellsBySubject must include 'forge'"]);
  }

  const diagnostics = [];
  const allCells = [];
  const contradictions = [];
  const seenIds = new Set();

  for (const subject of stableSort(subjects, (s) => s)) {
    const cells = cellsBySubject[subject] || [];
    for (const cell of cells) {
      const cellErrors = validateCell(cell);
      if (cellErrors.length > 0) {
        diagnostics.push({ subject, feature_id: cell.feature_id, issue: "cell_invalid", errors: cellErrors });
        continue;
      }
      const id = `${subject}:${cell.feature_id}`;
      if (seenIds.has(id)) {
        diagnostics.push({ subject, feature_id: cell.feature_id, issue: "duplicate_cell" });
        continue;
      }
      seenIds.add(id);
      allCells.push({ ...cell, subject });
      if (cell.conflict) contradictions.push({ subject, feature_id: cell.feature_id, reason_code: cell.reason_code });
    }
  }

  if (allCells.length > LIMITS.maxCells) {
    return refusal("BLOCKED", "INPUT_LIMIT", [`${allCells.length} cells > ${LIMITS.maxCells}`]);
  }

  // Score per proposition per competitor.
  const comparisons = [];
  const research_gaps = [];
  const competitors = subjects.filter((s) => s !== "forge");
  const forgeByFeature = Object.fromEntries(
    (cellsBySubject.forge || []).map((c) => [c.feature_id, c])
  );

  for (const feature_id of stableSort(PROPOSITION_IDS, (x) => x)) {
    for (const vendor of stableSort(competitors, (x) => x)) {
      const forgeCell = forgeByFeature[feature_id] || null;
      const compCell = (cellsBySubject[vendor] || []).find((c) => c.feature_id === feature_id) || null;
      if (!forgeCell && !compCell) continue;
      const { verdict, basis } = scoreComparison({ feature_id, forge: forgeCell, competitor: compCell });
      comparisons.push({
        feature_id,
        vendor_id: vendor,
        forge_evidence: forgeCell?.evidence_state || "missing",
        competitor_evidence: compCell?.evidence_state || "missing",
        verdict,
        basis,
      });
      if (verdict === "undetermined") {
        research_gaps.push({
          feature_id,
          vendor_id: vendor,
          gap_type: !forgeCell || !compCell ? "missing_cell" : "evidence_gap",
          next_step: `bounded discovery for ${feature_id} on ${!forgeCell ? "FORGE" : vendor}`,
        });
      }
    }
  }

  const source_index = stableSort(input.competitor_source_refs || [], (r) => r.source_id).map((r) => ({
    source_id: r.source_id,
    vendor_id: r.vendor_id,
    product_id: r.product_id,
    url: r.url,
    accessed_at: r.accessed_at,
    access_status: r.access_status,
  }));

  const status = allCells.length === 0 ? "BLOCKED" : diagnostics.length > 0 ? "PARTIAL" : "COMPARED";

  const output = {
    schema_version: SCHEMA_VERSION,
    task_id: input.task_id,
    internal_only: true,
    status,
    complete: status === "COMPARED",
    lane: input.lane,
    as_of_date: input.as_of_date,
    forge_base_pin: input.forge_base_pin,
    confirmed_set_ref: input.confirmed_set_ref,
    products: competitors,
    cells: stableSort(allCells, (c) => `${c.subject}:${c.feature_id}`),
    comparisons: stableSort(comparisons, (c) => `${c.vendor_id}:${c.feature_id}`),
    comparison_summary: summarizeComparisons(comparisons),
    source_index,
    contradictions: stableSort(contradictions, (c) => `${c.subject}:${c.feature_id}`),
    research_gaps: stableSort(research_gaps, (g) => `${g.vendor_id}:${g.feature_id}`),
    opportunities: [],
    diagnostics,
    authorization_granted: false,
    publication_performed: false,
    trial_evaluation_complete: false,
    trial_ledger_refs: [],
  };

  const bytes = JSON.stringify(output).length;
  if (bytes > LIMITS.maxOutputBytes) {
    return refusal("BLOCKED", "OUTPUT_LIMIT", [`${bytes} bytes > ${LIMITS.maxOutputBytes}`]);
  }
  return output;
}
