#!/usr/bin/env node
/**
 * run-tests.js — P1-A test entry: runs the node:test suites in order.
 * Pure Node 24, zero dependencies. No trust bootstrap: this module has
 * no pinned corpus manifest (fixtures are plain JSON read by the tests
 * themselves) and imports nothing outside its own directory.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const testFiles = [
  "jobDefinition.test.js",
  "recurrence.test.js",
  "identity.test.js",
  "budget.test.js",
  "preview.test.js",
  "determinism.test.js",
];

let failed = 0;
for (const f of testFiles) {
  const r = spawnSync(process.execPath, ["--test", join(HERE, f)], { stdio: "inherit", env: process.env });
  if (r.status !== 0) {
    console.error(`FAIL: ${f} (exit ${r.status})`);
    failed++;
  }
}
process.exit(failed ? 1 : 0);
