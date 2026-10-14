/**
 * rubric.js — honest internal comparison per contract §7.
 *
 * Verdicts: ahead | parity | behind | undetermined | not_comparable.
 * - ahead/behind requires explicit evidence of a meaningful capability
 *   difference on a comparable basis. No score from absent mention.
 * - parity = documented coverage of the same bounded proposition.
 * - undetermined = missing evidence, conflicts, stale sources, mismatched scopes.
 * - not_comparable = different use case/coverage.
 * No whole-product winner or weighted league table in the first pilot.
 */

import { COMPARISONS } from "./schemas.js";

/**
 * Score one feature comparison.
 * forge: cell for FORGE (evidence_state, attribution, scope)
 * competitor: cell for the competitor
 * Returns {verdict, basis}.
 */
export function scoreComparison({ feature_id, forge, competitor }) {
  // Scope mismatch -> not comparable or undetermined.
  if (!scopesComparable(forge?.scope, competitor?.scope)) {
    return {
      verdict: "not_comparable",
      basis: "scope mismatch: edition/platform/region differ",
    };
  }

  const f = forge?.evidence_state;
  const c = competitor?.evidence_state;

  // Any missing/unsupported/conflicted evidence -> undetermined (never inferred).
  if (!f || !c || f === "unsupported" || c === "unsupported") {
    return {
      verdict: "undetermined",
      basis: "insufficient admitted evidence on at least one side; absence is not a score",
    };
  }
  if (forge.conflict || competitor.conflict) {
    return { verdict: "undetermined", basis: "unresolved same-scope conflict" };
  }
  if (f === "contradicted" || c === "contradicted") {
    return { verdict: "undetermined", basis: "contradicted evidence requires explicit negative grounding" };
  }

  // Both supported -> parity on the bounded proposition (not on quality).
  if (f === "supported" && c === "supported") {
    return {
      verdict: "parity",
      basis: "both sides document the same bounded proposition; parity is coverage-only, not reliability/security/UX",
    };
  }
  return { verdict: "undetermined", basis: "unhandled evidence combination" };
}

/**
 * Score with explicit capability-difference evidence (ahead/behind).
 * diffEvidence: {direction: "forge_ahead"|"competitor_ahead", description, citations}
 * Requires explicit evidence of a meaningful difference — never from absence.
 */
export function scoreWithDifference({ feature_id, base, diffEvidence }) {
  if (!diffEvidence || !diffEvidence.description || !Array.isArray(diffEvidence.citations) || diffEvidence.citations.length === 0) {
    return { verdict: "undetermined", basis: "ahead/behind requires cited explicit difference evidence" };
  }
  if (diffEvidence.direction === "forge_ahead") {
    return { verdict: "ahead", basis: diffEvidence.description };
  }
  if (diffEvidence.direction === "competitor_ahead") {
    return { verdict: "behind", basis: diffEvidence.description };
  }
  return { verdict: "undetermined", basis: "unknown difference direction" };
}

function scopesComparable(a, b) {
  if (!a || !b) return true; // unscored scope is not a mismatch
  for (const k of ["edition", "platform", "region"]) {
    if (a[k] && b[k] && a[k] !== b[k]) return false;
  }
  return true;
}

/** A matrix-level summary: counts per verdict, no league table. */
export function summarizeComparisons(comparisons) {
  const counts = Object.fromEntries(COMPARISONS.map((v) => [v, 0]));
  for (const c of comparisons) {
    if (COMPARISONS.includes(c.verdict)) counts[c.verdict]++;
  }
  return { counts, total: comparisons.length, winner_declared: false };
}
