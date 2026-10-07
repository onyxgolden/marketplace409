// Canonical Knowledge Slice 4 — doc-drift integration.
//
// Turns a canonical-coverage model (canonicalCoverageReport.mjs's buildCoverageModel) into doc-drift
// findings, so the existing deterministic doc-drift path can surface a real coverage problem without
// a second copy of the 77-document registry list or the authority map. This module does not compute
// coverage itself and does not read the repository; it only reshapes `model.issueRows`, which is
// already the registry+manifest evaluator's own conspicuous-issue list (canonicalCoverageReport.mjs).
//
// Pure and total: a clean model (issueRows: []) yields no findings, so a clean canonical-coverage
// state adds no drift noise. These findings are never auto-fixable -- see runDocDriftCli.mjs, where
// each one is marked `proposable: false` before it ever reaches the patch-apply path. A coverage
// failure is a registry decision, not something deterministic doc-drift may silently "fix" by
// inventing authority or classification.
export function canonicalCoverageDriftFindings(model) {
  const issueRows = model?.issueRows ?? [];
  return issueRows.map((issue) => ({
    driftClass: "canonical_coverage",
    docPath: issue.path,
    line: 0,
    literal: issue.issue,
  }));
}
