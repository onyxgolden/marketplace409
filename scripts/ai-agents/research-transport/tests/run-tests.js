#!/usr/bin/env node
/**
 * run-tests.js — P1-B test entry: runs the node:test suites in order.
 * Pure Node 24, zero dependencies. The suites import the P1-A contract
 * (read-only) and exercise the adapter against an in-memory double of
 * the private store's publish/decision contract — no filesystem, no
 * network, no scheduler surface is ever touched.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const testFiles = [
  "serializer.test.js",
  "decision.test.js",
  "transport.test.js",
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
