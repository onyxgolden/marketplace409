#!/usr/bin/env node
/**
 * run-manual.js — standalone manual runner for the QA/Inspection prototype.
 *
 * Usage:
 *   node runner/run-manual.js --task <task.json> --fixtures <dir> [--clock <ISO-Z>] [--out <dir>] [--markdown]
 *
 * Reads the task and fixture JSON files, injects a fixed clock and the scoped
 * fixture resolver, runs the prototype, and prints the canonical report JSON
 * to stdout. The agent itself has no file-write API; this host runner may
 * save the synthetic report to an explicit --out directory only.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { run, FixtureResolver, reportToMarkdown, canonicalJson } from "../src/index.js";

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
function flag(name) {
  return process.argv.includes(name);
}
function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

const taskPath = arg("--task");
const fixturesDir = arg("--fixtures");
if (!taskPath || !fixturesDir) {
  console.error("usage: node runner/run-manual.js --task <task.json> --fixtures <dir> [--clock <ISO-Z>] [--out <dir>] [--markdown]");
  process.exit(2);
}

const task = readJson(taskPath);
const fixtures = {
  builds: readJson(join(fixturesDir, "build-registry.json")),
  evidence: readJson(join(fixturesDir, "evidence.json")),
  artifacts: readJson(join(fixturesDir, "artifacts.json")),
  runs: readJson(join(fixturesDir, "runs.json")),
  grants: readJson(join(fixturesDir, "grants.json")),
};

const context = {
  clock: arg("--clock", "2026-10-12T00:00:00Z"),
  resolver: new FixtureResolver(fixtures),
};

const report = run(task, context);

if (flag("--markdown")) {
  console.log(reportToMarkdown(report));
} else {
  console.log(canonicalJson(report));
}

const outDir = arg("--out");
if (outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.json"), canonicalJson(report) + "\n");
  writeFileSync(join(outDir, "report.md"), reportToMarkdown(report) + "\n");
  console.error(`[runner] synthetic report saved to ${outDir} (agent performed no writes)`);
}
