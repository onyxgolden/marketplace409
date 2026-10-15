#!/usr/bin/env node
/**
 * run-manual.js — standalone manual runner. Manual runs only: loads the
 * pinned fixtures, runs assemble_draft for one fixture id, prints the JSON
 * result (or Markdown with --md). Not part of the scored path.
 *
 * Usage: node runner/run-manual.js <fixture-id> [--md] [--clock <iso>]
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";
import { renderMarkdown } from "../src/markdown.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

const args = process.argv.slice(2);
const fixtureId = args[0];
if (!fixtureId || !store.fixtures[fixtureId]) {
  console.error(`usage: node runner/run-manual.js <fixture-id> [--md] [--clock <iso>]`);
  console.error(`known fixtures: ${Object.keys(store.fixtures).sort().join(", ")}`);
  process.exit(2);
}
const clockIdx = args.indexOf("--clock");
const clock = clockIdx >= 0 ? args[clockIdx + 1] : "2026-10-14T12:00:00Z";

const task = {
  task_id: "manual-" + fixtureId,
  bundle_refs: [store.fixtures[fixtureId].source_ref],
  period_ids: [],
  requested_action: "assemble_draft",
};
const context = {
  clock,
  fixtureStore: store,
  approvedRepos: ["forge-ai-drop-fixtures"],
};

const result = run(task, context);
if (args.includes("--md")) {
  console.log(renderMarkdown(result));
} else {
  console.log(JSON.stringify(result, null, 2));
}
