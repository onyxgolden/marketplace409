#!/usr/bin/env node
/**
 * measure-latency.js — runs every battery case through src/index.js and
 * reports per-case timing. Exits nonzero if any case exceeds the 5-second
 * harness watchdog. Manual/observability use only; not part of scoring.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));

const WATCHDOG_MS = 5000;
let max = 0;
let total = 0;
let worst = null;
for (const c of battery.cases) {
  const t0 = process.hrtime.bigint();
  run(c.input.task, {
    clock: c.input.clock,
    fixtureStore: store,
    approvedRepos: ["forge-ai-drop-fixtures"],
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  total += ms;
  if (ms > max) {
    max = ms;
    worst = c.case_id;
  }
}
console.log(`cases: ${battery.cases.length}, mean: ${(total / battery.cases.length).toFixed(2)}ms, max: ${max.toFixed(2)}ms (${worst})`);
if (max > WATCHDOG_MS) {
  console.error(`watchdog exceeded: ${worst} took ${max.toFixed(2)}ms > ${WATCHDOG_MS}ms`);
  process.exit(1);
}
