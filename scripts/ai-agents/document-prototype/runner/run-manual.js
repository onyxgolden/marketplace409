#!/usr/bin/env node
/**
 * run-manual.js — standalone manual runner for the Document Agent
 * prototype. Manual runs only: loads the fixtures, runs one analyze
 * task against a named document set, prints the JSON result. Not part
 * of the scored path.
 *
 * Usage: node runner/run-manual.js <setName> [--clock <iso>] [--declared N] [--criteria <name>]
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

const args = process.argv.slice(2);
const setName = args[0];
if (!setName || !store.documentSetRefs[setName]) {
  console.error(`usage: node runner/run-manual.js <setName> [--clock <iso>] [--declared N] [--criteria <name>]`);
  console.error(`known sets: ${Object.keys(store.documentSetRefs).join(", ")}`);
  process.exit(2);
}
const clockIdx = args.indexOf("--clock");
const declaredIdx = args.indexOf("--declared");
const criteriaIdx = args.indexOf("--criteria");
const clock = clockIdx >= 0 ? args[clockIdx + 1] : "2026-07-01T00:00:00Z";
const setRef = store.documentSetRefs[setName];
const declared_total = declaredIdx >= 0 ? Number(args[declaredIdx + 1]) : undefined;
const criteriaName = criteriaIdx >= 0 ? args[criteriaIdx + 1] : "standard";

const context = {
  clock: Date.parse(clock),
  sources: store.sources,
  readGrants: store.readGrants,
  principal: store.principals.jasonActive,
  criteria: store.criteria[criteriaName],
};

const task = {
  schema_version: "1",
  task_id: `manual-${Date.now()}`,
  operation: "analyze",
  fixture_refs: { document_set: setRef },
  options: {
    population: { declared_total: declared_total ?? 0, complete: declared_total !== undefined },
  },
};

const result = run(task, context);
console.log(JSON.stringify(result, null, 2));
