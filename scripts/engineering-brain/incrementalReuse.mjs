// Requirement 9: use incremental content hashes so unchanged records can be identified without
// reprocessing later. Git already gives every tracked file a content-addressed blob SHA for free
// (see gitRepository.mjs) -- reusing that as the "did this file change" check means the incremental
// pass costs nothing beyond the `git ls-tree` already needed to enumerate files, no extra hashing.
//
// A previous manifest records `file_blob_shas: { [path]: blobSha }` (see buildManifest.mjs) alongside
// its records. Given that plus the current tracked-file list, this module decides which files can
// skip full reprocessing (content read + symbol/SQL/section extraction) and reuse their prior
// records outright, and which previously-indexed paths have disappeared and must be dropped rather
// than carried forward stale (requirement 5, deleted-source handling).
//
// SQL migration files are deliberately excluded from reuse: a single unchanged migration file can
// still change another object's *current effective* definition if a LATER migration in the same
// build was added/changed (e.g. a new migration drops a policy an old, unchanged migration created)
// -- so the sql_* record set is always rebuilt from the full migration set, never partially reused.
//
// `currentExtractorVersion` guards against a subtler staleness source: a file's blob SHA only says
// the *file* didn't change, not that the *extraction code* reading it didn't. Fixing a bug in a
// symbol/SQL/section extractor must invalidate every previously-cached record, even for files whose
// content is untouched -- otherwise the fix would silently never take effect. When the previous
// manifest's extractor_version doesn't match, this treats the run as if there were no previous
// manifest at all (full rebuild), exactly once, until the next run is incremental again.
export function partitionFilesForIncrementalBuild(trackedFiles, previousManifest, currentExtractorVersion) {
  if (!previousManifest || previousManifest.extractor_version !== currentExtractorVersion) {
    return { toProcess: trackedFiles, reusableRecordsByPath: new Map() };
  }

  const previousBlobShas = previousManifest.file_blob_shas || {};
  const previousRecordsByPath = new Map();
  for (const record of previousManifest.records || []) {
    if (!previousRecordsByPath.has(record.source_path)) previousRecordsByPath.set(record.source_path, []);
    previousRecordsByPath.get(record.source_path).push(record);
  }

  const toProcess = [];
  const reusableRecordsByPath = new Map();

  for (const file of trackedFiles) {
    const isMigration = /^supabase\/migrations\/.*\.sql$/.test(file.path);
    const unchanged = !isMigration
      && previousBlobShas[file.path] === file.blobSha
      && previousRecordsByPath.has(file.path);

    if (unchanged) {
      reusableRecordsByPath.set(file.path, previousRecordsByPath.get(file.path));
    } else {
      toProcess.push(file);
    }
  }

  return { toProcess, reusableRecordsByPath };
}

export function findDeletedPaths(trackedFiles, previousManifest) {
  if (!previousManifest) return [];
  const currentPaths = new Set(trackedFiles.map((file) => file.path));
  const previousPaths = new Set(Object.keys(previousManifest.file_blob_shas || {}));
  return Array.from(previousPaths).filter((path) => !currentPaths.has(path));
}
