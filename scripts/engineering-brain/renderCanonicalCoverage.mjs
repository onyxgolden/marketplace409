// Command-line entry point for the canonical knowledge coverage report (Slice 3).
//
//   node scripts/engineering-brain/renderCanonicalCoverage.mjs            # print to stdout
//   node scripts/engineering-brain/renderCanonicalCoverage.mjs --write    # write engineering-brain/canonical-coverage-report.md
//
// Exits 1 when there are coverage issues, so an unclean registry cannot look like a clean run.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEngineeringBrainIndexer } from "./runEngineeringBrainIndexer.mjs";
import { getRegistry, MISSING_REFERENCES } from "./canonicalDocumentRegistry.mjs";
import { buildCoverageModel, renderCanonicalCoverageReport } from "./canonicalCoverageReport.mjs";

const REPORT_PATH = "engineering-brain/canonical-coverage-report.md";

export function generateCanonicalCoverageReport(repositoryRoot = process.cwd()) {
  // Writes nothing: the index is built in memory, with no incremental reuse, so the report always
  // reflects this commit exactly.
  const { manifest } = runEngineeringBrainIndexer({ repositoryRoot, useIncrementalReuse: false, write: false });
  const missingReferenceStatus = new Map(
    MISSING_REFERENCES.map((rel) => [rel, fs.existsSync(path.join(repositoryRoot, rel))]),
  );
  // The same registry module the indexer read, so the report and the index describe one registry.
  const model = buildCoverageModel({ registry: getRegistry(), manifest, missingReferenceStatus });
  return { report: renderCanonicalCoverageReport(model), issueCount: model.issueRows.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repositoryRoot = process.cwd();
  const { report, issueCount } = generateCanonicalCoverageReport(repositoryRoot);
  if (process.argv.includes("--write")) {
    const target = path.join(repositoryRoot, REPORT_PATH);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, report);
    console.error(`wrote ${REPORT_PATH}`);
  } else {
    process.stdout.write(report);
  }
  if (issueCount > 0) {
    console.error(`Canonical coverage: ${issueCount} issue(s). Exit 1.`);
    process.exitCode = 1;
  }
}
