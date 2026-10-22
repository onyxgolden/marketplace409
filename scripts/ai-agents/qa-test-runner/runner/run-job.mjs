#!/usr/bin/env node
/**
 * run-job.mjs — CLI for the QA test-runner.
 *
 * Usage:
 *   node runner/run-job.mjs <job.json> [--out <report.json>] [--markdown-out <report.md>]
 *
 * Prints the canonical report JSON to stdout. Exit code is 0 only when
 * the advisory verdict is ALL_SUITES_PASS; 1 for any other job outcome
 * (including refusals); 2 for usage / unreadable job file errors.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { runJob, canonicalJson, reportToMarkdown } from "../src/index.js";

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const jobPath = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : null;
if (!jobPath) {
  console.error("usage: node runner/run-job.mjs <job.json> [--out <report.json>] [--markdown-out <report.md>]");
  process.exit(2);
}

let raw;
try {
  raw = readFileSync(jobPath, "utf8");
} catch (e) {
  console.error(`[runner] cannot read job file ${jobPath}: ${e.message}`);
  process.exit(2);
}

let job;
try {
  job = JSON.parse(raw);
} catch (e) {
  const report = {
    schema_version: "1",
    agent: "qa-test-runner",
    advisory: true,
    job_id: null,
    target: null,
    head_pin: null,
    checkout_head: null,
    status: "REFUSED",
    verdict: "REFUSED",
    reason_code: "INVALID_JOB",
    diagnostics: [{ code: "INVALID_JOB", path: "$", message: `job file is not valid JSON: ${e.message}` }],
    suites: [],
    totals: {
      suites_total: 0,
      suites_passed: 0,
      suites_failed: 0,
      suites_error: 0,
      suites_timeout: 0,
      suites_skipped_budget: 0,
      tests_total: 0,
      tests_passed: 0,
      tests_failed: 0,
      tests_pending: 0,
    },
  };
  console.log(canonicalJson(report));
  process.exit(1);
}

const report = await runJob(job);
console.log(canonicalJson(report));

const out = arg("--out");
if (out) writeFileSync(out, canonicalJson(report) + "\n");
const mdOut = arg("--markdown-out");
if (mdOut) writeFileSync(mdOut, reportToMarkdown(report) + "\n");

process.exit(report.verdict === "ALL_SUITES_PASS" ? 0 : 1);
