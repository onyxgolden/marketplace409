#!/usr/bin/env node
/**
 * runNightlySelfHealCli.mjs — Slice 9 CLI: run the nightly self-heal pass.
 *
 * Usage:
 *   node scripts/engineering-brain/patch/runNightlySelfHealCli.mjs \
 *     --evidence <evidence.json> --repo <repoRoot> --base <commit> \
 *     [--signal <id>] [--max-attempts <n>] [--github-actions] \
 *     [--dry-run] [--json]
 *
 * Each new usable signal gets at most one driver run; the driver opens at
 * most one fix PR per signal. --github-actions swaps the network deps to
 * GITHUB_TOKEN adapters (requires GITHUB_TOKEN and GITHUB_REPOSITORY in the
 * environment); otherwise the driver's local defaults apply.
 *
 * Exit codes: 0 = clean pass, 1 = runner failure, 2 = bad CLI usage.
 * The runner never merges; review and merge stay human.
 */

import { runNightlySelfHeal, DEFAULT_MAX_ATTEMPTS } from "./runNightlySelfHeal.mjs";
import { makeGithubActionsDeps } from "./githubActionsDeps.mjs";

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
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--evidence") out.evidence = takeFlagValue(argv, i++, a);
    else if (a === "--signal") out.signalId = takeFlagValue(argv, i++, a);
    else if (a === "--repo") out.repo = takeFlagValue(argv, i++, a);
    else if (a === "--base") out.base = takeFlagValue(argv, i++, a);
    else if (a === "--max-attempts") out.maxAttempts = takeFlagValue(argv, i++, a);
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
  for (const req of ["evidence", "repo", "base"]) {
    if (!args[req]) {
      console.error(`error: --${req} is required`);
      process.exit(2);
    }
  }

  let maxAttempts = DEFAULT_MAX_ATTEMPTS;
  if (args.maxAttempts !== undefined) {
    maxAttempts = Number(args.maxAttempts);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      console.error("error: --max-attempts must be a positive integer");
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

  const result = runNightlySelfHeal({
    evidencePath: args.evidence,
    signalId: args.signalId,
    repoRoot: args.repo,
    baseCommit: args.base,
    maxAttempts,
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
      `nightly self-heal: ${result.ok ? "clean" : "FAILED"} — ` +
        Object.entries(counts)
          .map(([k, v]) => `${v} ${k}`)
          .join(", ") || "no usable signals",
    );
    for (const w of result.warnings || []) console.log(`warning: ${w}`);
    if (!result.ok) console.log(`stage: ${result.stage} reason: ${result.reason}`);
  }

  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
