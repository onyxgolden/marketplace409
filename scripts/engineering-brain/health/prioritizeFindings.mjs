/**
 * prioritizeFindings.mjs — Slice 6: deterministic severity layer.
 *
 * Adds severity and triage state to Slice 5 findings. Pure, deterministic,
 * zero I/O. No LLM, no inference from missing evidence.
 *
 * SEVERITY RULES (documented here and enforced by tests):
 *
 * Base severity (from finding kind + underlying status):
 *   evidence-unavailable              → high   (cannot verify; needs human eyes)
 *   coverage-gap / uncovered          → high   (failures would be silent)
 *   coverage-gap / partially-covered  → medium (partial verification exists)
 *   coverage-gap / unable-to-verify   → medium (unknown; not healthy, not broken)
 *   known-defect-repaired             → low    (historical context only)
 *   (unknown kind)                    → medium (fail toward attention, not dismissal)
 *
 * Boosts (+1 level each, capped at critical):
 *   +1  capability has moves_money=true (increases review sensitivity ONLY;
 *       never asserts the capability is defective for moving money)
 *   +1  exact-file regression exposure touches the finding's subsystem files
 *       (advisory context; a file overlap does NOT prove a regression)
 *
 * Severity order: low < medium < high < critical.
 *
 * Triage states:
 *   needs-review         — actionable; a human should investigate
 *   evidence-unavailable — the underlying evidence cannot be verified
 *   informational        — historical context; no action implied
 *
 * Hard invariants:
 * - identical inputs → identical severity/state/order (deterministic)
 * - missing evidence is never upgraded to "confirmed" or downgraded to "fine"
 * - moves_money never produces a defect claim
 * - no finding is ever marked resolved here (disappearance ≠ resolution)
 */

export const SEVERITIES = Object.freeze(["low", "medium", "high", "critical"]);
export const TRIAGE_STATES = Object.freeze([
  "needs-review",
  "evidence-unavailable",
  "informational",
]);

const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

function baseSeverity(finding) {
  switch (finding.kind) {
    case "evidence-unavailable":
      return "high";
    case "coverage-gap": {
      // Derive from the finding's own description of status. The finding
      // was built from monitoring_status; map conservatively.
      const what = String(finding.what || "").toLowerCase();
      if (what.includes("uncovered") && !what.includes("partially")) return "high";
      if (what.includes("partially")) return "medium";
      return "medium"; // unable-to-verify and unknown → medium
    }
    case "known-defect-repaired":
      return "low";
    default:
      return "medium";
  }
}

function boost(severity, levels) {
  const rank = Math.min(3, SEVERITY_RANK[severity] + levels);
  return SEVERITIES[rank];
}

function triageState(finding, severity) {
  if (finding.kind === "evidence-unavailable") return "evidence-unavailable";
  if (finding.kind === "known-defect-repaired") return "informational";
  return "needs-review";
}

/**
 * @param {object} input
 * @param {Array} input.findings — from assembleFindings()
 * @param {Array} [input.capabilities] — registry entries (for moves_money lookup)
 * @param {Array} [input.exposures] — from matchRegressions() (for file-overlap boost)
 * @returns {Array} findings with {severity, triageState, severityReason}
 */
export function prioritizeFindings({ findings = [], capabilities = [], exposures = [] }) {
  const moneyById = new Map();
  for (const cap of capabilities) {
    if (cap && cap.id) moneyById.set(cap.id, cap.moves_money === true);
  }

  // Collect exposed file paths for overlap checks.
  const exposedFiles = new Set();
  for (const e of exposures) {
    if (e && Array.isArray(e.matchedFiles)) {
      for (const f of e.matchedFiles) exposedFiles.add(String(f));
    }
  }

  return findings.map((f) => {
    const base = baseSeverity(f);
    let boostLevels = 0;
    const reasons = [`base:${base}`];

    // Money-moving boost: capability id is embedded in coverage finding ids.
    const capId = f.id.startsWith("coverage:") ? f.id.slice("coverage:".length) : null;
    if (capId && moneyById.get(capId) === true) {
      boostLevels += 1;
      reasons.push("moves_money:+1 (priority only, not a defect claim)");
    }

    // Regression-exposure boost: exact file overlap with the finding's subsystem.
    if (f.kind === "coverage-gap" && f.subsystem) {
      const subsysFiles = String(f.subsystem).split(",").map((s) => s.trim());
      if (subsysFiles.some((sf) => exposedFiles.has(sf))) {
        boostLevels += 1;
        reasons.push("regression-exposure:+1 (advisory; overlap is not proof of regression)");
      }
    }

    const severity = boost(base, boostLevels);
    return {
      ...f,
      severity,
      triageState: triageState(f, severity),
      severityReason: reasons.join("; "),
    };
  });
}
