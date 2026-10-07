#!/usr/bin/env node
// Canonical Knowledge Slice 4 — production manifest validation. Read-only: never writes, never
// regenerates. See scripts/engineering-brain/runEngineeringBrainIndexer.mjs for regeneration.
//
//   node scripts/engineering-brain/validateProductionManifest.mjs
//
// The freshness contract: a committed snapshot file can never contain the SHA of the commit that
// contains it (that commit does not exist yet when the file is written), so "freshness" cannot mean
// committedManifest.commit_sha === current HEAD. Instead this validates the committed artifact
// against a FRESH build of the exact commit it already claims (committedManifest.commit_sha, an
// ancestor commit) -- a self-consistency check that is always checkable, through git, regardless of
// what is currently on disk or checked out. Two things can fail:
//   1. the committed artifact does not accurately reproduce a fresh build of its own recorded
//      commit (stale, hand-edited, or corrupted), or that commit is not an ancestor of current HEAD
//      (wrong branch, or history was rewritten);
//   2. that fresh build has coverage issues at its own commit, including a declared-but-missing
//      reference (MISSING_REFERENCES) that is present there but still unregistered.
// Being an ancestor of HEAD is a sanity check, not a demand that the artifact be caught up to HEAD --
// closing that gap is a separate, explicit regeneration (see renderAcceptanceReport.mjs --regenerate).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAncestorCommit, resolveCommitSha } from "./gitRepository.mjs";
import { runEngineeringBrainIndexer } from "./runEngineeringBrainIndexer.mjs";
import { getRegistry } from "./canonicalDocumentRegistry.mjs";
import { buildCoverageModel } from "./canonicalCoverageReport.mjs";
import { missingReferenceStatusAtCommit } from "./missingReferencePresence.mjs";

const OUTPUT_DIR = "engineering-brain";
const MANIFEST_FILENAME = "index-manifest.json";

/**
 * Pure comparison. No filesystem or git access -- the caller (runValidation) does all I/O and hands
 * in already-computed pieces, so this is unit-testable without a real repository.
 *   committedManifest: parsed from disk, or null if missing/unparseable.
 *   freshManifest: a fresh, non-incremental build AT committedManifest.commit_sha (not HEAD).
 *   isAncestor: whether committedManifest.commit_sha is HEAD or a real ancestor of it.
 *   coverageIssueRows: buildCoverageModel(...).issueRows for freshManifest, with a REAL
 *     missingReferenceStatus (never an empty map -- that would silently reopen the Slice 3 bug).
 */
export function validateProductionManifest({ committedManifest, freshManifest, isAncestor, coverageIssueRows = [] }) {
  if (!committedManifest) {
    return { ok: false, problems: [`${MANIFEST_FILENAME} is missing; nothing to validate against.`] };
  }
  const problems = [];
  if (isAncestor === false) {
    problems.push(`Committed commit_sha ${committedManifest.commit_sha} is not an ancestor of the current HEAD. Wrong branch, or the artifact/history is corrupted.`);
  }
  const withoutGeneratedAt = (m) => { const c = { ...m }; delete c.generated_at; return c; };
  if (JSON.stringify(withoutGeneratedAt(committedManifest)) !== JSON.stringify(withoutGeneratedAt(freshManifest))) {
    problems.push(`Committed artifact does not accurately reproduce a fresh build of its own recorded commit ${committedManifest.commit_sha} (ignoring generated_at). It may be stale, hand-edited, or corrupted.`);
  }
  for (const issue of coverageIssueRows) {
    problems.push(`Coverage issue at the committed artifact's own commit (${committedManifest.commit_sha}): ${issue.path} -- ${issue.issue}`);
  }
  return { ok: problems.length === 0, problems };
}

/** All I/O lives here: reads the committed manifest and git history. Writes nothing, ever. */
export function runValidation(repositoryRoot) {
  const manifestPath = path.join(repositoryRoot, OUTPUT_DIR, MANIFEST_FILENAME);
  let committedManifest = null;
  try {
    committedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    committedManifest = null;
  }
  if (!committedManifest?.commit_sha) {
    return validateProductionManifest({ committedManifest: null, freshManifest: null, isAncestor: null, coverageIssueRows: [] });
  }
  const currentHead = resolveCommitSha(repositoryRoot);
  const isAncestor = isAncestorCommit(committedManifest.commit_sha, currentHead, repositoryRoot);
  const { manifest: freshManifest } = runEngineeringBrainIndexer({
    repositoryRoot, useIncrementalReuse: false, write: false, targetCommitSha: committedManifest.commit_sha,
  });
  const missingReferenceStatus = missingReferenceStatusAtCommit(committedManifest.commit_sha, repositoryRoot);
  const coverageModel = buildCoverageModel({ registry: getRegistry(), manifest: freshManifest, missingReferenceStatus });
  return validateProductionManifest({ committedManifest, freshManifest, isAncestor, coverageIssueRows: coverageModel.issueRows });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runValidation(process.cwd());
  if (result.ok) {
    console.log("Production manifest: self-consistent at its own recorded commit, an ancestor of HEAD, and coverage is clean there.");
  } else {
    console.error(`Production manifest validation failed (${result.problems.length} problem(s)):`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  }
}
