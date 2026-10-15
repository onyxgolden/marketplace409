#!/usr/bin/env node
/**
 * run-simulation.js — manual driver for the consumption revalidation
 * simulator. Takes a mutation id from corpus/mutations.json, evaluates the
 * initial advisory, applies the mutation, and prints the simulator verdict.
 *
 * Usage: node runner/run-simulation.js <mutation_id>
 * Example: node runner/run-simulation.js gov-m-01
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { buildContext } = await import("../tests/harness.js");
const { run } = await import("../src/index.js");
const { reevaluate } = await import("../src/simulator.js");

const id = process.argv[2];
const mutations = JSON.parse(readFileSync(join(ROOT, "corpus", "mutations.json"), "utf8"));
const m = mutations.find((x) => x.mutation_id === id);
if (!m) {
  console.error(`unknown mutation id '${id}'; available: ${mutations.map((x) => x.mutation_id).join(", ")}`);
  process.exit(2);
}
const before = buildContext(ROOT, { contextOverrides: null });
const initial = run(m.task, before);
console.log(`initial: ${initial.status}/${initial.validity}/${initial.classification}`);
const after = buildContext(ROOT, { mutate: m.mutate });
const sim = reevaluate(m.task, initial, before, after);
console.log(JSON.stringify({ mutation_id: m.mutation_id, description: m.description, ...sim }, null, 2));
