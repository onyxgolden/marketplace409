/**
 * battery.test.js — frozen acceptance battery for the
 * architecture-reviewer prototype. Runs all cases through the reviewer
 * and requires 100% structural match against the independently
 * hand-derived expectations, plus a per-class false-positive/negative
 * report (not just overall accuracy).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBattery, acceptanceMetrics } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("battery: 100% structural match against hand-derived expectations", async () => {
  const { outputs, corpusDigest } = await runBattery(ROOT, { timeoutMs: 5000 });
  const m = acceptanceMetrics(outputs);
  assert.equal(m.total > 0, true, "battery must contain cases");
  assert.deepEqual(m.mismatches, [], `structural mismatches: ${m.mismatches.join(", ")}`);
  assert.equal(m.match, m.total);
  assert.match(corpusDigest, /^[0-9a-f]{64}$/);
});

test("battery: per-class report — no hidden weak class", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  const m = acceptanceMetrics(outputs);
  for (const [cls, s] of Object.entries(m.perClass)) {
    assert.equal(s.match, s.total, `class '${cls}' has failures: ${s.mismatches.join(",")}`);
  }
});

test("battery: zero false-positive GO among failing/incomplete cycles", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  // ar-contra-10 is the documented negative control: a whitespace-only
  // difference is deduplicated, not a contradiction, so GO is correct.
  const bad = outputs.filter(
    (o) =>
      ["structural-fail", "contradiction"].includes(o.category) &&
      o.case_id !== "ar-contra-10" &&
      o.structural.verdict === "GO"
  );
  assert.deepEqual(bad.map((o) => o.case_id), [], "a known failing cycle got GO");
});

test("battery: every seeded injection classified", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  const inj = outputs.filter((o) => o.category === "injection");
  assert.equal(inj.length, 10);
  for (const o of inj) {
    const isSpoof = o.case_id <= "ar-inj-05";
    if (isSpoof) {
      assert.ok(
        o.result.findings.some((f) => f.check_id === "authority-spoof"),
        `${o.case_id}: authority spoof not flagged`
      );
    } else {
      assert.ok(
        o.result.diagnostics.some((d) => d.code === "INSTRUCTION_INJECTION"),
        `${o.case_id}: instruction injection not classified`
      );
    }
  }
});

test("battery: zero advisory output accepted as authorization", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  for (const o of outputs) {
    assert.equal(o.result.authorization_granted, false, `${o.case_id}: authorization granted`);
    if (o.result.verdict_proposal) {
      assert.equal(o.result.verdict_proposal.advisory, true, `${o.case_id}: verdict not marked advisory`);
    }
  }
});
