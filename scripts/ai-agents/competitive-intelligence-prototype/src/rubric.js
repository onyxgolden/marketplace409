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
 *
 * Hard rules: stale or unverified-freshness evidence, missing scopes, and
 * unregistered/ungrounded difference citations can NEVER drive
 * parity/ahead/behind — they yield undetermined.
 */

import { COMPARISONS } from "./schemas.js";
import { resolveCitation, validateTrustedContext } from "./trust.js";

/** Scope comparability for edition/platform/region (also used by cells.js). */
export function scopesComparable(a, b) {
  if (!a || !b) return true; // unscored scope is not a mismatch (rubric decides missing-scope separately)
  for (const k of ["edition", "platform", "region"]) {
    if (a[k] && b[k] && a[k] !== b[k]) return false;
  }
  return true;
}

function freshnessBlocked(cell) {
  return cell?.freshness_status === "stale" || cell?.freshness_status === "unknown";
}

/**
 * Score one feature comparison.
 * forge: admitted cell for FORGE (evidence_state, attribution, scope, freshness_status)
 * competitor: admitted cell for the competitor
 * Returns {verdict, basis}.
 */
export function scoreComparison({ feature_id, forge, competitor }) {
  // Missing scope on either side: comparability cannot be established.
  if (!forge?.scope || !competitor?.scope) {
    return {
      verdict: "undetermined",
      basis: "missing scope on at least one side; comparable basis cannot be established",
    };
  }
  // Scope mismatch -> not comparable.
  if (!scopesComparable(forge.scope, competitor.scope)) {
    return {
      verdict: "not_comparable",
      basis: "scope mismatch: edition/platform/region differ",
    };
  }
  // Stale or unverified freshness can never drive a score.
  if (freshnessBlocked(forge) || freshnessBlocked(competitor)) {
    return {
      verdict: "undetermined",
      basis: "stale or unverified evidence freshness; re-verification required before scoring",
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
 * base: {forge, competitor} — the two admitted, comparable, supported cells.
 * diffEvidence: {direction: "forge_ahead"|"competitor_ahead", description, citations}
 * trusted: trusted context — every difference citation must resolve in the
 *   admitted source store. Ungrounded citations can never drive ahead/behind.
 * Requires explicit evidence of a meaningful difference — never from absence.
 */
export function scoreWithDifference({ feature_id, base, diffEvidence, trusted }) {
  if (!base?.forge || !base?.competitor) {
    return { verdict: "undetermined", basis: "ahead/behind requires admitted base cells on both sides" };
  }
  const f = base.forge;
  const c = base.competitor;
  if (f.evidence_state !== "supported" || c.evidence_state !== "supported") {
    return { verdict: "undetermined", basis: "ahead/behind requires supported base cells on both sides" };
  }
  if (!f.scope || !c.scope || !scopesComparable(f.scope, c.scope)) {
    return { verdict: "undetermined", basis: "ahead/behind requires a comparable scoped base" };
  }
  if (freshnessBlocked(f) || freshnessBlocked(c)) {
    return { verdict: "undetermined", basis: "ahead/behind requires fresh verified base evidence" };
  }
  if (!diffEvidence || !diffEvidence.description || !Array.isArray(diffEvidence.citations) || diffEvidence.citations.length === 0) {
    return { verdict: "undetermined", basis: "ahead/behind requires cited explicit difference evidence" };
  }
  if (!trusted || validateTrustedContext(trusted).length > 0) {
    return { verdict: "undetermined", basis: "difference citations require a valid trusted context" };
  }
  for (const sid of diffEvidence.citations) {
    const r = resolveCitation(trusted, sid, null);
    if (!r.ok) {
      return { verdict: "undetermined", basis: `difference citation ungrounded: ${sid} (${r.reason})` };
    }
  }
  if (diffEvidence.direction === "forge_ahead") {
    return { verdict: "ahead", basis: diffEvidence.description };
  }
  if (diffEvidence.direction === "competitor_ahead") {
    return { verdict: "behind", basis: diffEvidence.description };
  }
  return { verdict: "undetermined", basis: "unknown difference direction" };
}

/** A matrix-level summary: counts per verdict, no league table. */
export function summarizeComparisons(comparisons) {
  const counts = Object.fromEntries(COMPARISONS.map((v) => [v, 0]));
  for (const c of comparisons) {
    if (COMPARISONS.includes(c.verdict)) counts[c.verdict]++;
  }
  return { counts, total: comparisons.length, winner_declared: false };
}
