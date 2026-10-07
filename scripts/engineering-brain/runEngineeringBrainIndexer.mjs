import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCommitSha, listTrackedFiles, readFileAtCommit } from "./gitRepository.mjs";
import { buildIndexRecords } from "./buildIndexRecords.mjs";
import { buildManifest } from "./buildManifest.mjs";
import { renderIndexReport } from "./renderIndexReport.mjs";
import { partitionFilesForIncrementalBuild, findDeletedPaths } from "./incrementalReuse.mjs";
import { EXTRACTOR_VERSION } from "./extractorVersion.mjs";
import { getRegistry, validateRegistry } from "./canonicalDocumentRegistry.mjs";
import { registryCoverageIssues, registryFingerprint } from "./registryCoverage.mjs";

const OUTPUT_DIR = "engineering-brain";
const MANIFEST_FILENAME = "index-manifest.json";
const REPORT_FILENAME = "index-report.md";

function loadPreviousManifest(repositoryRoot) {
  const manifestPath = path.join(repositoryRoot, OUTPUT_DIR, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

// The one non-deterministic input in this whole pipeline, by design (requirement 2 explicitly
// carves it out): everything else is a pure function of commit content.
function currentTimestamp() {
  return new Date().toISOString();
}

// `targetCommitSha`: build the index AS OF that commit instead of the current HEAD. listTrackedFiles
// and readFileAtCommit already read through git by explicit SHA, never the working tree (see
// gitRepository.mjs), so this works correctly regardless of what is currently checked out --
// including an ancestor of HEAD that is no longer the tip. This is what lets a committed artifact be
// validated against a fresh build of the EXACT commit it claims to represent (Slice 4), rather than
// the commit that currently contains it -- a file cannot contain the SHA of the commit that contains
// it, so "freshness" can never mean commit_sha === current HEAD for a committed snapshot.
export function runEngineeringBrainIndexer({ repositoryRoot = process.cwd(), useIncrementalReuse = true, write = true, targetCommitSha = null } = {}) {
  const commitSha = targetCommitSha || resolveCommitSha(repositoryRoot);
  const trackedFiles = listTrackedFiles(commitSha, repositoryRoot);

  // The registry is part of the index identity: a change to it forces a full rebuild (incrementalReuse.mjs).
  const registry = getRegistry();
  const registryHash = registryFingerprint(registry);
  const previousManifest = useIncrementalReuse ? loadPreviousManifest(repositoryRoot) : null;
  const { toProcess, reusableRecordsByPath } = partitionFilesForIncrementalBuild(trackedFiles, previousManifest, EXTRACTOR_VERSION, registryHash);
  const deletedPaths = findDeletedPaths(trackedFiles, previousManifest);

  const filesWithContent = toProcess.map((file) => ({
    ...file,
    content: readFileAtCommit(commitSha, file.path, repositoryRoot),
  }));

  const { records: freshRecords, excluded, outOfScope } = buildIndexRecords({ commitSha, files: filesWithContent, registry });

  const reusedRecords = [];
  for (const records of reusableRecordsByPath.values()) {
    for (const record of records) {
      reusedRecords.push({ ...record, commit_sha: commitSha });
    }
  }

  // Coverage is checked against the FULL tracked list, not just the files re-read this run, so a
  // registered document reused from the previous index is still counted as indexed.
  const indexedPaths = new Set([...freshRecords, ...reusedRecords].map((record) => record.source_path));
  const excludedReasons = new Map(excluded.map((entry) => [entry.source_path, entry.reason]));
  const emittedAuthorityByPath = new Map();
  for (const record of [...freshRecords, ...reusedRecords]) {
    if (!emittedAuthorityByPath.has(record.source_path)) emittedAuthorityByPath.set(record.source_path, new Set());
    emittedAuthorityByPath.get(record.source_path).add(record.authority_level);
  }
  const coverageIssues = [
    ...registryCoverageIssues({
      registry,
      trackedPaths: new Set(trackedFiles.map((file) => file.path)),
      indexedPaths,
      excludedReasons,
      emittedAuthorityByPath,
    }),
    ...validateRegistry(registry).map((issue) => ({ path: "(registry)", classification: null, issue })),
  ];

  const manifest = buildManifest({
    commitSha,
    generatedAt: currentTimestamp(),
    trackedFiles,
    records: [...freshRecords, ...reusedRecords],
    excluded,
    outOfScope,
    deletedPaths,
    extractorVersion: EXTRACTOR_VERSION,
    registryHash,
    coverageIssues,
  });

  const report = renderIndexReport(manifest);

  if (write) {
    const outputDirAbsolute = path.join(repositoryRoot, OUTPUT_DIR);
    fs.mkdirSync(outputDirAbsolute, { recursive: true });
    fs.writeFileSync(path.join(outputDirAbsolute, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2) + "\n");
    fs.writeFileSync(path.join(outputDirAbsolute, REPORT_FILENAME), report);
  }

  return { manifest, report, reusedCount: reusedRecords.length, processedFileCount: filesWithContent.length };
}

// path.resolve + fileURLToPath, not a raw `file://${process.argv[1]}` string compare: the raw form
// never matches on Windows (backslashes, and a missing third slash), so this CLI entry point silently
// did nothing when invoked as `node runEngineeringBrainIndexer.mjs` there -- it happened to work on
// Linux CI only because a POSIX path already starts with "/". Discovered while building Slice 4's
// --regenerate path, which calls this function directly rather than relying on any CLI guard.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runEngineeringBrainIndexer({});
  console.log(`Indexed ${result.manifest.counts.indexed_total} records at commit ${result.manifest.commit_sha}`);
  console.log(`Excluded ${result.manifest.counts.excluded_total} records (see engineering-brain/index-report.md for reasons)`);
  console.log(`Out of scope: ${result.manifest.counts.out_of_scope_total}`);
  console.log(`Reused via incremental hash: ${result.reusedCount}; reprocessed: ${result.processedFileCount}`);
  console.log(`Index content hash: ${result.manifest.index_content_hash}`);
  const issues = result.manifest.coverage_issues;
  if (issues.length > 0) {
    console.error(`Registry coverage: ${issues.length} issue(s) -- see engineering-brain/index-report.md`);
    for (const issue of issues) console.error(`  ${issue.path}: ${issue.issue}`);
    process.exitCode = 1;
  }
}
