#!/usr/bin/env node
/**
 * run-manual.js — standalone manual runner for the Customer Success
 * Agent prototype. Manual runs only: loads the fixtures, runs one
 * analyze task against a named ticket bundle, prints the JSON result
 * and an inert Markdown preview. Not part of the scored path.
 *
 * Usage: node runner/run-manual.js <bundleName> [--clock <iso>] [--declared N] [--md]
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { renderMarkdown } from "../src/markdown.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

const args = process.argv.slice(2);
const bundleName = args[0];
if (!bundleName || !store.bundleRefs[bundleName]) {
  console.error(`usage: node runner/run-manual.js <bundleName> [--clock <iso>] [--declared N] [--md]`);
  console.error(`known bundles: ${Object.keys(store.bundleRefs).join(", ")}`);
  process.exit(2);
}
const clockIdx = args.indexOf("--clock");
const declaredIdx = args.indexOf("--declared");
const clock = clockIdx >= 0 ? args[clockIdx + 1] : "2026-07-01T00:00:00Z";
const bundleRef = store.bundleRefs[bundleName];
const declared_total = declaredIdx >= 0 ? Number(args[declaredIdx + 1]) : undefined;

// Minimal context (policy + this one bundle only) — a real host scopes
// context to one request's needs; the whole shared fixture store would
// blow the 64-object budget now that context validation is itself
// charged (CS-001 fix).
const policyKey = `${store.criteria.standard.policy_ref.repo}|${store.criteria.standard.policy_ref.path}`;
const bundleKey = `${bundleRef.repo}|${bundleRef.path}`;
const context = {
  clock: Date.parse(clock),
  sources: { [policyKey]: store.sources[policyKey], [bundleKey]: store.sources[bundleKey] },
  readGrants: [{ repo: store.criteria.standard.policy_ref.repo, path: store.criteria.standard.policy_ref.path }, { repo: bundleRef.repo, path: bundleRef.path }],
  principal: store.principals.jasonActive,
  criteria: store.criteria.standard,
};

const task = {
  schema_version: "1",
  task_id: `manual-${Date.now()}`,
  operation: "analyze",
  fixture_refs: { ticket_bundle: bundleRef },
  options: {
    population: { declared_total: declared_total ?? 0, complete: declared_total !== undefined },
    header_claims: { avg_response_minutes: null, avg_resolution_minutes: null, sla_compliance_pct: null, csat_mean: null, csat_positive_pct: null },
  },
};

const result = run(task, context);
if (args.includes("--md")) {
  console.log(renderMarkdown(result));
} else {
  console.log(JSON.stringify(result, null, 2));
}
