import { assembleDiagnosticContext } from "./assembleDiagnosticContext.mjs";

/**
 * evaluateDiagnosticQuality.mjs — proof harness for --diagnose output quality.
 *
 * A diagnostic case is a "why is X broken?" question with known ground truth:
 *   {
 *     id: "home-equity-mortgage",
 *     queryText: "why aren't Home Equity payments categorized as mortgage payments",
 *     expected: {
 *       implicated_code: ["src/domains/financial-event/loanPaymentCategory.js"],
 *       behavior_pins: ["src/domains/financial-event/__tests__/loanPaymentCategory.test.js"],
 *       intended_behavior: [],          // optional per case
 *       decisions: [],                  // optional per case
 *       past_fix_subjects: ["categorize Home Equity payments as mortgage payments"],
 *       expect_contradiction: false,    // optional: a cross-authority contradiction should surface
 *     },
 *     // Fixture cases also carry their own mini-manifest + reader; real cases reuse the
 *     // committed manifest and real git history supplied by the caller.
 *     manifest: null,
 *     excerptReader: null,
 *     contentProvider: null,
 *     bugRecords: [],
 *   }
 *
 * Scoring is a pure function of (bundle, expected): facet recall per role-labeled facet,
 * first-hit rank (1-based, null when nothing expected surfaced), facet sizes, past-fix
 * subject recall, and whether an expected contradiction appeared. A case passes when every
 * non-empty expected list has recall > 0 and every expected contradiction/past-fix subject
 * is found. Deterministic: no model calls, no wall-clock, no randomness.
 */

const SCORED_FACETS = ["implicated_code", "behavior_pins", "intended_behavior", "decisions"];

function scoreFacet(entries, expectedPaths) {
  const expected = Array.isArray(expectedPaths) ? expectedPaths : [];
  const paths = entries.map((e) => e.source_path);
  const hitSet = new Set();
  let firstHitRank = null;
  paths.forEach((p, i) => {
    if (expected.includes(p)) {
      hitSet.add(p);
      if (firstHitRank === null) firstHitRank = i + 1;
    }
  });
  return {
    expected: expected.length,
    hits: hitSet.size,
    recall: expected.length === 0 ? null : hitSet.size / expected.length,
    first_hit_rank: firstHitRank,
    facet_size: entries.length,
    hit_paths: [...hitSet].sort(),
  };
}

function scorePastFixes(pastFixes, expectedSubjects) {
  const expected = Array.isArray(expectedSubjects) ? expectedSubjects : [];
  const haystacks = pastFixes.map((f) => String(f.record?.subject || f.subject || "").toLowerCase());
  const hitSubjects = expected.filter((s) =>
    haystacks.some((h) => h.includes(String(s).toLowerCase()))
  );
  return {
    expected: expected.length,
    hits: hitSubjects.length,
    recall: expected.length === 0 ? null : hitSubjects.length / expected.length,
    hit_subjects: hitSubjects,
  };
}

/**
 * Score an already-assembled diagnostic bundle against ground truth. Pure.
 */
export function scoreDiagnosticBundle(bundle, expected = {}) {
  const facetScores = {};
  for (const facet of SCORED_FACETS) {
    facetScores[facet] = scoreFacet(bundle.facets?.[facet] || [], expected[facet]);
  }
  const pastFixScore = scorePastFixes(bundle.past_fixes || [], expected.past_fix_subjects);
  const contradictionSubjects = (bundle.contradictions || []).map((c) =>
    String(c.subject || "").toLowerCase()
  );
  const contradictionHit = expected.expect_contradiction
    ? contradictionSubjects.length > 0
    : null;

  const facetPass = SCORED_FACETS.every((facet) => {
    const s = facetScores[facet];
    return s.expected === 0 || s.recall > 0;
  });
  const pastFixPass = pastFixScore.expected === 0 || pastFixScore.recall > 0;
  const contradictionPass = contradictionHit !== false;

  return {
    insufficient_evidence: !!bundle.insufficient_evidence,
    facet_scores: facetScores,
    past_fix_score: pastFixScore,
    contradiction_hit: contradictionHit,
    passed: !bundle.insufficient_evidence && facetPass && pastFixPass && contradictionPass,
  };
}

/**
 * Run one diagnostic case end to end: assemble the bundle, then score it.
 * Manifest/reader fall back to the case's own fixture values so real cases can share
 * the caller-supplied committed manifest and git reader.
 */
export function evaluateDiagnosticCase({
  manifest,
  diagnosticCase,
  excerptReader = null,
  contentProvider = null,
  bugRecords = [],
  maxResults,
}) {
  const effectiveManifest = diagnosticCase.manifest || manifest;
  if (!effectiveManifest) throw new Error(`Case ${diagnosticCase.id}: no manifest supplied`);
  const bundle = assembleDiagnosticContext({
    manifest: effectiveManifest,
    queryText: diagnosticCase.queryText,
    filters: diagnosticCase.filters || {},
    excerptReader: diagnosticCase.excerptReader || excerptReader,
    contentProvider: diagnosticCase.contentProvider || contentProvider,
    bugRecords: diagnosticCase.bugRecords || bugRecords,
    maxResults,
  });
  return {
    case_id: diagnosticCase.id,
    query: diagnosticCase.queryText,
    fix_commit: diagnosticCase.fix_commit || null,
    ...scoreDiagnosticBundle(bundle, diagnosticCase.expected || {}),
  };
}

/**
 * Aggregate a list of per-case evaluations into a summary. Pure.
 */
export function summarizeEvaluations(evaluations) {
  const summary = {
    cases: evaluations.length,
    passed: evaluations.filter((e) => e.passed).length,
    facet_mean_recall: {},
    past_fix_mean_recall: null,
  };
  for (const facet of SCORED_FACETS) {
    const recalls = evaluations
      .map((e) => e.facet_scores?.[facet]?.recall)
      .filter((r) => r !== null && r !== undefined);
    summary.facet_mean_recall[facet] =
      recalls.length === 0 ? null : recalls.reduce((a, b) => a + b, 0) / recalls.length;
  }
  const pfRecalls = evaluations
    .map((e) => e.past_fix_score?.recall)
    .filter((r) => r !== null && r !== undefined);
  summary.past_fix_mean_recall =
    pfRecalls.length === 0 ? null : pfRecalls.reduce((a, b) => a + b, 0) / pfRecalls.length;
  summary.pass_rate = evaluations.length === 0 ? null : summary.passed / evaluations.length;
  return summary;
}
