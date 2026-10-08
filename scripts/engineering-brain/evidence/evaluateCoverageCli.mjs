#!/usr/bin/env node
// evaluateCoverageCli.mjs — run the Slice 3 coverage evaluation live.
//
// Read-only: adapters issue only SELECT (Supabase) and GET (GitHub).
// Fails closed when credentials are missing.
//
// Usage:
//   node scripts/engineering-brain/evidence/evaluateCoverageCli.mjs --all --out coverage.json
//   node scripts/engineering-brain/evidence/evaluateCoverageCli.mjs --capability rental-autopay-sweep
//
// Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GITHUB_TOKEN
//   (repo scope, read-only use). GITHUB_OWNER/GITHUB_REPO default to
//   onyxgolden/marketplace409.

import { writeFileSync } from "node:fs";
import { createSupabaseServiceClient } from "../persistence/syncManifestToSupabase.mjs";
import { evaluateAll, evaluateCapability } from "./evaluateCoverage.mjs";
import { GITHUB_OWNER_REPO } from "./evidenceAdapters.mjs";

function parseArgs(argv) {
  const args = { all: false, capability: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--all") args.all = true;
    else if (a === "--capability") args.capability = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.all && !args.capability) throw new Error("Pass --all or --capability <id>");
  return args;
}

function buildGithubApi() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required for the github-actions adapter.");
  const [owner, repo] = (process.env.GITHUB_OWNER_REPO || GITHUB_OWNER_REPO).split("/");
  return {
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

const args = parseArgs(process.argv.slice(2));
const deps = { supabase: createSupabaseServiceClient(), githubApi: buildGithubApi() };
const now = Date.now();

const results = args.all
  ? await evaluateAll({ now, deps })
  : [await evaluateCapability(args.capability, { now, deps })];

const summary = {
  evaluated_at: new Date(now).toISOString(),
  covered: results.filter((r) => r.verdict === "covered").length,
  gap: results.filter((r) => r.verdict === "gap").length,
  unknown: results.filter((r) => r.verdict === "unknown").length,
  results,
};

const text = JSON.stringify(summary, null, 2);
if (args.out) {
  writeFileSync(args.out, text);
  console.log(`Wrote ${args.out}: ${summary.covered} covered, ${summary.gap} gap, ${summary.unknown} unknown`);
} else {
  console.log(text);
}
