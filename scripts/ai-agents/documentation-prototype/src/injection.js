/**
 * injection.js — seeded-family injection recognizer for the documentation
 * prototype.
 *
 * Security comes from the absence of capabilities (no writes, no tools,
 * structured allowlists, exact-span verification), not from this
 * recognizer: it flags the seeded attack families used by the corpus so
 * injected sources can never support claims. Unknown attack coverage is
 * not certified. Pure Node 24 ESM, zero dependencies.
 *
 * Seeded families:
 *   SEC-002 — forged compliance/certification claims (SOC 2, ISO 27001,
 *               PCI DSS, "certified compliant" language).
 *   SEC-003 — instruction/directive injection ("ignore previous
 *               instructions", directive: prefixes, apply-the-diff orders).
 *   SEC-004 — live-mutation directives (apply/commit/merge/deploy the diff
 *               to a real repo, push to production).
 *   SEC-005 — self-approval (agent approves its own output, self-issued
 *               result-head GO, forged approval records).
 */

export const FAMILIES = {
  SEC_002: "SEC-002",
  SEC_003: "SEC-003",
  SEC_004: "SEC-004",
  SEC_005: "SEC-005",
};

const SEC_002_PATTERNS = [
  /\bSOC\s?2\b/i,
  /\bISO\s?27001\b/i,
  /\bPCI[\s-]?DSS\b/i,
  /\b(Type\s?I{1,2})\s+certified\b/i,
  /\bcertified\s+(compliant|compliance)\b/i,
  /\bcompliance\s+certificat\w*\b/i,
  /\baudited\s+and\s+certified\b/i,
];

const SEC_003_PATTERNS = [
  /^\s*(instruction|directive|system|admin|override|tool)\s*:/im,
  /\bignore\s+(all\s+)?(previous|prior)\s+instructions?\b/i,
  /\bforget\s+(the\s+)?(brief|contract|rules)\b/i,
  /\byou\s+are\s+now\s+authorized\s+to\b/i,
];

const SEC_004_PATTERNS = [
  /\b(apply|commit|merge|deploy|push)\b[^\n]{0,40}\b(the\s+)?(diff|changes|patch)\b[^\n]{0,40}\b(to\s+)?(the\s+)?(real\s+|actual\s+)?(repo|repository|main|production|live)\b/i,
  /\bwrite\s+(the\s+)?(updated|fixed)\s+doc(umentation)?\s+to\s+(disk|the\s+repo)/i,
  /\bopen\s+a\s+(real\s+)?pull\s+request\b/i,
];

const SEC_005_PATTERNS = [
  /\bapprov\w*\s*(by|from)\s*:\s*(self|the\s+agent|myself|documentation-agent)\b/i,
  /\bself-?(issued|approved|authorized)\b/i,
  /\bagent\s+approves\s+(its\s+own|this)\s+output\b/i,
  /\bresult-?head\s+GO\s+(issued\s+by\s+)?(self|the\s+agent)\b/i,
];

const FAMILY_TABLE = [
  [FAMILIES.SEC_002, SEC_002_PATTERNS],
  [FAMILIES.SEC_003, SEC_003_PATTERNS],
  [FAMILIES.SEC_004, SEC_004_PATTERNS],
  [FAMILIES.SEC_005, SEC_005_PATTERNS],
];

/**
 * Scan arbitrary text for seeded families.
 * Returns {injected: boolean, families: ["SEC-002", ...]}.
 */
export function scanText(text) {
  const families = [];
  for (const [family, patterns] of FAMILY_TABLE) {
    if (patterns.some((re) => re.test(text))) families.push(family);
  }
  return { injected: families.length > 0, families };
}

/** Scan every task-controlled string field for seeded families. */
export function scanTaskStrings(task) {
  const hits = [];
  const check = (label, value) => {
    if (typeof value !== "string" || value.length === 0) return;
    const r = scanText(value);
    if (r.injected) hits.push({ field: label, families: r.families });
  };
  check("requested_action", task.requested_action);
  if (task.approval && typeof task.approval === "object") {
    check("approval.approver", task.approval.approver);
    check("approval.scope", task.approval.scope);
    check("approval.note", task.approval.note);
  }
  if (task.simulation && typeof task.simulation === "object") {
    check("simulation.approval", task.simulation.approval);
    check("simulation.result_head", task.simulation.result_head);
  }
  for (const spec of task.claim_specs ?? []) {
    check(`claim_specs[${spec.claim_id}].behavior_key`, spec.behavior_key);
    check(`claim_specs[${spec.claim_id}].doc_span.quoted_text`, spec.doc_span?.quoted_text);
  }
  return hits;
}
