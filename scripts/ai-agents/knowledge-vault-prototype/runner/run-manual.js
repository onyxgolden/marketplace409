#!/usr/bin/env node
/**
 * run-manual.js — standalone manual runner for the knowledge-vault
 * prototype. Manual runs only: loads the fixtures, runs one query,
 * prints the JSON result. Not part of the scored path.
 *
 * Usage: node runner/run-manual.js "<query>" [--tags a,b] [--as-of <iso>] [--key <query_key>]
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const vocabulary = JSON.parse(readFileSync(join(ROOT, "fixtures", "vocabulary.json"), "utf8"));

const args = process.argv.slice(2);
const query = args[0];
if (!query) {
  console.error('usage: node runner/run-manual.js "<query>" [--tags a,b] [--as-of <iso>] [--key <query_key>]');
  process.exit(2);
}
const tagsIdx = args.indexOf("--tags");
const asOfIdx = args.indexOf("--as-of");
const keyIdx = args.indexOf("--key");

const context = {
  clock: Date.now(),
  vocabulary,
  sources: store.sources,
  readGrants: store.readGrants,
  stewards: store.stewards,
  registrations: store.registrations,
  supersessionRecords: store.supersessionRecords,
};

const result = run(
  {
    query,
    query_key: keyIdx >= 0 ? args[keyIdx + 1] : null,
    filters: {
      source_tags: tagsIdx >= 0 ? args[tagsIdx + 1].split(",") : [],
      max_source_age_days: null,
      as_of_date: asOfIdx >= 0 ? args[asOfIdx + 1] : null,
    },
    requested_action: "answer",
  },
  context
);
console.log(JSON.stringify(result, null, 2));
