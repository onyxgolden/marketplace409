#!/usr/bin/env node
/**
 * run-manual.js — standalone manual runner for the engineering-manager
 * prototype. Reads a task JSON file and a context JSON file, runs the
 * planner, and prints the canonical advisory JSON to stdout.
 *
 * Usage: node runner/run-manual.js <task.json> <context.json>
 *
 * The agent has no file-write API; this host-side runner may save the
 * printed report to an explicit scratch directory if desired. Nothing here
 * grants the agent any capability.
 */

import { readFileSync } from "node:fs";
import { run } from "../src/index.js";
import { canonicalJson } from "../src/canonical.js";
import { planToMarkdown } from "../src/markdown.js";

const [taskPath, contextPath, mode] = process.argv.slice(2);
if (!taskPath || !contextPath) {
  console.error("usage: node runner/run-manual.js <task.json> <context.json> [json|md]");
  process.exit(2);
}

const task = JSON.parse(readFileSync(taskPath, "utf8"));
const context = JSON.parse(readFileSync(contextPath, "utf8"));
const result = run(task, context);
if (mode === "md") {
  process.stdout.write(planToMarkdown(result) + "\n");
} else {
  process.stdout.write(canonicalJson(result) + "\n");
}
