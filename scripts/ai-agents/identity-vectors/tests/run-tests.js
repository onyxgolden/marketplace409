#!/usr/bin/env node
/**
 * run-tests.js — plain `node --test` entrypoint for the identity-vectors
 * pack (follows the budget-sentinels pack convention: vitest reports
 * "No test suite found" for these node:test files, pre-existing on main).
 * Node builtins only.
 */

import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const testFiles = readdirSync(join(ROOT, "tests"))
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .map((f) => join(ROOT, "tests", f));
if (testFiles.length === 0) {
  console.error("run-tests: no test files found");
  process.exit(3);
}
const child = spawnSync(process.execPath, ["--test", ...testFiles], {
  env: process.env,
  stdio: "inherit",
});
process.exit(child.status ?? 3);
