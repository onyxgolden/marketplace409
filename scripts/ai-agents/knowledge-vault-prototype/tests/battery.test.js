/**
 * battery.test.js — frozen 120-case acceptance battery for the
 * knowledge-vault prototype.
 *
 * Each case runs in a worker thread under the host watchdog; structural
 * output is compared against the hand-derived expectations. Any
 * mismatch fails the run. Determinism: the suite re-runs the battery and
 * requires byte-identical structural output across runs.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBattery, acceptanceMetrics } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("frozen battery: 120/120 structural match", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  assert.equal(outputs.length, 120, "battery must contain 120 cases");
  const m = acceptanceMetrics(outputs);
  assert.deepEqual(m.mismatches, [], `mismatched cases: ${m.mismatches.join(", ")}`);
  assert.equal(m.match, 120);
});

test("battery is deterministic across runs", async () => {
  const a = await runBattery(ROOT, { timeoutMs: 5000 });
  const b = await runBattery(ROOT, { timeoutMs: 5000 });
  const sa = JSON.stringify(a.outputs.map((o) => o.structural));
  const sb = JSON.stringify(b.outputs.map((o) => o.structural));
  assert.equal(sa, sb, "structural output must be byte-identical across runs");
});

test("every battery case carries a hand-derived expectation", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  for (const o of outputs) {
    assert.ok(o.expected && typeof o.expected.status === "string", `${o.case_id}: missing expectation`);
    assert.ok(Array.isArray(o.expected.claims), `${o.case_id}: missing claims expectation`);
  }
});
