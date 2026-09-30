import { runQuery } from "./runQuery.mjs";
import { resolveExcerpt } from "./resolveExcerpt.mjs";
import { computeFreshness, computeConfidence } from "./computeFreshnessAndConfidence.mjs";
import { searchBugCatalog } from "./searchBugCatalog.mjs";
import { rerankImplicatedCode, hasUsableEvidence } from "./rerankImplicatedCode.mjs";
import { hashContent } from "../hashContent.mjs";

// Source types that describe what the code IS (implementation), grouped for diagnosis.
const IMPLICATED_CODE_TYPES = new Set([
  "application_source_file",
  "application_source_symbol",
  "api_route_file",
  "api_route_symbol",
  "sql_migration_file",
  "sql_rls_policy",
  "sql_rpc_function",
  "sql_table",
  "sql_trigger",
]);

// Everything matched but not otherwise faceted still shows up -- nothing matched is silently
// dropped, it just lands in other_evidence rather than a role-labeled facet.
const INTENDED_BEHAVIOR_TYPES = new Set(["synchronized_document_section"]);
const DECISION_TYPES = new Set(["reviewed_decision"]);
const TEST_TYPES = new Set(["test_file"]);

// Mirror of pairTestWithSource.mjs's naming convention, reversed: given a source path, the test
// paths that convention would pair with it. Kept as a pure function of the path so the pairing
// stays deterministic and never guesses beyond the convention.
const TEST_EXTENSIONS = ["js", "jsx", "ts", "tsx", "mjs"];
export function derivePairedTestPaths(sourcePath) {
  const match = String(sourcePath).match(/^(.*\/)?([^/]+)\.([^./]+)$/);
  if (!match) return [];
  const [, dir = "", baseName, ext] = match;
  if (ext === "test" || baseName.endsWith(".test")) return [];
  if (!TEST_EXTENSIONS.includes(ext)) return [];
  return TEST_EXTENSIONS.map((testExt) => `${dir}${baseName}.test.${testExt}`);
}

function toResultEntry(record, { excerptReader, association = null, pairedTo = null }) {
  const excerptResolution = excerptReader
    ? resolveExcerpt(record, excerptReader)
    : { verified: false, excerpt: null, reason: "excerpt_resolution_skipped" };
  return {
    source_path: record.source_path,
    source_type: record.source_type,
    symbol_or_section: record.symbol_or_section,
    commit_sha: record.commit_sha,
    content_hash: record.content_hash,
    authority_level: record.authority_level,
    version: record.version,
    freshness: computeFreshness(record),
    // Paired tests did not match the query -- empty match signals keep confidence honest
    // ("low" at best), and the association label explains why the entry is present at all.
    confidence: computeConfidence({}, excerptResolution),
    excerpt: excerptResolution.excerpt,
    excerpt_truncated: excerptResolution.truncated || false,
    excerpt_unavailable_reason: excerptResolution.verified ? null : excerptResolution.reason,
    ...(association ? { association, paired_to: pairedTo } : {}),
  };
}

function partitionResults(results) {
  const facets = {
    implicated_code: [],
    behavior_pins: [],
    intended_behavior: [],
    decisions: [],
    other_evidence: [],
  };
  for (const result of results) {
    if (IMPLICATED_CODE_TYPES.has(result.source_type)) facets.implicated_code.push(result);
    else if (TEST_TYPES.has(result.source_type)) facets.behavior_pins.push(result);
    else if (INTENDED_BEHAVIOR_TYPES.has(result.source_type)) facets.intended_behavior.push(result);
    else if (DECISION_TYPES.has(result.source_type)) facets.decisions.push(result);
    else facets.other_evidence.push(result);
  }
  return facets;
}

/**
 * Assemble a diagnostic context bundle for "why is X broken?" questions.
 *
 * Runs the standard query pipeline once, then partitions the ranked results into role-labeled
 * facets (implicated code, behavior-pinning tests, intended-behavior docs, recorded decisions,
 * other evidence), pairs naming-convention tests to implicated code even when the query didn't
 * match them, promotes cross-authority contradictions, and attaches related past fixes from the
 * bug catalog. Deterministic: facet order follows the query's own ranking; paired tests sort by
 * path. Never invents: empty facets are [] and the bundle admits insufficient evidence when
 * nothing matched anywhere.
 *
 * Optional evidenceSignal ({ failed_step, error_lines[], mentioned_paths[] } from a real CI
 * failure) deterministically re-ranks facets.implicated_code so code the failure log actually
 * names floats to the top; entries carry an evidence_match annotation naming the tier. Only the
 * implicated_code facet is reordered -- every other facet and the query's own ranking are
 * untouched. No signal (or an empty one) leaves the order exactly as the query ranked it.
 */
export function assembleDiagnosticContext({
  manifest,
  queryText = "",
  filters = {},
  excerptReader = null,
  contentProvider = null,
  metadataOnly = false,
  maxResults,
  bugRecords = [],
  evidenceSignal = null,
}) {
  const base = runQuery({
    manifest,
    queryText,
    filters,
    excerptReader,
    contentProvider,
    metadataOnly,
    maxResults,
    resolveExcerpts: true,
  });

  const results = base.insufficient_evidence ? [] : base.results;
  const facets = partitionResults(results);

  // Evidence-based re-rank: the failure log's named paths/tokens promote implicated code.
  // The gate uses the same substantive-evidence predicate as the reranker, so an
  // empty/malformed signal can never report evidence_signal_applied: true.
  const evidenceApplied = hasUsableEvidence(evidenceSignal)
    && facets.implicated_code.length > 0;
  if (evidenceApplied) {
    facets.implicated_code = rerankImplicatedCode(facets.implicated_code, evidenceSignal);
  }

  // Pair tests to implicated code by naming convention, even when the query didn't surface them.
  // Only test_file records from the same manifest commit are eligible; each pair is explicitly
  // labeled so it is never mistaken for a query hit.
  const seenTestPaths = new Set(facets.behavior_pins.map((r) => r.source_path));
  const recordsByPath = new Map();
  for (const record of manifest.records || []) {
    if (record.source_type === "test_file" && !recordsByPath.has(record.source_path)) {
      recordsByPath.set(record.source_path, record);
    }
  }
  const pairedTests = [];
  for (const codeResult of facets.implicated_code) {
    for (const testPath of derivePairedTestPaths(codeResult.source_path)) {
      const record = recordsByPath.get(testPath);
      if (record && !seenTestPaths.has(testPath)) {
        seenTestPaths.add(testPath);
        pairedTests.push(toResultEntry(record, {
          excerptReader,
          association: "naming-convention pair",
          pairedTo: codeResult.source_path,
        }));
      }
    }
  }
  pairedTests.sort((a, b) => a.source_path.localeCompare(b.source_path));
  facets.behavior_pins.push(...pairedTests);

  const pastFixes = queryText.trim() && Array.isArray(bugRecords) && bugRecords.length > 0
    ? searchBugCatalog({ records: bugRecords, queryText, maxResults: 5 })
    : [];

  const hasAnything = results.length > 0 || pairedTests.length > 0 || pastFixes.length > 0;

  const bundle = {
    query: queryText,
    filters,
    manifest_commit_sha: manifest.commit_sha,
    insufficient_evidence: !hasAnything,
    ...(hasAnything ? {} : {
      reason: "No indexed record, paired test, or past fix matched this query. This means the answer isn't in what was indexed, or the query needs narrowing/rephrasing -- not that the answer is confirmed absent.",
    }),
    facets,
    // True when a caller-supplied failure signal re-ranked facets.implicated_code; the
    // per-entry evidence_match annotations name the tier that promoted each entry.
    // evidence_signal_id/failed_step name WHICH collected failure did the ranking,
    // so a later reader can trace the promotion back to its source.
    evidence_signal_applied: evidenceApplied,
    evidence_signal_id: evidenceApplied ? evidenceSignal.signal_id || null : null,
    evidence_failed_step: evidenceApplied ? evidenceSignal.failed_step || null : null,
    // Contradictions are promoted to top level: code disagreeing with docs/decisions is the
    // single most diagnostic signal this bundle can surface.
    contradictions: base.insufficient_evidence ? [] : base.conflicts,
    past_fixes: pastFixes,
  };

  return { ...bundle, result_content_hash: hashContent(JSON.stringify(bundle)) };
}
