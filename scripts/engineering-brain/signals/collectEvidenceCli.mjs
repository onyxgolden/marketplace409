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
  const args = { signalsPath: null, outPath: null, repo: null, debugAuth: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--signals") args.signalsPath = argv[++i];
    else if (arg === "--out") args.outPath = argv[++i];
    else if (arg === "--repo") args.repo = argv[++i];
    else if (arg === "--debug-auth") args.debugAuth = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.debugAuth) return args;
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

  // TEMPORARY diagnostic (remove after the jobs-API 404 is diagnosed):
  // tries the jobs endpoint with every auth variant and prints what GitHub
  // answers from the runner's network. Never prints the token itself.
  await debugAuthMatrix();

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
  const failedSignals = [];
  for (const signal of signals) {
    try {
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
    } catch (error) {
      // Fail-closed but not empty-handed: record the failure loudly in the
      // evidence file and keep going, so one flaky signal cannot erase the
      // evidence gathered for the others. Any per-signal failure still exits
      // nonzero below -- partial evidence is never an all-clear.
      failedSignals.push(signal.signal_id);
      evidence[signal.signal_id] = { status: "error", error: String((error && error.message) || error) };
      console.error(`error: signal ${signal.signal_id}: ${(error && error.message) || error}`);
    }
  }

  const payload = {
    schema_version: "1.0",
    collected_at: new Date().toISOString(),
    repo: `${owner}/${repo}`,
    evidence,
  };
  writeFileSync(args.outPath, JSON.stringify(payload, null, 2));
  if (failedSignals.length > 0) {
    console.error(
      `error: evidence collection failed for ${failedSignals.length}/${signals.length} signals: ${failedSignals.join(", ")}`,
    );
    process.exit(1);
  }
  console.log(`Wrote evidence for ${Object.keys(evidence).length} signals to ${args.outPath}.`);
}

/**
 * TEMPORARY diagnostic for the jobs-API 404. Tries the jobs endpoint with
 * every auth variant from the runner's network and prints status codes plus
 * rate-limit headers. Never prints the token. Delete after diagnosis.
 */
async function debugAuthMatrix() {
  const token = process.env.GITHUB_TOKEN || null;
  const probeRunId = "36669075487";
  const url = `https://api.github.com/repos/onyxgolden/marketplace409/actions/runs/${probeRunId}/jobs?per_page=1`;
  const runsUrl = `https://api.github.com/repos/onyxgolden/marketplace409/actions/runs?per_page=1`;
  const variants = [
    ["jobs Bearer standard", url, { Authorization: `Bearer ${token}` }],
    ["jobs token-scheme", url, { Authorization: `token ${token}` }],
    ["jobs Bearer curl-UA", url, { Authorization: `Bearer ${token}`, "User-Agent": "curl/8.0" }],
    ["jobs unauthenticated", url, {}],
    ["runs Bearer standard", runsUrl, { Authorization: `Bearer ${token}` }],
    ["runs unauthenticated", runsUrl, {}],
  ];
  for (const [label, target, auth] of variants) {
    try {
      const res = await fetch(target, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "engineering-brain-evidence",
          ...auth,
        },
      });
      const remaining = res.headers.get("x-ratelimit-remaining");
      const usedBy = res.headers.get("x-ratelimit-used");
      console.log(
        `debug-auth: ${label} -> HTTP ${res.status} ` +
          `(ratelimit remaining=${remaining} used=${usedBy})`,
      );
      await res.arrayBuffer();
    } catch (error) {
      console.log(`debug-auth: ${label} -> FETCH ERROR ${error.message}`);
    }
  }
  if (!token) console.log("debug-auth: WARNING GITHUB_TOKEN was empty");
  else console.log(`debug-auth: GITHUB_TOKEN present, length=${token.length}`);
}

const invokedAsScript =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`, "file://").href;
if (invokedAsScript) main();
