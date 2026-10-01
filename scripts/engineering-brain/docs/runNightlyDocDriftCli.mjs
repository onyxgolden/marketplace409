#!/usr/bin/env node
/**
 * runNightlyDocDriftCli.mjs — Slice 11 CLI: run the nightly doc-drift pass.
 *
 * Usage:
 *   node scripts/engineering-brain/docs/runNightlyDocDriftCli.mjs \
 *     --repo <repoRoot> --base <commit> [--docs <dir> ...] \
 *     [--max-fixes <n>] [--drift-id <id>] [--github-actions] \
 *     [--dry-run] [--json]
 *
 * Scans docs for drift (Slice 10), takes up to --max-fixes (default 3)
 * proposable findings, and runs each through the reviewed prepareFixPr
 * pipeline (branch + PR; never merge). Findings with a prior fix PR
 * (open, merged, or human-closed) are skipped; findings with no
 * deterministic patch are skipped. --github-actions swaps the network deps
 * to GITHUB_TOKEN adapters (requires GITHUB_TOKEN and GITHUB_REPOSITORY in
 * the environment); otherwise the driver's local defaults apply.
 *
 * Exit codes: 0 = clean pass, 1 = runner failure, 2 = bad CLI usage.
 * The runner never merges; review and merge stay human.
 */

import { runNightlyDocDrift, DEFAULT_MAX_FIXES } from "./runNightlyDocDrift.mjs";
import { makeGithubActionsDeps } from "../patch/githubActionsDeps.mjs";

function takeFlagValue(argv, i, flag) {
  const v = argv[i + 1];
  if (v === undefined || v === "" || v.startsWith("--")) {
    console.error(`error: ${flag} requires a value`);
    process.exit(2);
  }
  return v;
}

/** Exported for tests. */
export function parseArgs(argv) {
  const out = { docs: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") out.repo = takeFlagValue(argv, i++, a);
    else if (a === "--base") out.base = takeFlagValue(argv, i++, a);
    else if (a === "--docs") {
      out.docs = [];
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) out.docs.push(argv[++i]);
      if (out.docs.length === 0) {
        console.error("error: --docs requires at least one value");
        process.exit(2);
      }
    } else if (a === "--max-fixes") out.maxFixes = takeFlagValue(argv, i++, a);
    else if (a === "--drift-id") out.driftId = takeFlagValue(argv, i++, a);
    else if (a === "--github-actions") out.githubActions = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
    else {
      console.error(`error: unknown argument ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const req of ["repo", "base"]) {
    if (!args[req]) {
      console.error(`error: --${req} is required`);
      process.exit(2);
    }
  }

  let maxFixes = DEFAULT_MAX_FIXES;
  if (args.maxFixes !== undefined) {
    maxFixes = Number(args.maxFixes);
    if (!Number.isInteger(maxFixes) || maxFixes < 1) {
      console.error("error: --max-fixes must be a positive integer");
      process.exit(2);
    }
  }

  const deps = {};
  if (args.githubActions) {
    const token = process.env.GITHUB_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY;
    if (!token || !repo) {
      console.error("error: --github-actions requires GITHUB_TOKEN and GITHUB_REPOSITORY in the environment");
      process.exit(2);
    }
    Object.assign(deps, makeGithubActionsDeps({ token, repo }));
  }

  const result = runNightlyDocDrift({
    repoRoot: args.repo,
    docs: args.docs || ["docs"],
    baseCommit: args.base,
    maxFixes,
    driftId: args.driftId || null,
    dryRun: !!args.dryRun,
    deps,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const counts = {};
    for (const e of [...result.attempted, ...result.skipped, ...result.deferred]) {
      counts[e.outcome] = (counts[e.outcome] || 0) + 1;
    }
    console.log(
      `nightly doc-drift: ${result.ok ? "clean" : "FAILED"} — ` +
        Object.entries(counts)
          .map(([k, v]) => `${v} ${k}`)
          .join(", ") || "no findings",
    );
    for (const w of result.warnings || []) console.log(`warning: ${w}`);
    if (!result.ok) console.log(`stage: ${result.stage} reason: ${result.reason}`);
  }

  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
