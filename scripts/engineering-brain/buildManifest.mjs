import { hashContent } from "./hashContent.mjs";

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// The manifest's content -- everything except `generated_at` -- is what requirement 2 demands be
// byte-identical across two runs at the same commit. `index_content_hash` is computed over exactly
// that content (JSON-stringified with sorted, stable ordering) so a caller can prove determinism with
// one hash comparison instead of a deep-equal over the whole structure.
export function buildManifest({ commitSha, generatedAt, trackedFiles, records, excluded, outOfScope, deletedPaths }) {
  const sortedRecords = [...records].sort((a, b) => {
    const pathCompare = a.source_path.localeCompare(b.source_path);
    if (pathCompare !== 0) return pathCompare;
    return String(a.symbol_or_section).localeCompare(String(b.symbol_or_section));
  });
  const sortedExcluded = [...excluded].sort((a, b) => a.source_path.localeCompare(b.source_path));
  const sortedOutOfScope = [...outOfScope].map((entry) => entry.source_path).sort();
  const sortedDeletedPaths = [...deletedPaths].sort();

  const fileBlobShas = Object.fromEntries(
    trackedFiles.map((file) => [file.path, file.blobSha]).sort(([a], [b]) => a.localeCompare(b)),
  );

  const contentForHashing = {
    schema_version: "1.0",
    commit_sha: commitSha,
    records: sortedRecords,
    excluded: sortedExcluded,
    out_of_scope_paths: sortedOutOfScope,
    deleted_paths: sortedDeletedPaths,
    file_blob_shas: fileBlobShas,
  };

  const indexContentHash = hashContent(JSON.stringify(contentForHashing));

  const counts = {
    indexed_total: sortedRecords.length,
    indexed_by_source_type: countBy(sortedRecords, (r) => r.source_type),
    indexed_by_authority_level: countBy(sortedRecords, (r) => r.authority_level),
    excluded_total: sortedExcluded.length,
    excluded_by_reason: countBy(sortedExcluded, (r) => r.reason),
    out_of_scope_total: sortedOutOfScope.length,
    deleted_total: sortedDeletedPaths.length,
  };

  return {
    ...contentForHashing,
    index_content_hash: indexContentHash,
    generated_at: generatedAt,
    counts,
  };
}
