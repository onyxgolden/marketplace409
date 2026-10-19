#!/usr/bin/env node
/**
 * run-tests.js — `npm test` implementation (NOT the trust boundary).
 *
 * S653-009: trust authentication now lives in ../bootstrap.mjs, the
 * host-pinned entrypoint, which authenticates the corpus BEFORE importing
 * this file. This file only spawns the scored test files. Running it
 * directly still works, but the supported (reviewed) path is
 * `node bootstrap.mjs test`.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const testFiles = [
  "canonical.test.js",
  "schemas.test.js",
  "resolver.test.js",
  "sales.test.js",
  "budgets.test.js",
  "determinism.test.js",
  "injection.test.js",
  "execution-addendum.test.js",
  "watchdog.test.js",
  "trust.test.js",
];

let failed = 0;
for (const f of testFiles) {
  const r = spawnSync(process.execPath, ["--test", join(ROOT, "tests", f)], { stdio: "inherit", env: process.env });
  if (r.status !== 0) { console.error(`FAIL: ${f} (exit ${r.status})`); failed++; }
}
process.exit(failed ? 1 : 0);
