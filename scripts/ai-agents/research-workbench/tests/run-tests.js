#!/usr/bin/env node
/**
 * run-tests.js — P1-C test entry: runs the node:test suites in order.
 * Pure Node 24, zero dependencies. The render/jobs/host suites run
 * against an in-memory double of the private store contract; the e2e
 * suite boots the real server against the real private store in a
 * temp state directory (it skips with a printed reason when the
 * forge-ai-drop checkout is absent).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const testFiles = [
  "render.test.js",
  "jobs.test.js",
  "host.test.js",
  "e2e.test.js",
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
