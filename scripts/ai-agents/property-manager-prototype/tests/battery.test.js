/**
 * battery.test.js — the scored 120-case acceptance battery.
 *
 * Runs every frozen case through the agent in a worker under the host
 * watchdog and requires 100% structural match against the hand-derived
 * expectations, per class and overall.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { runBattery, acceptanceMetrics, verifyManifest } from "./harness.js";
import { ROOT } from "./testutil.js";

test("battery: 120 cases, 100% structural match against hand-derived expectations", async () => {
  const { outputs, corpusDigest } = await runBattery(ROOT, { timeoutMs: 5000 });
  assert.match(corpusDigest, /^[0-9a-f]{64}$/);
  const m = acceptanceMetrics(outputs);
  assert.equal(m.total, 120, `expected 120 cases, got ${m.total}`);
  assert.deepEqual(m.mismatches, [], `mismatched cases: ${m.mismatches.join(", ")}`);
  assert.equal(m.match, 120);
  for (const [cls, s] of Object.entries(m.perClass)) {
    assert.equal(s.match, s.total, `class ${cls}: ${s.match}/${s.total}`);
  }
});

test("battery: corpus digest is stable across verifications", async () => {
  const a = await verifyManifest(ROOT);
  const b = await verifyManifest(ROOT);
  assert.equal(a.corpusDigest, b.corpusDigest);
});
