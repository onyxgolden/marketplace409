#!/usr/bin/env node
/**
 * run-manual.js — standalone manual runner for the Tax Agent prototype.
 * Manual runs only: loads the fixtures, runs one draft task, prints the
 * JSON result and an inert Markdown preview. Not part of the scored path.
 *
 * Usage: node runner/run-manual.js <topic_id> [--year 2026] [--as-of <iso>] [--mode current_education|historical_education] [--md]
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { renderMarkdown } from "../src/markdown.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

const args = process.argv.slice(2);
const topic_id = args[0];
if (!topic_id) {
  console.error("usage: node runner/run-manual.js <topic_id> [--year 2026] [--as-of <iso>] [--mode current_education|historical_education] [--md]");
  process.exit(2);
}
const entry = store.registry.find((e) => e.topic_id === topic_id);
if (!entry) {
  console.error(`unknown topic_id '${topic_id}' (not registered)`);
  process.exit(2);
}
const yearIdx = args.indexOf("--year");
const asOfIdx = args.indexOf("--as-of");
const modeIdx = args.indexOf("--mode");
const mode = modeIdx >= 0 ? args[modeIdx + 1] : "current_education";
const as_of_date = asOfIdx >= 0 ? args[asOfIdx + 1] : "2026-06-01T00:00:00Z";
const tax_year = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2026;

const context = {
  clock: Date.parse(as_of_date),
  registry: store.registry,
  sources: store.sources,
  readGrants: store.readGrants,
  stewards: store.stewards,
  registrations: store.registrations,
  reviewRecords: store.reviewRecords,
};

const result = run(
  {
    task_id: `manual-${Date.now()}`,
    requested_action: "draft_education",
    topic_id,
    topic_label: entry.topic_label,
    jurisdiction: "US-FEDERAL",
    tax_year,
    as_of_date,
    mode,
    source_refs: [],
  },
  context
);
if (args.includes("--md")) {
  console.log(renderMarkdown(result));
} else {
  console.log(JSON.stringify(result, null, 2));
}
