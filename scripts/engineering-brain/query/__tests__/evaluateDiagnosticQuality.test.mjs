import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  scoreDiagnosticBundle,
  evaluateDiagnosticCase,
  summarizeEvaluations,
} from "../evaluateDiagnosticQuality.mjs";
import {
  getFixtureDiagnosticCases,
  REAL_DIAGNOSTIC_CASES,
} from "../diagnosticQualityCases.mjs";
import { loadManifest } from "../loadManifest.mjs";
import { createCachedGitReader } from "../createCachedGitReader.mjs";
import { readFileAtCommit, readMigrationsAtCommit } from "../../gitRepository.mjs";

function entry(p) {
  return { source_path: p };
}

describe("scoreDiagnosticBundle", () => {
  it("scores facet recall and first-hit rank from a hand-built bundle", () => {
    const bundle = {
      insufficient_evidence: false,
      facets: {
        implicated_code: [entry("src/a.js"), entry("src/b.js"), entry("src/c.js")],
        behavior_pins: [entry("src/a.test.js")],
        intended_behavior: [],
        decisions: [],
        other_evidence: [],
      },
      contradictions: [],
      past_fixes: [{ record: { subject: "fix billing rounding" } }],
    };
    const score = scoreDiagnosticBundle(bundle, {
      implicated_code: ["src/b.js", "src/zzz-missing.js"],
      behavior_pins: ["src/a.test.js"],
      past_fix_subjects: ["billing"],
    });
    expect(score.facet_scores.implicated_code.recall).toBe(0.5);
    expect(score.facet_scores.implicated_code.first_hit_rank).toBe(2);
    expect(score.facet_scores.implicated_code.hits).toBe(1);
    expect(score.facet_scores.behavior_pins.recall).toBe(1);
    expect(score.facet_scores.behavior_pins.first_hit_rank).toBe(1);
    // Empty expected lists are skipped, not failed.
    expect(score.facet_scores.intended_behavior.recall).toBeNull();
    expect(score.past_fix_score.recall).toBe(1);
    expect(score.passed).toBe(true);
  });

  it("fails a case when an expected implicated file never surfaces", () => {
    const bundle = {
      insufficient_evidence: false,
      facets: { implicated_code: [entry("src/noise.js")], behavior_pins: [], intended_behavior: [], decisions: [], other_evidence: [] },
      contradictions: [],
      past_fixes: [],
    };
    const score = scoreDiagnosticBundle(bundle, { implicated_code: ["src/real-culprit.js"] });
    expect(score.facet_scores.implicated_code.recall).toBe(0);
    expect(score.facet_scores.implicated_code.first_hit_rank).toBeNull();
    expect(score.passed).toBe(false);
  });

  it("fails on insufficient evidence and on a missed expected contradiction", () => {
    const empty = {
      insufficient_evidence: true,
      facets: { implicated_code: [], behavior_pins: [], intended_behavior: [], decisions: [], other_evidence: [] },
      contradictions: [],
      past_fixes: [],
    };
    expect(scoreDiagnosticBundle(empty, {}).passed).toBe(false);
    const noContradiction = { ...empty, insufficient_evidence: false };
    expect(
      scoreDiagnosticBundle(noContradiction, { expect_contradiction: true }).passed
    ).toBe(false);
  });

  it("past-fix subject matching is case-insensitive substring", () => {
    const bundle = {
      insufficient_evidence: false,
      facets: { implicated_code: [], behavior_pins: [], intended_behavior: [], decisions: [], other_evidence: [] },
      contradictions: [],
      past_fixes: [{ record: { subject: "Fix(Billing): Correct Late Fee Rounding" } }],
    };
    const score = scoreDiagnosticBundle(bundle, { past_fix_subjects: ["late fee"] });
    expect(score.past_fix_score.hits).toBe(1);
    expect(score.passed).toBe(true);
  });
});

describe("summarizeEvaluations", () => {
  it("aggregates pass rate and mean recall, skipping unscored facets", () => {
    const evaluations = [
      { passed: true, facet_scores: { implicated_code: { recall: 1 }, behavior_pins: { recall: 0.5 } }, past_fix_score: { recall: 1 } },
      { passed: false, facet_scores: { implicated_code: { recall: 0 }, behavior_pins: { recall: null } }, past_fix_score: { recall: null } },
    ];
    const summary = summarizeEvaluations(evaluations);
    expect(summary.cases).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.pass_rate).toBe(0.5);
    expect(summary.facet_mean_recall.implicated_code).toBe(0.5);
    expect(summary.facet_mean_recall.behavior_pins).toBe(0.5);
    expect(summary.past_fix_mean_recall).toBe(1);
  });
});

describe("diagnostic quality: fixtures", () => {
  for (const diagnosticCase of getFixtureDiagnosticCases()) {
    it(`${diagnosticCase.id}: bundle surfaces the known-broken file, its test, and expected context`, () => {
      const evaluation = evaluateDiagnosticCase({ manifest: null, diagnosticCase });
      expect(evaluation.insufficient_evidence).toBe(false);
      expect(evaluation.facet_scores.implicated_code.recall).toBe(1);
      expect(evaluation.facet_scores.behavior_pins.recall).toBe(1);
      expect(evaluation.passed).toBe(true);
    });
  }

  it("fixture-wrong-constant: stale doc contradiction is promoted and past fix attaches", () => {
    const diagnosticCase = getFixtureDiagnosticCases().find((c) => c.id === "fixture-wrong-constant");
    const evaluation = evaluateDiagnosticCase({ manifest: null, diagnosticCase });
    expect(evaluation.contradiction_hit).toBe(true);
    expect(evaluation.past_fix_score.recall).toBe(1);
    expect(evaluation.facet_scores.intended_behavior.recall).toBe(1);
    expect(evaluation.facet_scores.decisions.recall).toBe(1);
  });

  it("evaluateDiagnosticCase is deterministic across runs", () => {
    const diagnosticCase = getFixtureDiagnosticCases()[0];
    const a = evaluateDiagnosticCase({ manifest: null, diagnosticCase });
    const b = evaluateDiagnosticCase({ manifest: null, diagnosticCase });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("diagnostic quality: real git-history cases", () => {
  const manifestPath = path.join(process.cwd(), "engineering-brain", "index-manifest.json");
  const manifest = loadManifest(manifestPath);
  const excerptReader = createCachedGitReader({ readFileAtCommit, readMigrationsAtCommit });
  // Content search is part of the real query path (the CLI wires it); without it the
  // pipeline searches metadata (path/symbol) only.
  const contentProvider = (sha, p) => excerptReader.readFileAtCommit(sha, p);
  const TIMEOUT_MS = 20000;

  const evaluations = REAL_DIAGNOSTIC_CASES.map((diagnosticCase) =>
    evaluateDiagnosticCase({ manifest, diagnosticCase, excerptReader, contentProvider })
  );

  it("each real case attaches its genuine historical fix from the bug catalog", () => {
    for (const evaluation of evaluations) {
      expect(
        evaluation.past_fix_score.recall,
        `${evaluation.case_id}: expected the real fix commit in past_fixes`
      ).toBe(1);
    }
  }, TIMEOUT_MS);

  // Measured 2026-09-29: with natural symptom phrasing, implicated-code recall is 1/3.
  // Root cause (documented, not hidden): searchRecords pass 1 gates on metadata
  // (path/symbol) overlap, and content search only RE-RANKS the top metadata matches --
  // it never retrieves. A file whose path/symbol lacks the query terms is invisible no
  // matter how relevant its content is (loanPaymentCategory.js matches home/equity/mortgage
  // in content but its path/symbol contains none of those tokens). Fixing retrieval needs
  // content tokens in the manifest index -- a dedicated future slice, not this proof.
  // This floor assertion is a regression guard: quality must not get worse than measured.
  it("real-case implicated recall does not regress below the measured floor", () => {
    const summary = summarizeEvaluations(evaluations);
    expect(summary.pass_rate).toBeGreaterThanOrEqual(1 / 3);
    const passing = evaluations.filter((e) => e.passed).map((e) => e.case_id);
    expect(passing).toContain("real-dashboard-cache-swr");
  }, TIMEOUT_MS);

  it("every real evaluation reports a complete, well-formed score", () => {
    // Guards the harness itself: no silent all-pass, no missing facets, scores in [0,1].
    // The current misses are documented in the CLI report and code comments, not pinned
    // here -- a future retrieval fix that raises recall must turn this suite greener,
    // never redder.
    for (const evaluation of evaluations) {
      for (const facet of ["implicated_code", "behavior_pins", "intended_behavior", "decisions"]) {
        const s = evaluation.facet_scores[facet];
        expect(s).toBeTruthy();
        if (s.recall !== null) {
          expect(s.recall).toBeGreaterThanOrEqual(0);
          expect(s.recall).toBeLessThanOrEqual(1);
        }
      }
      expect(typeof evaluation.passed).toBe("boolean");
    }
    const summary = summarizeEvaluations(evaluations);
    expect(summary.cases).toBe(REAL_DIAGNOSTIC_CASES.length);
    expect(summary.passed).toBe(evaluations.filter((e) => e.passed).length);
  }, TIMEOUT_MS);
});
