#!/usr/bin/env node
/**
 * collectEvidenceCli.mjs — CLI: gather root-cause evidence for runtime signals.
 *
 * Pipeline position (after detection, before any fixer):
 *   node scripts/engineering-brain/signals/fetchSupabaseSignals.mjs --out /tmp/sig-sup.json
 *   python3 scripts/engineering-brain/signals/fetchGithubSignals.py --out /tmp/sig-gh.json
 *   node scripts/engineering-brain/signals/runUndiscoveredErrorsCli.mjs --signals merged.json   # detect
 *   node scripts/engineering-brain/signals/collectEvidenceCli.mjs --signals merged.json --out /tmp/evidence.json
 *
 * For ci_failed signals this calls the GitHub API (needs GITHUB_TOKEN) to
 * download the failed job's log. A fetch failure exits 1 — a collection
 * failure, never an all-clear. Delivery signals need no credentials.
 *
 * Usage:
 *   node scripts/engineering-brain/signals/collectEvidenceCli.mjs \
 *     --signals <merged-signals.json> --out <evidence.json> [--repo owner/repo]
 *
 * Exit codes: 0 = evidence written; 1 = collection failure; 2 = bad arguments.
 */

import { writeFileSync } from "node:fs";

import { loadSignals } from "./runUndiscoveredErrorsCli.mjs";
import {
  buildSignalEvidence,
  fetchFailedJobLog,
  runIdFromUrl,
} from "./collectEvidence.mjs";

function parseArgs(argv) {
  const args = { signalsPath: null, outPath: null, repo: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--signals") args.signalsPath = argv[++i];
    else if (arg === "--out") args.outPath = argv[++i];
    else if (arg === "--repo") args.repo = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.signalsPath) throw new Error("--signals <path> is required");
  if (!args.outPath) throw new Error("--out <path> is required");
  return args;
}

function parseRepo(repoFlag) {
  const repo = repoFlag || process.env.GITHUB_REPOSITORY || "onyxgolden/marketplace409";
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`cannot parse repo from --repo / GITHUB_REPOSITORY: ${repo}`);
  return { owner, name };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(2);
  }

  let signals;
  try {
    signals = loadSignals(args.signalsPath);
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(2);
  }

  const { owner, repo } = parseRepo(args.repo);
  const token = process.env.GITHUB_TOKEN || null;
  const evidence = {};
  try {
    for (const signal of signals) {
      if (signal.kind === "ci_failed") {
        if (!token) {
          throw new Error(
            `GITHUB_TOKEN is required: cannot fetch CI evidence for signal ${signal.signal_id}`,
          );
        }
        const runId = runIdFromUrl(signal.evidence && signal.evidence.run_url);
        if (!runId) throw new Error(`signal ${signal.signal_id} has no parsable run_url`);
        const ciLog = await fetchFailedJobLog({ owner, repo, runId, token });
        evidence[signal.signal_id] = buildSignalEvidence(signal, ciLog);
      } else {
        evidence[signal.signal_id] = buildSignalEvidence(signal, null);
      }
    }
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }

  const payload = {
    schema_version: "1.0",
    collected_at: new Date().toISOString(),
    repo: `${owner}/${repo}`,
    evidence,
  };
  writeFileSync(args.outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote evidence for ${Object.keys(evidence).length} signals to ${args.outPath}.`);
}

const invokedAsScript =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`, "file://").href;
if (invokedAsScript) main();
