#!/usr/bin/env node
/**
 * run-tests.js — `npm test` entrypoint: builtins-only trust authentication
 * BEFORE any scored test/helper is imported.
 *
 * The separately trusted approval root is a host input (FM_APPROVED_ROOT
 * env) — never read from the candidate tree. The full corpus digest,
 * covering EVERY pinned file including the scored tests themselves, is
 * recomputed with node:fs / node:crypto ONLY and authenticated against
 * that root BEFORE the real `node --test` entrypoints are spawned.
 *
 * Refuse (exit 3) on any mismatch: no test file is imported, no helper
 * executes, no canary can fire. A tampered helper/source/expectation —
 * even with a re-pinned candidate manifest — fails here because the
 * digest no longer equals the ORIGINAL host-fixed root. Attack tests must
 * keep the original FM_APPROVED_ROOT fixed; they may not switch to the
 * candidate's newly edited npm root.
 *
 * This file imports node builtins only. It never imports scored code.
 */

import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { verifyCorpus } from "./verify-corpus.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 1. Separately trusted approval root: host input, never the candidate tree.
const APPROVED_ROOT = process.env.FM_APPROVED_ROOT;

// 2. Full pre-import verification with node builtins only.
const v = verifyCorpus(ROOT, APPROVED_ROOT);
if (!v.ok) {
  console.error(`bootstrap: trust failure — ${v.reason}`);
  process.exit(3);
}

// 3. Only now spawn the real node --test on the actual scored entrypoints.
const testFiles = readdirSync(join(ROOT, "tests"))
  .filter((f) => f.endsWith(".test.js"))
  .sort()
  .map((f) => join(ROOT, "tests", f));
if (testFiles.length === 0) {
  console.error("bootstrap: no scored test entrypoints found");
  process.exit(3);
}
const child = spawnSync(process.execPath, ["--test", ...testFiles], {
  env: process.env,
  stdio: "inherit",
});
process.exit(child.status ?? 3);
