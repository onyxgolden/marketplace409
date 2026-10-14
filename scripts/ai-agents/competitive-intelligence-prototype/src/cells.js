/**
 * cells.js — tri-state cell evaluation per contract §5.
 *
 * Every cell represents an explicit proposition tied to product/edition/
 * platform/region/version/date. Evidence states:
 *   supported    — admitted source explicitly establishes the proposition
 *   contradicted — source explicitly opposes it, or same-scope sources conflict
 *   unsupported  — no admitted evidence (never "does not have")
 *
 * Injection resistance: untrusted source text is NEVER executed or obeyed.
 * Instruction-like patterns in evidence are quarantined AND excluded from
 * support/opposition — quarantined evidence contributes nothing to scores.
 *
 * Conflict honesty: only same-scope evidence can conflict. A cell's
 * supporting and opposing sides are both preserved in citations; the scored
 * representation is the single canonical cell object this module returns.
 */

import { EVIDENCE_STATES, ATTRIBUTIONS, FRESHNESS_STATES } from "./schemas.js";
import { PROPOSITIONS } from "./taxonomy.js";
import { scopesComparable } from "./rubric.js";

/** Exact allowed keys on a finished cell (closed schema, CI-006). */
export const CELL_KEYS = [
  "feature_id",
  "proposition",
  "subject_ref",
  "scope",
  "evidence_state",
  "citations",
  "paraphrase",
  "opposing_paraphrase",
  "attribution",
  "conflict",
  "reason_code",
  "confidence_reason",
  "freshness_status",
  "completeness",
  "injection_quarantined",
  "out_of_scope_evidence",
  "forge_refs",
];

/** Patterns that indicate embedded instructions in untrusted evidence text. */
const INJECTION_PATTERNS = [
  /system\s+instruction/i,
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /declare\s+.*\s+(winner|best|#1)/i,
  /override\s+the\s+(rubric|scoring|evaluation)/i,
  /mark\s+all\s+.*\s+as\s+supported/i,
  /\bprompt\s+injection\b/i,
];

/**
 * Scan untrusted text for embedded instructions. Returns {clean, findings}.
 * Findings are metadata only — the text is never acted upon.
 */
export function scanForInjection(text) {
  const findings = [];
  if (typeof text !== "string") return { clean: true, findings };
  for (const re of INJECTION_PATTERNS) {
    if (re.test(text)) findings.push({ pattern: re.source, quarantined: true });
  }
  return { clean: findings.length === 0, findings };
}

const SUPERLATIVE_PATTERNS = [
  /\bmarket\s+leader\b/i,
  /#1\s+rated/i,
  /\bbest-in-class\b/i,
  /\bbest\b.*\b(platform|software|solution)\b/i,
];

/** Superlatives are attributed assertions, never objective facts (§5). */
export function containsSuperlative(text) {
  if (typeof text !== "string") return false;
  return SUPERLATIVE_PATTERNS.some((re) => re.test(text));
}

/**
 * Evaluate one cell from admitted evidence.
 * evidence: [{paraphrase, attribution, supports: true|false|null, source_ref, scope?}]
 *   supports=true  -> evidence for the proposition
 *   supports=false -> evidence against the proposition
 *   supports=null  -> ambiguous/weak mention
 * Evidence carrying embedded instructions is quarantined and EXCLUDED from
 * support/opposition entirely. Evidence whose scope is not comparable to the
 * cell scope is set aside as out_of_scope_evidence (recorded, not scored).
 * Returns the single canonical cell object.
 */
export function evaluateCell({ feature_id, subject_ref, scope, evidence = [] }) {
  if (!PROPOSITIONS[feature_id]) {
    throw new Error(`unknown feature_id: ${feature_id}`);
  }
  const cellScope = scope || null;

  // Partition: quarantined (injection) vs clean.
  const injection_quarantined = [];
  const out_of_scope_evidence = [];
  const clean = [];
  for (const e of evidence) {
    const scan = scanForInjection(e.paraphrase || "");
    if (!scan.clean) {
      injection_quarantined.push(
        ...scan.findings.map((f) => ({ ...f, evidence_ref: e.source_ref?.source_id || null })),
      );
      continue; // excluded from support/opposition — contributes nothing
    }
    const eScope = e.scope || null;
    if (eScope && cellScope && !scopesComparable(eScope, cellScope)) {
      out_of_scope_evidence.push({ evidence_ref: e.source_ref?.source_id || null });
      continue; // recorded, not scored
    }
    clean.push(e);
  }

  const forEvidence = clean.filter((e) => e.supports === true);
  const againstEvidence = clean.filter((e) => e.supports === false);

  let evidence_state;
  let conflict = false;
  let reason_code;
  if (forEvidence.length > 0 && againstEvidence.length > 0) {
    evidence_state = "contradicted";
    conflict = true;
    reason_code = "same_scope_conflict";
  } else if (againstEvidence.length > 0) {
    evidence_state = "contradicted";
    reason_code = "explicit_opposition";
  } else if (forEvidence.length > 0) {
    evidence_state = "supported";
    reason_code = "explicit_support";
  } else if (injection_quarantined.length > 0) {
    evidence_state = "unsupported";
    reason_code = "quarantined_only";
  } else {
    evidence_state = "unsupported";
    reason_code = evidence.length === 0 ? "no_evidence" : "ambiguous_only";
  }

  // The scored representation uses BOTH sides of a true conflict — the
  // support side is never dropped by "used" filtering.
  const used =
    evidence_state === "supported"
      ? forEvidence
      : evidence_state === "contradicted"
        ? [...forEvidence, ...againstEvidence]
        : [];

  // Attribution: strongest wins, with vendor_documented > trial_observed > user_reported.
  const rank = { vendor_documented: 3, trial_observed: 3, forge_code: 3, forge_test: 2, user_reported: 1, none: 0 };
  let attribution = "none";
  let best = -1;
  for (const e of used) {
    const r = rank[e.attribution] ?? -1;
    if (r > best && ATTRIBUTIONS.includes(e.attribution)) {
      best = r;
      attribution = e.attribution;
    }
  }

  const citations = used
    .map((e) => e.source_ref)
    .filter(Boolean)
    .map((s) => s.source_id);

  return {
    feature_id,
    proposition: PROPOSITIONS[feature_id].text,
    subject_ref,
    scope: cellScope,
    evidence_state,
    citations,
    paraphrase: used[0]?.paraphrase || null,
    opposing_paraphrase: conflict ? againstEvidence[0]?.paraphrase || null : null,
    attribution,
    conflict,
    reason_code,
    confidence_reason:
      evidence_state === "unsupported"
        ? "absence of mention is not evidence of absence"
        : `${used.length} admitted evidence item(s)`,
    freshness_status: "unknown",
    completeness: evidence.length === 0 ? "no_search" : "partial",
    injection_quarantined,
    out_of_scope_evidence,
    forge_refs: [],
  };
}

/** Validate a finished cell against the contract's structural rules (closed). */
export function validateCell(cell) {
  const errors = [];
  if (!cell || typeof cell !== "object" || Array.isArray(cell)) return ["cell must be an object"];
  for (const k of Object.keys(cell)) {
    if (!CELL_KEYS.includes(k)) errors.push(`unknown field ${k} (closed cell schema)`);
  }
  if (typeof cell.feature_id !== "string" || !PROPOSITIONS[cell.feature_id]) errors.push("bad feature_id");
  if (!EVIDENCE_STATES.includes(cell.evidence_state)) errors.push("bad evidence_state");
  if (!ATTRIBUTIONS.includes(cell.attribution)) errors.push("bad attribution");
  if (!FRESHNESS_STATES.includes(cell.freshness_status)) errors.push("bad freshness_status");
  if (!cell.subject_ref || typeof cell.subject_ref.vendor_id !== "string" || !cell.subject_ref.vendor_id) {
    errors.push("bad subject_ref.vendor_id");
  }
  if (!Array.isArray(cell.citations) || cell.citations.some((c) => typeof c !== "string")) {
    errors.push("citations must be string[]");
  }
  if (cell.scope !== null && cell.scope !== undefined && typeof cell.scope !== "object") {
    errors.push("scope must be an object or null");
  }
  if (cell.conflict === true && cell.evidence_state !== "contradicted") {
    errors.push("conflict=true requires contradicted state");
  }
  if (cell.evidence_state === "unsupported" && cell.paraphrase && /does not (have|support|offer)/i.test(cell.paraphrase)) {
    errors.push("unsupported cell must not assert absence");
  }
  return errors;
}
