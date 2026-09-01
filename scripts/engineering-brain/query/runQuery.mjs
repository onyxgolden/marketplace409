import { searchRecords } from "./searchRecords.mjs";
import { rankResults } from "./rankResults.mjs";
import { detectConflicts } from "./detectConflicts.mjs";
import { resolveExcerpt } from "./resolveExcerpt.mjs";
import { computeConfidence } from "./computeFreshnessAndConfidence.mjs";
import { hashContent } from "../hashContent.mjs";

const DEFAULT_MAX_RESULTS = 20;

// Never invent an answer (requirement 6): if nothing survives filtering/search, the response says so
// explicitly rather than returning an empty result set that could be mistaken for "confirmed absent."
function insufficientEvidenceResponse({ manifest, queryText, filters }) {
  return {
    query: queryText,
    filters,
    manifest_commit_sha: manifest.commit_sha,
    insufficient_evidence: true,
    reason: "No indexed record matched this query and these filters. This means either the answer isn't in what Phase 1 indexed, or the query needs to be narrowed/rephrased -- not that the answer is confirmed absent from the repository.",
    results: [],
    conflicts: [],
  };
}

// `excerptReader` bundles the two content-access functions resolveExcerpt.mjs needs
// ({ readFileAtCommit, readMigrationsAtCommit }); `contentProvider` is the (commitSha, path) => text
// function searchRecords.mjs uses for its bounded content-search pass. Both are injected so this
// whole pipeline is testable against fixtures without touching a real git repository, and so the CLI
// can wire in Phase 1's own gitRepository.mjs functions as the real implementation.
export function runQuery({ manifest, queryText = "", filters = {}, excerptReader, contentProvider = null, metadataOnly = false, maxResults = DEFAULT_MAX_RESULTS, resolveExcerpts = true }) {
  const matched = searchRecords(manifest.records, { queryText, filters, contentProvider, metadataOnly });

  if (matched.length === 0) {
    return insufficientEvidenceResponse({ manifest, queryText, filters });
  }

  const ranked = rankResults(matched);
  const conflicts = detectConflicts(ranked);
  const top = ranked.slice(0, maxResults);

  const results = top.map((entry) => {
    const excerptResolution = resolveExcerpts
      ? resolveExcerpt(entry.record, excerptReader)
      : { verified: false, excerpt: null, reason: "excerpt_resolution_skipped" };
    const conflict = conflicts.find((c) => (
      c.winner.source_path === entry.record.source_path && c.winner.content_hash === entry.record.content_hash
    ) || c.outranked.some((o) => o.source_path === entry.record.source_path && o.content_hash === entry.record.content_hash));

    return {
      source_path: entry.record.source_path,
      source_type: entry.record.source_type,
      symbol_or_section: entry.record.symbol_or_section,
      commit_sha: entry.record.commit_sha,
      content_hash: entry.record.content_hash,
      authority_level: entry.record.authority_level,
      version: entry.record.version,
      freshness: entry.freshness,
      confidence: computeConfidence(entry.matchSignals, excerptResolution),
      excerpt: excerptResolution.excerpt,
      excerpt_truncated: excerptResolution.truncated || false,
      excerpt_unavailable_reason: excerptResolution.verified ? null : excerptResolution.reason,
      unresolved_conflict: conflict ? { subject: conflict.subject, outranked_by_or_outranks: conflict.winner.source_path === entry.record.source_path ? "wins" : "outranked" } : null,
    };
  });

  const response = {
    query: queryText,
    filters,
    manifest_commit_sha: manifest.commit_sha,
    insufficient_evidence: false,
    results,
    conflicts,
  };

  return { ...response, result_content_hash: hashContent(JSON.stringify(response)) };
}
