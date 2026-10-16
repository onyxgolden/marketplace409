#!/usr/bin/env node
/**
 * run-manual.js — standalone manual runner (host launcher).
 *
 * Usage: node runner/run-manual.js <task.json> <context.json> [md]
 *
 * Reads the task and the explicitly injected context (fixed clock,
 * fixture store, grants, authority table), runs the agent, and prints
 * the canonical advisory JSON to stdout. With the `md` argument, prints
 * the Markdown rendering instead (same JSON, no new claims).
 *
 * The agent itself has no file-write API; this launcher is the host.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const [taskPath, contextPath, mode] = process.argv.slice(2);
if (!taskPath || !contextPath) {
  console.error("usage: node runner/run-manual.js <task.json> <context.json> [md]");
  process.exit(2);
}

const task = JSON.parse(readFileSync(taskPath, "utf8"));
const context = JSON.parse(readFileSync(contextPath, "utf8"));

const { run, canonicalJson } = await import(pathToFileURL(join(ROOT, "src", "index.js")).href);
const result = run(task, context);

if (mode === "md") {
  const { renderMarkdown } = await import(pathToFileURL(join(ROOT, "src", "markdown.js")).href);
  process.stdout.write(renderMarkdown(result) + "\n");
} else {
  process.stdout.write(canonicalJson(result) + "\n");
}
