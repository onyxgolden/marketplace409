#!/usr/bin/env node
/**
 * run-manual.js — host manual launcher (spawns AFTER the trust
 * bootstrap has authenticated the manifest root and every pinned
 * byte). Runs one ad-hoc task/context pair through the guarded
 * launcher and prints the resulting envelope as JSON.
 *
 * Usage: node runner/run-manual.js <task-json-file> <context-json-file>
 * Both inputs are fixture-only JSON; non-string or over-cap
 * transports refuse at the launcher boundary.
 */

import { readFileSync } from "node:fs";
import { runGuarded } from "./run-guarded.js";

const [taskFile, contextFile] = process.argv.slice(2);
if (!taskFile || !contextFile) {
  console.error("usage: node runner/run-manual.js <task-json-file> <context-json-file>");
  process.exit(2);
}
const taskJson = readFileSync(taskFile, "utf8");
const contextJson = readFileSync(contextFile, "utf8");
const result = await runGuarded(taskJson, contextJson);
console.log(JSON.stringify(result, null, 2));
process.exit(0);
