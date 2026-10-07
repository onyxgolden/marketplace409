// Canonical Knowledge Slice 4 — final acceptance report.
//
// A deterministic summary of the Slice 1-4 canonical-knowledge program at one commit. This is
// evidence, not an authority source (same rule as canonicalCoverageReport.mjs): it changes nothing
// about indexing, ranking, or coverage, and nothing here is read back by the indexer. No timestamps,
// so the same inputs always render the same bytes.

import { CLASSIFICATIONS, sortRegistry } from "./canonicalDocumentRegistry.mjs";

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function table(headers, rows) {
  if (rows.length === 0) return "None.\n";
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n") + "\n";
}

/**
 * Assembles the acceptance model from already-computed pieces. Pure: every input is a plain value,
 * nothing is read here.
 *   registry: the approved registry (canonicalDocumentRegistry.mjs).
 *   freshManifest: a full, non-incremental build at the commit under acceptance.
 *   coverageIssueRows: buildCoverageModel(...).issueRows for freshManifest, with a REAL
 *     missingReferenceStatus -- the authoritative coverage-issue count. Never derive the count from
 *     freshManifest.coverage_issues alone: that field omits MISSING_REFERENCES issues entirely, and
 *     doing so would silently reopen the exact Slice 3 fail-open bug at this integration boundary.
 *   manifestValidation: validateProductionManifest(...)'s result (self-consistency at the committed
 *     artifact's OWN recorded commit; see validateProductionManifest.mjs for why it is never
 *     commit_sha === current HEAD).
 *   incrementalEquivalence: { equivalent, detail }.
 *   security: runSecuritySelfCheck()'s result.
 *   docDrift: { findingCount }.
 */
export function buildAcceptanceModel({ registry, freshManifest, coverageIssueRows, manifestValidation, incrementalEquivalence, security, docDrift }) {
  const registered = sortRegistry(registry);
  return {
    commitSha: freshManifest.commit_sha,
    registryCounts: {
      total: registered.length,
      byClassification: countBy(registered, (e) => e.classification),
      byAuthority: countBy(registered.filter((e) => e.classification !== CLASSIFICATIONS.EXCLUDED), (e) => e.brain_authority ?? "-"),
    },
    indexedTotal: freshManifest.counts?.indexed_total ?? null,
    excludedTotal: freshManifest.counts?.excluded_total ?? null,
    coverageIssueCount: coverageIssueRows.length,
    manifestOk: manifestValidation.ok,
    manifestStatus: manifestValidation.ok
      ? "self-consistent at its own recorded commit, an ancestor of HEAD"
      : "NOT self-consistent, or not an ancestor of HEAD",
    manifestProblems: manifestValidation.problems,
    incrementalEquivalence,
    security,
    docDriftFindingCount: docDrift.findingCount,
  };
}

/** Markdown, deterministic for a given model. */
export function renderAcceptanceReport(model) {
  const lines = [];
  lines.push("# FORGE Engineering Brain -- Canonical Knowledge Acceptance (Slice 4)");
  lines.push("");
  lines.push("> This report is evidence of acceptance, produced from the approved registry and a fresh index build. It is not an authority source and changes nothing about indexing, ranking, or coverage.");
  lines.push("");
  lines.push(`**Commit:** \`${model.commitSha}\``);
  lines.push("");

  const clean = model.coverageIssueCount === 0 && model.manifestOk && model.incrementalEquivalence.equivalent && model.security.pass;
  lines.push(clean
    ? "> Acceptance: CLEAN. Coverage, manifest freshness, incremental equivalence, and security all pass."
    : "> Acceptance: NOT CLEAN. See the sections below.");
  lines.push("");

  lines.push("## Registry");
  lines.push("");
  lines.push(`Registered documents: **${model.registryCounts.total}**.`);
  lines.push("");
  lines.push("By classification:\n");
  lines.push(table(["Classification", "Count"], Object.entries(model.registryCounts.byClassification).sort(([a], [b]) => (a < b ? -1 : 1))));
  lines.push("By configured authority (non-excluded):\n");
  lines.push(table(["Authority", "Count"], Object.entries(model.registryCounts.byAuthority).sort(([a], [b]) => (a < b ? -1 : 1))));

  lines.push("## Index");
  lines.push("");
  lines.push(`Indexed records: **${model.indexedTotal}**. Excluded: **${model.excludedTotal}**.`);
  lines.push(`Coverage issues: **${model.coverageIssueCount}**.`);
  lines.push("");

  lines.push("## Production manifest");
  lines.push("");
  lines.push(`Status: **${model.manifestStatus}**.`);
  if (model.manifestProblems.length > 0) {
    for (const problem of model.manifestProblems) lines.push(`- ${problem}`);
  }
  lines.push("");

  lines.push("## Incremental-reuse equivalence");
  lines.push("");
  lines.push(`Result: **${model.incrementalEquivalence.equivalent ? "equivalent" : "NOT equivalent"}**. ${model.incrementalEquivalence.detail}`);
  lines.push("");

  lines.push("## Security / fail-closed self-check");
  lines.push("");
  lines.push(`Result: **${model.security.pass ? "pass" : "FAIL"}** (${model.security.checks.length} checks).`);
  for (const c of model.security.checks) lines.push(`- [${c.pass ? "pass" : "FAIL"}] ${c.name}`);
  lines.push("");

  lines.push("## Doc-drift integration");
  lines.push("");
  lines.push(`Canonical-coverage findings surfaced in doc-drift output: **${model.docDriftFindingCount}**.`);
  lines.push("");

  return lines.join("\n");
}
