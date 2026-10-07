#!/usr/bin/env node
// Canonical Knowledge Slice 4 — production manifest validation.
//
//   node scripts/engineering-brain/validateProductionManifest.mjs
//
// Fails non-zero when the committed engineering-brain/index-manifest.json does not match what a
// fresh, non-incremental build from the same repository head would produce. The one field this
// deliberately excludes is `generated_at` -- the indexer's own documented non-reproducible field
// (runEngineeringBrainIndexer.mjs: "The one non-deterministic input in this whole pipeline, by
// design"). Every other field must be byte-identical.
//
// Also fails non-zero when the fresh build itself has coverage issues, so a stale OR an unclean
// artifact both block acceptance -- a passing run is the only way this script says the production
// artifact is trustworthy.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEngineeringBrainIndexer } from "./runEngineeringBrainIndexer.mjs";

const OUTPUT_DIR = "engineering-brain";
const MANIFEST_FILENAME = "index-manifest.json";

// Fields allowed to differ between the committed artifact and a fresh build of the same commit.
const NON_REPRODUCIBLE_FIELDS = ["generated_at"];

function withoutNonReproducibleFields(manifest) {
  const copy = { ...manifest };
  for (const field of NON_REPRODUCIBLE_FIELDS) delete copy[field];
  return copy;
}

/** Pure: no filesystem access, no process exit. The CLI below does both. */
export function validateProductionManifest({ committedManifest, freshManifest }) {
  const problems = [];
  if (!committedManifest) {
    problems.push(`${MANIFEST_FILENAME} is missing; nothing to validate against.`);
    return { ok: false, problems };
  }
  if (committedManifest.commit_sha !== freshManifest.commit_sha) {
    problems.push(`Committed artifact is from commit ${committedManifest.commit_sha}, but the current head is ${freshManifest.commit_sha}. Regenerate it.`);
  }
  // coverage_issues is compared separately below, one message per issue, so it is excluded here --
  // otherwise a coverage mismatch would be reported twice, once generically and once precisely.
  const strip = (m) => { const c = withoutNonReproducibleFields(m); delete c.coverage_issues; return c; };
  const committedComparable = JSON.stringify(strip(committedManifest));
  const freshComparable = JSON.stringify(strip(freshManifest));
  if (committedComparable !== freshComparable) {
    problems.push("Committed artifact does not match a fresh build of the same head (ignoring generated_at). Regenerate it.");
  }
  if ((freshManifest.coverage_issues || []).length > 0) {
    for (const issue of freshManifest.coverage_issues) {
      problems.push(`Coverage issue: ${issue.path} -- ${issue.issue}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export function runValidation(repositoryRoot) {
  const manifestPath = path.join(repositoryRoot, OUTPUT_DIR, MANIFEST_FILENAME);
  let committedManifest = null;
  try {
    committedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    committedManifest = null;
  }
  const { manifest: freshManifest } = runEngineeringBrainIndexer({ repositoryRoot, useIncrementalReuse: false, write: false });
  return validateProductionManifest({ committedManifest, freshManifest });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runValidation(process.cwd());
  if (result.ok) {
    console.log("Production manifest: matches a fresh build, and coverage is clean.");
  } else {
    console.error(`Production manifest validation failed (${result.problems.length} problem(s)):`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  }
}
