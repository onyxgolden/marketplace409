#!/usr/bin/env node
/**
 * runFixPrCli.mjs — Slice 7 CLI: run the fix branch + PR pipeline.
 *
 * Usage:
 *   node scripts/engineering-brain/patch/runFixPrCli.mjs \
 *     --patch <patch.json> --repo <repoRoot> --base <commit> \
 *     [--signal <id>] [--failed-step <step>] [--collected-at <ts>] \
 *     [--json]
 *
 * <patch.json> is the patch object returned by the narrow-rules proposer
 * (either the bare object or { patch, explanation }).
 *
 * Exit codes: 0 = PR opened, 1 = pipeline stopped fail-closed, 2 = bad CLI usage.
 * The pipeline never merges; review and merge stay human.
 */

import fs from "node:fs";
import { prepareFixPr } from "./prepareFixPr.mjs";

function takeFlagValue(argv, i, flag) {
  const v = argv[i + 1];
  if (v === undefined || v === "" || v.startsWith("--")) {
    console.error(`error: ${flag} requires a value`);
    process.exit(2);
  }
  return v;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--patch") out.patch = takeFlagValue(argv, i++, a);
    else if (a === "--repo") out.repo = takeFlagValue(argv, i++, a);
    else if (a === "--base") out.base = takeFlagValue(argv, i++, a);
    else if (a === "--signal") out.signalId = takeFlagValue(argv, i++, a);
    else if (a === "--failed-step") out.failedStep = takeFlagValue(argv, i++, a);
    else if (a === "--collected-at") out.collectedAt = takeFlagValue(argv, i++, a);
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
  for (const req of ["patch", "repo", "base"]) {
    if (!args[req]) {
      console.error(`error: --${req} is required`);
      process.exit(2);
    }
  }

  let patch;
  try {
    const parsed = JSON.parse(fs.readFileSync(args.patch, "utf8"));
    patch = parsed && parsed.patch ? parsed.patch : parsed;
  } catch (e) {
    console.error(`error: cannot read patch file: ${String((e && e.message) || e).slice(0, 200)}`);
    process.exit(2);
  }

  const result = prepareFixPr({
    patch,
    repoRoot: args.repo,
    baseCommit: args.base,
    context: {
      signalId: args.signalId,
      failedStep: args.failedStep,
      collectedAt: args.collectedAt,
    },
  });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`PR opened: ${result.pr.url}`);
    console.log(`Branch: ${result.branch}`);
    console.log(`Paired test: ${result.verification.pairedTest || "unknown"}`);
  } else {
    console.log(`stopped at stage "${result.stage}": ${result.reason}`);
    if (result.detail) console.log(`detail: ${result.detail}`);
    if (result.branch) console.log(`branch: ${result.branch}`);
    if (result.worktree) console.log(`worktree kept for inspection: ${result.worktree}`);
  }
  process.exit(result.ok ? 0 : 1);
}

main();
