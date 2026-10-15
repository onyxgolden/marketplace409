/**
 * determinism.test.js — repeat runs are byte-identical; irrelevant store
 * ordering preserves semantics and hashes.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBattery, sortKeys } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("three official battery runs are byte-identical under fixed context", async () => {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
    runs.push(outputs.map((o) => o.canonical));
  }
  assert.deepEqual(runs[1], runs[0], "run 2 must be byte-identical to run 1");
  assert.deepEqual(runs[2], runs[0], "run 3 must be byte-identical to run 1");
});

test("shuffled irrelevant store ordering preserves classification semantics", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  const a17 = outputs.find((o) => o.case_id === "gov-a-17");
  const a05 = outputs.find((o) => o.case_id === "gov-a-05");
  assert.ok(a17, "gov-a-17 (reordered stores) must exist");
  assert.equal(JSON.stringify(sortKeys(a17.structural)), JSON.stringify(sortKeys(a05.structural)), "reordered stores must not change the decision");
});
