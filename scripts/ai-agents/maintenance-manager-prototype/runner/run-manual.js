#!/usr/bin/env node
/**
 * run-manual.js — standalone manual runner. Reads a named fixture set,
 * runs the agent, prints the canonical JSON result to stdout. Not part
 * of the scored path; a convenience for manual exploration against the
 * fixture store.
 *
 * Usage: node runner/run-manual.js <set-name> [principal] [criteria] [as_of_date]
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [, , setName, principalName = "jasonActive", criteriaName = "standard", asOfOverride] = process.argv;

if (!setName) {
  console.error("usage: node runner/run-manual.js <set-name> [principal] [criteria] [as_of_date]");
  process.exit(2);
}

const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const ref = store.registerRefs[setName];
if (!ref) {
  console.error(`unknown set: ${setName}. Known sets: ${Object.keys(store.registerRefs).join(", ")}`);
  process.exit(2);
}

const sourceKey = `${ref.repo}|${ref.path}`;
const sourcesBag = store.sourcesBySet[setName];
const text = sourcesBag[sourceKey].revisions[ref.commit].text;
const register = JSON.parse(text);

const as_of_date = asOfOverride ?? store.asOf;
const task = {
  schema_version: "1",
  task_id: `manual-${setName}`,
  operation: "analyze",
  fixture_refs: { register: ref },
  options: {
    as_of_date,
    window: { start_date: "2026-01-01", end_date: "2026-12-31" },
    population: { declared_total: register.assets.length, complete: true },
  },
};
const context = {
  clock: Date.parse(`${as_of_date}T12:00:00Z`),
  sources: sourcesBag,
  readGrants: store.readGrantsBySet[setName],
  principal: store.principals[principalName],
  criteria: store.criteria[criteriaName],
};

console.log(JSON.stringify(run(task, context), null, 2));
