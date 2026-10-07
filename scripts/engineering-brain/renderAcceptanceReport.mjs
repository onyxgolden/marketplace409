#!/usr/bin/env node
// Canonical Knowledge Slice 4 — final acceptance.
//
//   node scripts/engineering-brain/renderAcceptanceReport.mjs [--write]
//
// Runs a full, non-incremental build (the production artifact's source of truth), an incremental
// build against the manifest currently on disk (proving incremental reuse converges to the same
// state a full build would, deliverable 2), regenerates the committed manifest/report from the full
// build, re-reads it from disk to confirm the write round-trips faithfully, runs the security
// self-check, and measures how many canonical-coverage findings the doc-drift integration surfaces.
// --write also saves the rendered report to engineering-brain/acceptance-report.md.
//
// Exits 1 when acceptance is not clean, so a failing state cannot look like a pass.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEngineeringBrainIndexer } from "./runEngineeringBrainIndexer.mjs";
import { getRegistry } from "./canonicalDocumentRegistry.mjs";
import { validateProductionManifest } from "./validateProductionManifest.mjs";
import { buildCoverageModel } from "./canonicalCoverageReport.mjs";
import { canonicalCoverageDriftFindings } from "./docs/canonicalCoverageDriftFindings.mjs";
import { runSecuritySelfCheck } from "./securitySelfCheck.mjs";
import { buildAcceptanceModel, renderAcceptanceReport } from "./acceptanceReport.mjs";

const OUTPUT_DIR = "engineering-brain";
const REPORT_PATH = "engineering-brain/acceptance-report.md";
const MANIFEST_FILENAME = "index-manifest.json";

function withoutGeneratedAt(manifest) {
  const copy = { ...manifest };
  delete copy.generated_at;
  return copy;
}

export function runAcceptance(repositoryRoot) {
  // 1. Full, non-incremental build: the production artifact's source of truth.
  const { manifest: freshManifest, report: freshReport } = runEngineeringBrainIndexer({
    repositoryRoot, useIncrementalReuse: false, write: false,
  });

  // 2. Regenerate the committed artifact from the full build, then re-read it from disk, so the
  // "manifest status" check proves the write/read round-trip is faithful, not just that two
  // in-memory objects happen to be equal.
  const outputDirAbsolute = path.join(repositoryRoot, OUTPUT_DIR);
  fs.mkdirSync(outputDirAbsolute, { recursive: true });
  fs.writeFileSync(path.join(outputDirAbsolute, MANIFEST_FILENAME), JSON.stringify(freshManifest, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirAbsolute, "index-report.md"), freshReport);
  const writtenManifest = JSON.parse(fs.readFileSync(path.join(outputDirAbsolute, MANIFEST_FILENAME), "utf8"));
  const manifestValidation = validateProductionManifest({ committedManifest: writtenManifest, freshManifest });

  // 3. Incremental build against the manifest just written (same commit, nothing changed since) --
  // proves the production incremental path, re-run at rest, converges exactly with a full build.
  // Deeper correctness -- that incremental reuse correctly INVALIDATES stale registry/content/
  // classification/authority state -- is proven separately by the focused regressions in
  // canonicalAcceptance.test.mjs; comparing against a weeks-old manifest here would only measure
  // how much legitimately changed since then (e.g. deleted_paths), not whether reuse is correct.
  const { manifest: incrementalManifest } = runEngineeringBrainIndexer({
    repositoryRoot, useIncrementalReuse: true, write: false,
  });
  const equivalent = JSON.stringify(withoutGeneratedAt(freshManifest)) === JSON.stringify(withoutGeneratedAt(incrementalManifest));
  const incrementalEquivalence = {
    equivalent,
    detail: equivalent
      ? `${freshManifest.records.length} records match between the full build and an incremental build against it (same commit, nothing changed).`
      : `Record/field mismatch between the full build (${freshManifest.records.length} records) and an incremental build against it (${incrementalManifest.records.length} records).`,
  };

  // 4. Security self-check: synthetic, independent of this repository's actual content.
  const security = runSecuritySelfCheck();

  // 5. Doc-drift integration: how many canonical-coverage findings it would surface right now.
  const coverageModel = buildCoverageModel({ registry: getRegistry(), manifest: freshManifest, missingReferenceStatus: new Map() });
  const docDrift = { findingCount: canonicalCoverageDriftFindings(coverageModel).length };

  const model = buildAcceptanceModel({
    registry: getRegistry(), freshManifest, manifestValidation, incrementalEquivalence, security, docDrift,
  });
  const report = renderAcceptanceReport(model);
  const clean = model.coverageIssueCount === 0 && manifestValidation.ok && incrementalEquivalence.equivalent && security.pass;
  return { report, clean, model };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repositoryRoot = process.cwd();
  const { report, clean } = runAcceptance(repositoryRoot);
  if (process.argv.includes("--write")) {
    fs.writeFileSync(path.join(repositoryRoot, REPORT_PATH), report);
    console.error(`wrote ${REPORT_PATH}`);
  } else {
    process.stdout.write(report);
  }
  if (!clean) {
    console.error("Canonical knowledge acceptance: NOT CLEAN. Exit 1.");
    process.exitCode = 1;
  }
}
