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
  resolveForgeRef,
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
function admitCell(trusted, subject, confirmedVendor, cell) {
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
  // CI-001: exact confirmed product/scope admission. Vendor identity alone is
  // not enough: the cell must be about the confirmed product, and its scope
  // must be the confirmed scope shape (edition/platform/region/version).
  if (confirmedVendor && confirmedVendor.product_id) {
    if (cell.subject_ref.product_id !== confirmedVendor.product_id) {
      return {
        admitted: null,
        diagnostic: {
          issue: "product_unconfirmed",
          errors: [
            `cell subject_ref.product_id=${cell.subject_ref.product_id ?? "none"} != confirmed product ${confirmedVendor.product_id}`,
          ],
        },
      };
    }
    // The cell's scope must also be about the confirmed product — a scope
    // naming a different product/edition is not admitted under this vendor.
    if (cell.scope && cell.scope.product_id && cell.scope.product_id !== confirmedVendor.product_id) {
      return {
        admitted: null,
        diagnostic: {
          issue: "product_unconfirmed",
          errors: [
            `cell scope.product_id=${cell.scope.product_id} != confirmed product ${confirmedVendor.product_id}`,
          ],
        },
      };
    }
  }
  // CI-006: per-cell citation bound enforced before any traversal work.
  const citationIds = cell.citations || [];
  if (citationIds.length > LIMITS.maxCitationsPerCell) {
    return {
      admitted: null,
      diagnostic: {
        issue: "cell_invalid",
        errors: [`too many citations on one cell: ${citationIds.length} > ${LIMITS.maxCitationsPerCell}`],
      },
    };
  }
  // Resolve every citation against the admitted store, bound to the confirmed
  // product (CI-001). A source that matches the vendor but is about a
  // different product/edition/platform/region does not ground this cell.
  const failures = [];
  let freshness = "fresh";
  const confirmedProductId = confirmedVendor ? confirmedVendor.product_id ?? null : null;
  for (const sid of citationIds) {
    const r = resolveCitation(trusted, sid, subject, confirmedProductId);
    if (!r.ok) {
      failures.push({ source_id: sid, reason: r.reason });
    } else if (r.freshness === "stale") {
      freshness = "stale";
    } else if (r.freshness === "unknown" && freshness === "fresh") {
      freshness = "unknown";
    }
  }
  // FORGE cells may ground in the verified snapshot via forge_refs instead —
  // but ONLY through the host's verified repo-file resolver (CI-001). A pin
  // is snapshot identity, not proof the file exists; every ref is resolved
  // at the pinned tree, and unverifiable refs leave the cell unsupported.
  let forgeRefsOk = false;
  if (Array.isArray(cell.forge_refs) && cell.forge_refs.length > 0) {
    forgeRefsOk = true;
    for (const fr of cell.forge_refs) {
      const rr = resolveForgeRef(trusted, fr);
      if (!rr.ok) {
        forgeRefsOk = false;
        failures.push({ source_id: `(forge_refs:${fr && fr.path ? fr.path : "?"})`, reason: rr.reason });
        break;
      }
    }
  }
  const groundedByCitations = failures.length === 0 && citationIds.length > 0;
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

  // 4. Bounds on RAW input BEFORE any traversal/processing (CI-006).
  //    Closed shapes first: every subject bucket must be an array, otherwise
  //    the input is malformed (refused, never an exception mid-traversal).
  const subjects = Object.keys(cellsBySubject || {});
  if (!subjects.includes("forge")) {
    return refusal("REFUSED", "INPUT_INVALID", ["cellsBySubject must include 'forge'"]);
  }
  for (const s of subjects) {
    if (!Array.isArray(cellsBySubject[s])) {
      return refusal("REFUSED", "INPUT_INVALID", [`cellsBySubject[${s}] must be an array`]);
    }
  }
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

  // 5. Subject admission: every non-forge subject must be confirmed. The
  //    confirmed vendor record is captured for exact product/scope admission.
  const confirmedVendors = {};
  for (const s of stableSort(subjects, (x) => x)) {
    const a = admitSubject(trusted, s);
    if (!a.ok) {
      return refusal("REFUSED", a.reason, [a.detail]);
    }
    confirmedVendors[s] = a.vendor; // null for forge
  }

  // 6. Admit cells into the ONE canonical representation.
  //
  //    CI-002: duplicates do NOT reduce to first-wins. Only TRUE identical
  //    duplicates collapse (same evidence_state, citations, scope, conflict,
  //    subject binding). A later cell that conflicts on any of those fields
  //    replaces the scored entry with an undetermined marker and keeps BOTH
  //    evidence sides in the diagnostic — the conflict is scored as
  //    undetermined, never voted away.
  const diagnostics = [];
  const contradictions = [];
  const scored = new Map(); // `${subject}:${feature_id}` -> admitted cell
  const citedSourceIds = new Set();

  const identicalCells = (a, b) =>
    a.evidence_state === b.evidence_state &&
    JSON.stringify([...(a.citations || [])].sort()) === JSON.stringify([...(b.citations || [])].sort()) &&
    JSON.stringify(a.scope || null) === JSON.stringify(b.scope || null) &&
    Boolean(a.conflict) === Boolean(b.conflict) &&
    JSON.stringify(a.subject_ref || null) === JSON.stringify(b.subject_ref || null);

  let traversed = 0;
  for (const subject of stableSort(subjects, (s) => s)) {
    const cells = cellsBySubject[subject] || [];
    for (const cell of cells) {
      // CI-006: fail-fast tripwire DURING traversal — the count can never
      // exceed the bound no matter what shape the input took.
      traversed += 1;
      if (traversed > LIMITS.maxCells) {
        return refusal("BLOCKED", "INPUT_LIMIT", [`traversed ${traversed} cells > ${LIMITS.maxCells}`]);
      }
      const { admitted, diagnostic } = admitCell(trusted, subject, confirmedVendors[subject], cell);
      if (diagnostic) {
        diagnostics.push({ subject, feature_id: cell?.feature_id || null, ...diagnostic });
      }
      if (!admitted) continue;
      const key = `${subject}:${admitted.feature_id}`;
      const prior = scored.get(key);
      if (prior) {
        if (identicalCells(prior, admitted)) {
          diagnostics.push({ subject, feature_id: admitted.feature_id, issue: "duplicate_cell", detail: "identical duplicate collapsed" });
          continue;
        }
        // Conflicting duplicate: scored identity is undetermined; both
        // evidence sides are retained in the diagnostic.
        const mergedCitations = [...new Set([...(prior.citations || []), ...(admitted.citations || [])])];
        const marker = {
          ...prior,
          evidence_state: "unsupported",
          reason_code: "conflicting_duplicates",
          citations: mergedCitations,
          paraphrase: null,
          opposing_paraphrase: null,
          attribution: "none",
          conflict: false,
          freshness_status: "unknown",
          confidence_reason: "conflicting duplicate cells: scored identity undetermined",
        };
        scored.set(key, marker);
        for (const sid of mergedCitations) citedSourceIds.add(sid);
        diagnostics.push({
          subject,
          feature_id: admitted.feature_id,
          issue: "conflicting_duplicates",
          detail: "conflicting duplicate cells; scored identity undetermined with both evidence sides retained",
          sides: [
            {
              evidence_state: prior.evidence_state, citations: prior.citations,
              scope: prior.scope, conflict: prior.conflict, subject_ref: prior.subject_ref,
            },
            {
              evidence_state: admitted.evidence_state, citations: admitted.citations,
              scope: admitted.scope, conflict: admitted.conflict, subject_ref: admitted.subject_ref,
            },
          ],
        });
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
