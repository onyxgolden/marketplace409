#!/usr/bin/env node
// watchdogCli.mjs — run the Brain runtime watchdog (Slice 4 / W2+W3).
//
// Read-only: the watchdog reads evidence and writes only its own alert
// state. It never refires, never touches cron endpoints, holds no
// CRON_SECRET.
//
// IMPORTANT (W2): run this from a scheduler INDEPENDENT of the GitHub
// Actions scheduler being watched (e.g. the Muse runtime cron or a host
// cron) — otherwise a GitHub scheduling outage suppresses both the
// firer and the watchdog.
//
// Usage:
//   node scripts/engineering-brain/evidence/watchdog/watchdogCli.mjs [--out alerts.json] [--state-file <path>]
//
// Env (all optional for a dry evaluation; required for live evidence):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GITHUB_TOKEN
// Exit code: 0 = no new alerts; 1 = new alerts need attention.

import { writeFileSync } from "node:fs";
import { createSupabaseServiceClient } from "../../persistence/syncManifestToSupabase.mjs";
import { runWatchdog, defaultStateFile, repoRootDefault } from "./runWatchdog.mjs";
import { GITHUB_OWNER_REPO } from "../evidenceAdapters.mjs";

function parseArgs(argv) {
  const args = { out: null, stateFile: defaultStateFile() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--state-file") args.stateFile = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function buildDeps() {
  const deps = {};
  try {
    deps.supabase = createSupabaseServiceClient();
  } catch {
    // Missing credentials: adapters fail closed per-source; the run
    // still evaluates and reports ambiguous rather than crashing.
  }
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    const [owner, repo] = (process.env.GITHUB_OWNER_REPO || GITHUB_OWNER_REPO).split("/");
    deps.githubApi = {
      async listWorkflowRuns(workflowFile) {
        const url =
          `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/runs` +
          `?per_page=5&exclude_pull_requests=true`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        });
        if (!res.ok) throw new Error(`GitHub API ${res.status} for ${workflowFile}`);
        const body = await res.json();
        return (body.workflow_runs || []).map((r) => ({
          conclusion: r.conclusion,
          status: r.status,
          startedAt: r.run_started_at,
          htmlUrl: r.html_url,
        }));
      },
    };
  }
  return deps;
}

const args = parseArgs(process.argv.slice(2));
const { alerts, resolved, summary } = await runWatchdog({
  now: Date.now(),
  deps: buildDeps(),
  repoRoot: repoRootDefault(),
  stateFile: args.stateFile,
});

const output = JSON.stringify({ summary, new_alerts: alerts, resolved }, null, 2);
if (args.out) writeFileSync(args.out, output);

for (const a of alerts) {
  console.log(`ALERT [${a.state}] ${a.capability_id} slot ${a.slot_expected_at_utc}: ${a.reason}`);
}
for (const r of resolved) {
  console.log(`RESOLVED ${r}`);
}
console.log(
  `Watchdog: ${summary.capabilities_evaluated} capabilities, ${summary.new_alerts} new alert(s), ${summary.resolved} resolved.`
);
process.exit(summary.new_alerts > 0 ? 1 : 0);
