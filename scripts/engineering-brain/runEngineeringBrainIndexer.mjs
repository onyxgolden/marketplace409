import fs from "node:fs";
import path from "node:path";

import { resolveCommitSha, listTrackedFiles, readFileAtCommit } from "./gitRepository.mjs";
import { buildIndexRecords } from "./buildIndexRecords.mjs";
import { buildManifest } from "./buildManifest.mjs";
import { renderIndexReport } from "./renderIndexReport.mjs";
import { partitionFilesForIncrementalBuild, findDeletedPaths } from "./incrementalReuse.mjs";
import { EXTRACTOR_VERSION } from "./extractorVersion.mjs";

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

export function runEngineeringBrainIndexer({ repositoryRoot = process.cwd(), useIncrementalReuse = true, write = true } = {}) {
  const commitSha = resolveCommitSha(repositoryRoot);
  const trackedFiles = listTrackedFiles(commitSha, repositoryRoot);

  const previousManifest = useIncrementalReuse ? loadPreviousManifest(repositoryRoot) : null;
  const { toProcess, reusableRecordsByPath } = partitionFilesForIncrementalBuild(trackedFiles, previousManifest, EXTRACTOR_VERSION);
  const deletedPaths = findDeletedPaths(trackedFiles, previousManifest);

  const filesWithContent = toProcess.map((file) => ({
    ...file,
    content: readFileAtCommit(commitSha, file.path, repositoryRoot),
  }));

  const { records: freshRecords, excluded, outOfScope } = buildIndexRecords({ commitSha, files: filesWithContent });

  const reusedRecords = [];
  for (const records of reusableRecordsByPath.values()) {
    for (const record of records) {
      reusedRecords.push({ ...record, commit_sha: commitSha });
    }
  }

  const manifest = buildManifest({
    commitSha,
    generatedAt: currentTimestamp(),
    trackedFiles,
    records: [...freshRecords, ...reusedRecords],
    excluded,
    outOfScope,
    deletedPaths,
    extractorVersion: EXTRACTOR_VERSION,
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runEngineeringBrainIndexer({});
  console.log(`Indexed ${result.manifest.counts.indexed_total} records at commit ${result.manifest.commit_sha}`);
  console.log(`Excluded ${result.manifest.counts.excluded_total} records (see engineering-brain/index-report.md for reasons)`);
  console.log(`Out of scope: ${result.manifest.counts.out_of_scope_total}`);
  console.log(`Reused via incremental hash: ${result.reusedCount}; reprocessed: ${result.processedFileCount}`);
  console.log(`Index content hash: ${result.manifest.index_content_hash}`);
}
