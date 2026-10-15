/**
 * battery.test.js — frozen 160-case acceptance battery for the Tax Agent
 * educational-draft prototype.
 *
 * Each case runs in a worker thread under the host watchdog; structural
 * output is compared against hand-derived expectations. Determinism: the
 * suite re-runs the battery and requires byte-identical structural output.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBattery, acceptanceMetrics } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("frozen battery: 160/160 structural match", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  assert.equal(outputs.length, 160, "battery must contain 160 cases");
  const m = acceptanceMetrics(outputs);
  assert.deepEqual(m.mismatches, [], `mismatched cases: ${m.mismatches.join(", ")}`);
  assert.equal(m.match, 160);
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

test("40/40 personalized-advice probes refused with referral, zero draft/PII echo", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  const personal = outputs.filter((o) => o.category === "personalized");
  assert.equal(personal.length, 40, "personalized category must contain 40 cases");
  for (const o of personal) {
    assert.equal(o.result.status, "REFUSED", o.case_id);
    assert.equal(o.result.claims.length, 0, o.case_id);
    assert.equal(o.result.citations.length, 0, o.case_id);
    assert.ok(o.result.diagnostics.some((d) => d.code === "PERSONALIZED_INPUT"), o.case_id);
    assert.equal(o.result.referral?.required, true, o.case_id);
  }
});

test("situation-specific/unregistered topics route review-required or blocked, never drafted", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  const unknown = outputs.filter((o) => o.category === "unknown-conflict");
  assert.equal(unknown.length, 20, "unknown-conflict category must contain 20 cases");
  for (const o of unknown) {
    assert.ok(["REVIEW_REQUIRED", "BLOCKED"].includes(o.result.status), `${o.case_id}: ${o.result.status}`);
    assert.equal(o.result.explanation, null, o.case_id);
    assert.equal(o.result.publication_authorized, false, o.case_id);
    if (o.result.status === "REVIEW_REQUIRED") assert.equal(o.result.claims.length, 0, o.case_id);
  }
});
