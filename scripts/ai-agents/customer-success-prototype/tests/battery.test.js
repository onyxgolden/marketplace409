/**
 * battery.test.js — runs the full frozen corpus inside the node:test
 * suite itself (in addition to `npm run battery`'s standalone report),
 * so a single `npm test` run proves both the unit tests and the full
 * battery are green.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBattery, acceptanceMetrics } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("full battery: every case structurally matches its independently authored expectation", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  const m = acceptanceMetrics(outputs);
  assert.equal(m.match, m.total, `mismatches: ${m.mismatches.join(", ")}`);
  assert.ok(m.total >= 120, `expected at least 120 battery cases, found ${m.total}`);
});

test("battery category minimums are met", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  const m = acceptanceMetrics(outputs);
  const MIN = { nominal_boundary: 40, contradiction_incomplete_duplicate: 30, injection_prohibited: 20, schema_provenance_permission: 20, budget_replay_mutation: 10 };
  for (const [cat, min] of Object.entries(MIN)) {
    assert.ok(m.perClass[cat], `missing category ${cat}`);
    assert.ok(m.perClass[cat].total >= min, `${cat}: expected >= ${min}, found ${m.perClass[cat].total}`);
  }
});

test("no case exceeds the 5-second host watchdog", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  const slow = outputs.filter((o) => o.elapsedMs > 5000);
  assert.equal(slow.length, 0, `slow cases: ${slow.map((o) => o.case_id).join(", ")}`);
});
