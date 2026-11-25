#!/usr/bin/env node
/**
 * run-tests.js — plain `node --test` entrypoint for the budget-sentinel
 * contract suite.
 *
 * No authenticated-manifest trust bootstrap here, deliberately: this pack
 * has no corpus, no fixtures on disk and no scored agent code — only the
 * helpers and the contract tests, which import the Document Agent
 * prototype's own (already manifest-authenticated) harness. Per-agent
 * adoption re-authenticates the COPIED tests under the adopting agent's
 * own manifest (condition 5); this pack never grants that authority.
 *
 * Usage: node scripts/ai-agents/budget-sentinels/tests/run-tests.js
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
  console.error("budget-sentinels: no test entrypoints found");
  process.exit(3);
}
const child = spawnSync(process.execPath, ["--test", ...testFiles], { env: process.env, stdio: "inherit" });
process.exit(child.status ?? 3);
