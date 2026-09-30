#!/usr/bin/env node
/**
 * runSelfHealCli.mjs — Slice 8 CLI: run the end-to-end self-heal driver.
 *
 * Usage:
 *   node scripts/engineering-brain/patch/runSelfHealCli.mjs \
 *     --evidence <evidence.json> --repo <repoRoot> --base <commit> \
 *     [--signal <id>] [--manifest <path>] [--json]
 *
 * One evidence signal in, at most one verified fix PR out. --signal may be
 * omitted when the evidence file holds exactly one usable signal.
 *
 * Exit codes: 0 = PR opened, 1 = pipeline stopped fail-closed, 2 = bad CLI usage.
 * The driver never merges; review and merge stay human.
 */

import { runSelfHeal } from "./runSelfHeal.mjs";

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
    else if (a === "--manifest") out.manifest = takeFlagValue(argv, i++, a);
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

  const result = runSelfHeal({
    evidencePath: args.evidence,
    signalId: args.signalId,
    repoRoot: args.repo,
    baseCommit: args.base,
    manifestPath: args.manifest,
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`PR opened: ${result.pr.url}`);
    console.log(`Branch: ${result.branch}`);
    console.log(`Signal: ${result.signalId}`);
  } else {
    console.log(`stopped at stage "${result.stage}": ${result.reason}`);
    if (result.detail) console.log(`detail: ${result.detail}`);
    if (result.branch) console.log(`branch: ${result.branch}`);
  }
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
