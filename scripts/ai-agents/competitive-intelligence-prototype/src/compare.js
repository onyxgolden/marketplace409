/**
 * compare.js — deterministic comparison core per contract §8.
 *
 * Input:  {task_id, lane, confirmed_set_ref, feature_taxonomy_ref,
 *          competitor_source_refs, forge_base_pin, requested_action,
 *          as_of_date}
 * cellsBySubject: {forge: Cell[], "<vendor_id>": Cell[]} — pre-evaluated.
 * trusted: host-injected trusted context (trust.js) — REQUIRED. Without it
 *   the core refuses: pins, subjects, and citations are never self-attested.
 *
 * Output: {schema_version, task_id, internal_only, status, cells,
 *          comparisons, source_index, contradictions, research_gaps,
 *          opportunities, diagnostics, authorization_granted:false,
 *          publication_performed:false, ...}
 *
 * The core is read-only and deterministic: stable ID ordering, canonical
 * output, bounded sizes. It never fetches, never writes, never publishes.
 *
 * Admission (CI-001): the trusted confirmed set, admitted source store,
 * verified FORGE snapshot, fixed clock, and taxonomy digest are actually
 * consulted. Unconfirmed subjects and unverifiable pins are refused;
 * cells whose citations cannot be resolved become unsupported, never scored.
 *
 * Canonical representation (CI-002): exactly one admitted cell object per
 * subject+feature drives BOTH the displayed matrix and the scoring. Displayed
 * cells and scored inputs are the same objects by construction.
 */

import {
  SCHEMA_VERSION,
  LIMITS,
  validateTaskInput,
  refusal,
} from "./schemas.js";
import { PROPOSITION_IDS, TAXONOMY_DIGEST } from "./taxonomy.js";
import { validateCell } from "./cells.js";
import { scoreComparison, summarizeComparisons } from "./rubric.js";
import {
  validateTrustedContext,
  admitSubject,
  admitForgePin,
  resolveCitation,
} from "./trust.js";

function stableSort(arr, keyFn) {
  return [...arr].sort((a, b) => {
    const ka = keyFn(a);
    const kb = keyFn(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function utf8Bytes(s) {
  return Buffer.byteLength(s, "utf8");
}

/**
 * Admit one pre-evaluated cell: structural validation, subject binding,
 * citation resolution against the admitted source store, freshness from the
 * trusted clock. Returns {admitted} or {admitted: null, diagnostic}.
 * Cells with unresolvable citations are downgraded to unsupported —
 * unregistered evidence can never drive a score.
 */
function admitCell(trusted, subject, cell) {
  const cellErrors = validateCell(cell);
  if (cellErrors.length > 0) {
    return { admitted: null, diagnostic: { issue: "cell_invalid", errors: cellErrors } };
  }
  // The cell's own subject binding must match the subject key it arrived under.
  if (cell.subject_ref.vendor_id !== subject) {
    return {
      admitted: null,
      diagnostic: {
        issue: "subject_mismatch",
        errors: [`cell subject_ref.vendor_id=${cell.subject_ref.vendor_id} != subject key ${subject}`],
      },
    };
  }
  // Resolve every citation against the admitted store.
  const failures = [];
  let freshness = "fresh";
  for (const sid of cell.citations || []) {
    const r = resolveCitation(trusted, sid, subject);
    if (!r.ok) {
      failures.push({ source_id: sid, reason: r.reason });
    } else if (r.freshness === "stale") {
      freshness = "stale";
    } else if (r.freshness === "unknown" && freshness === "fresh") {
      freshness = "unknown";
    }
  }
  // FORGE cells may ground in the verified snapshot via forge_refs instead.
  let forgeRefsOk = false;
  if (Array.isArray(cell.forge_refs) && cell.forge_refs.length > 0) {
    const snap = trusted.forgeSnapshot;
    forgeRefsOk = cell.forge_refs.every(
      (fr) => fr && fr.repo === snap.repo && fr.commit === snap.commit && typeof fr.path === "string" && fr.path,
    );
    if (!forgeRefsOk) {
      failures.push({ source_id: "(forge_refs)", reason: "FORGE_PIN_UNVERIFIED" });
    }
  }
  const groundedByCitations = failures.length === 0 && (cell.citations || []).length > 0;
  const grounded = groundedByCitations || (subject === "forge" && forgeRefsOk);
  // A non-unsupported cell with no admitted grounding is unregistered evidence:
  // it can never drive a score.
  if (!grounded && cell.evidence_state !== "unsupported") {
    if (failures.length === 0) failures.push({ source_id: "(none)", reason: "SOURCE_UNVERIFIED" });
  }
  if (failures.length > 0) {
    const downgraded = {
      ...cell,
      evidence_state: "unsupported",
      reason_code: "source_unverified",
      citations: [],
      paraphrase: null,
      opposing_paraphrase: null,
      attribution: "none",
      conflict: false,
      freshness_status: "unknown",
      confidence_reason: "citations could not be resolved against admitted sources",
    };
    return { admitted: downgraded, diagnostic: { issue: "citation_unresolved", failures } };
  }
  return { admitted: { ...cell, freshness_status: freshness } };
}

/**
 * Run one internal comparison task.
 * cellsBySubject: {forge: Cell[], "<vendor_id>": Cell[]} — pre-evaluated.
 * trusted: trusted admission context (REQUIRED).
 */
export function runComparison(input, cellsBySubject, trusted = null) {
  // 0. Trusted context is mandatory — no self-attested pins/subjects/citations.
  const trustedErrors = validateTrustedContext(trusted);
  if (trustedErrors.length > 0) {
    return refusal("REFUSED", "TRUSTED_CONTEXT_REQUIRED", trustedErrors);
  }
  // 1. Structural input validation (closed schemas, exact formats).
  const inputErrors = validateTaskInput(input);
  if (inputErrors.length > 0) {
    return refusal("REFUSED", "INPUT_INVALID", inputErrors);
  }
  // 2. Digest binding: caller refs must match the trusted authorities.
  if (input.confirmed_set_ref.digest !== trusted.confirmedSet.digest) {
    return refusal("REFUSED", "CONFIRMED_SET_MISMATCH", ["confirmed_set_ref.digest does not match the trusted confirmed set"]);
  }
  if (input.feature_taxonomy_ref.digest !== TAXONOMY_DIGEST) {
    return refusal("REFUSED", "TAXONOMY_MISMATCH", ["feature_taxonomy_ref.digest does not match the code taxonomy"]);
  }
  // 3. FORGE pin admission: exact match with the host-verified snapshot.
  const pin = admitForgePin(trusted, input.forge_base_pin);
  if (!pin.ok) {
    return refusal("REFUSED", pin.reason, [pin.detail]);
  }

  const subjects = Object.keys(cellsBySubject || {});
  if (!subjects.includes("forge")) {
    return refusal("REFUSED", "INPUT_INVALID", ["cellsBySubject must include 'forge'"]);
  }

  // 4. Bounds on RAW input BEFORE any traversal/processing (CI-006).
  let rawCells = 0;
  let rawCitations = 0;
  const rawFeatures = new Set();
  for (const s of subjects) {
    const arr = cellsBySubject[s] || [];
    rawCells += arr.length;
    for (const c of arr) {
      rawCitations += Array.isArray(c?.citations) ? c.citations.length : 0;
      if (c?.feature_id) rawFeatures.add(c.feature_id);
    }
  }
  if (rawCells > LIMITS.maxCells) {
    return refusal("BLOCKED", "INPUT_LIMIT", [`${rawCells} raw cells > ${LIMITS.maxCells}`]);
  }
  if (rawFeatures.size > LIMITS.maxPropositions) {
    return refusal("BLOCKED", "INPUT_LIMIT", [`${rawFeatures.size} propositions > ${LIMITS.maxPropositions}`]);
  }
  if (rawCitations > LIMITS.maxCitations) {
    return refusal("BLOCKED", "INPUT_LIMIT", [`${rawCitations} raw citations > ${LIMITS.maxCitations}`]);
  }

  // 5. Subject admission: every non-forge subject must be confirmed.
  for (const s of stableSort(subjects, (x) => x)) {
    const a = admitSubject(trusted, s);
    if (!a.ok) {
      return refusal("REFUSED", a.reason, [a.detail]);
    }
  }

  // 6. Admit cells into the ONE canonical representation. First admitted cell
  //    per subject+feature wins deterministically; later duplicates are
  //    diagnostics, never silent alternate scorings.
  const diagnostics = [];
  const contradictions = [];
  const scored = new Map(); // `${subject}:${feature_id}` -> admitted cell
  const citedSourceIds = new Set();

  for (const subject of stableSort(subjects, (s) => s)) {
    const cells = cellsBySubject[subject] || [];
    for (const cell of cells) {
      const { admitted, diagnostic } = admitCell(trusted, subject, cell);
      if (diagnostic) {
        diagnostics.push({ subject, feature_id: cell?.feature_id || null, ...diagnostic });
      }
      if (!admitted) continue;
      const key = `${subject}:${admitted.feature_id}`;
      if (scored.has(key)) {
        diagnostics.push({ subject, feature_id: admitted.feature_id, issue: "duplicate_cell", detail: "first admitted cell wins" });
        continue;
      }
      scored.set(key, { ...admitted, subject });
      for (const sid of admitted.citations || []) citedSourceIds.add(sid);
      if (admitted.conflict) {
        contradictions.push({ subject, feature_id: admitted.feature_id, reason_code: admitted.reason_code });
      }
    }
  }

  const allCells = [...scored.values()];
  if (allCells.length > LIMITS.maxCells) {
    return refusal("BLOCKED", "INPUT_LIMIT", [`${allCells.length} admitted cells > ${LIMITS.maxCells}`]);
  }

  // 7. Score from the canonical map only — displayed cells ARE the scored inputs.
  const comparisons = [];
  const research_gaps = [];
  const competitors = subjects.filter((s) => s !== "forge");
  const byKey = (s, f) => scored.get(`${s}:${f}`) || null;

  for (const feature_id of stableSort(PROPOSITION_IDS, (x) => x)) {
    for (const vendor of stableSort(competitors, (x) => x)) {
      const forgeCell = byKey("forge", feature_id);
      const compCell = byKey(vendor, feature_id);
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

  // Source index: only actually-cited ADMITTED sources, with full provenance.
  const source_index = [...citedSourceIds]
    .sort()
    .map((sid) => trusted.admittedSources[sid])
    .filter(Boolean)
    .map((r) => ({
      source_id: r.source_id,
      vendor_id: r.vendor_id,
      product_id: r.product_id,
      url: r.url,
      source_type: r.source_type,
      accessed_at: r.accessed_at,
      access_status: r.access_status,
      content_sha256: r.content_sha256,
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
    confirmed_set_digest: trusted.confirmedSet.digest,
    products: stableSort(competitors, (x) => x),
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

  const bytes = utf8Bytes(JSON.stringify(output));
  if (bytes > LIMITS.maxOutputBytes) {
    return refusal("BLOCKED", "OUTPUT_LIMIT", [`${bytes} UTF-8 bytes > ${LIMITS.maxOutputBytes}`]);
  }
  return output;
}
