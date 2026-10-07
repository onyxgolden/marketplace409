#!/usr/bin/env node
// Canonical Knowledge Slice 4 — final acceptance.
//
//   node scripts/engineering-brain/renderAcceptanceReport.mjs [--write]
//   node scripts/engineering-brain/renderAcceptanceReport.mjs --regenerate
//
// Default: fully read-only. Builds a fresh index at current HEAD (in memory only), validates the
// COMMITTED manifest on disk against a fresh build of its OWN recorded commit (see
// validateProductionManifest.mjs -- never current HEAD; a committed file cannot contain the SHA of
// the commit that contains it), runs the security self-check, and measures canonical-coverage
// findings in the doc-drift integration. Nothing on disk is modified. --write additionally saves the
// rendered report to engineering-brain/acceptance-report.md; it never touches the manifest.
//
// --regenerate is a separate, explicit action: it ONLY overwrites index-manifest.json,
// index-report.md, and (by calling buildContentTokensSidecar.mjs) content-tokens.json from a fresh
// build at current HEAD, then exits without computing or printing an acceptance report. Commit the
// result, then re-run this command without flags to validate what you committed. Regeneration and
// validation never run in the same process invocation -- that is precisely the self-fulfilling
// pattern the Slice 4 review caught and this rewrite exists to rule out structurally.
//
// Exits 1 when acceptance is not clean, so a failing state cannot look like a pass.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runEngineeringBrainIndexer } from "./runEngineeringBrainIndexer.mjs";
import { getRegistry } from "./canonicalDocumentRegistry.mjs";
import { runValidation } from "./validateProductionManifest.mjs";
import { buildCoverageModel } from "./canonicalCoverageReport.mjs";
import { missingReferenceStatusAtCommit } from "./missingReferencePresence.mjs";
import { canonicalCoverageDriftFindings } from "./docs/canonicalCoverageDriftFindings.mjs";
import { runSecuritySelfCheck } from "./securitySelfCheck.mjs";
import { buildAcceptanceModel, renderAcceptanceReport } from "./acceptanceReport.mjs";

const REPORT_PATH = "engineering-brain/acceptance-report.md";

// Fields that legitimately differ between a full build (no previous manifest) and an incremental
// build against whatever manifest happens to be committed (which may be old): which paths it thinks
// are deleted, and anything derived purely from that comparison baseline. The question this check
// asks is narrower and more important: do the two builds agree on every CURRENTLY tracked path's
// effective record content and the coverage conclusion drawn from it.
function effectiveState(manifest) {
  return { records: manifest.records, coverage_issues: manifest.coverage_issues, index_content_hash: manifest.index_content_hash };
}

export function runAcceptance(repositoryRoot) {
  // Full, non-incremental, read-only build at current HEAD -- registry counts, index counts, and the
  // doc-drift check all describe the repository as it is right now.
  const { manifest: freshManifest } = runEngineeringBrainIndexer({ repositoryRoot, useIncrementalReuse: false, write: false });

  // Incremental build against whatever is CURRENTLY COMMITTED on disk (read-only: loadPreviousManifest
  // inside the indexer only reads it, never writes). Proves the production incremental path, run
  // against the artifact as it actually sits right now, converges with a full build on every
  // currently-tracked path.
  const { manifest: incrementalManifest } = runEngineeringBrainIndexer({ repositoryRoot, useIncrementalReuse: true, write: false });
  const equivalent = JSON.stringify(effectiveState(freshManifest)) === JSON.stringify(effectiveState(incrementalManifest));
  const incrementalEquivalence = {
    equivalent,
    detail: equivalent
      ? `${freshManifest.records.length} records and the coverage conclusion match between the full build and an incremental build against the currently committed manifest.`
      : `Effective-record or coverage mismatch between the full build (${freshManifest.records.length} records) and an incremental build against the currently committed manifest (${incrementalManifest.records.length} records).`,
  };

  // Manifest validation: entirely read-only, entirely about the artifact already on disk. See
  // validateProductionManifest.mjs for the freshness contract (never current HEAD).
  const manifestValidation = runValidation(repositoryRoot);

  // Coverage, with REAL MISSING_REFERENCES presence at this exact commit -- an empty map here would
  // silently reopen the Slice 3 fail-open bug at this integration boundary (Slice 4 review finding).
  const missingReferenceStatus = missingReferenceStatusAtCommit(freshManifest.commit_sha, repositoryRoot);
  const coverageModel = buildCoverageModel({ registry: getRegistry(), manifest: freshManifest, missingReferenceStatus });

  const security = runSecuritySelfCheck();
  const docDrift = { findingCount: canonicalCoverageDriftFindings(coverageModel).length };

  const model = buildAcceptanceModel({
    registry: getRegistry(), freshManifest, coverageIssueRows: coverageModel.issueRows,
    manifestValidation, incrementalEquivalence, security, docDrift,
  });
  const report = renderAcceptanceReport(model);
  const clean = model.coverageIssueCount === 0 && manifestValidation.ok && incrementalEquivalence.equivalent && security.pass;
  return { report, clean, model };
}

/**
 * The one place that overwrites the committed artifact. Never called by runAcceptance. Calls
 * runEngineeringBrainIndexer directly (default write:true, incremental) rather than shelling out to
 * its CLI -- a subprocess invocation here would depend on that script's own `node file.mjs` entry
 * guard, which is a separate, real thing to get right on every platform and not worth coupling to.
 * The content-tokens sidecar has no such guard (plain top-level script), so it stays a subprocess.
 */
function regenerate(repositoryRoot) {
  const { manifest } = runEngineeringBrainIndexer({ repositoryRoot, write: true });
  console.error(`Regenerated index-manifest.json and index-report.md at commit ${manifest.commit_sha}.`);
  const sidecarScript = path.join(repositoryRoot, "scripts/engineering-brain/buildContentTokensSidecar.mjs");
  execFileSync(process.execPath, [sidecarScript], { cwd: repositoryRoot, stdio: "inherit" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repositoryRoot = process.cwd();
  if (process.argv.includes("--regenerate")) {
    regenerate(repositoryRoot);
    console.error("Regenerated index-manifest.json, index-report.md, and content-tokens.json at current HEAD. Commit these files, then re-run this command WITHOUT --regenerate to validate what you committed.");
  } else {
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
}
