/**
 * battery.test.js — the official 120-case acceptance battery.
 *
 * Runs every frozen case through the agent under the host watchdog and
 * requires 120/120 structural match against the hand-derived expectations,
 * plus the zero gates: no UNGROUNDED ALLOWED, no incomplete ALLOWED, no
 * unregistered-policy ALLOWED, no invented approvers, advisory never
 * accepted as authority.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBattery, acceptanceMetrics, verifyManifest } from "./harness.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("battery: 120/120 expected classification, validity and requirement/routing match", async () => {
  await verifyManifest(ROOT);
  const { outputs, corpusDigest } = await runBattery(ROOT, { timeoutMs: 5000 });
  const m = acceptanceMetrics(outputs);
  assert.equal(m.total, 120, `battery must hold 120 cases (got ${m.total})`);
  assert.deepEqual(m.mismatches, [], `all cases must match: ${m.mismatches.join(", ")}`);
  assert.equal(m.match, 120);
  for (const [cls, s] of Object.entries(m.perClass)) {
    assert.equal(s.match, s.total, `class ${cls} must fully match`);
  }
  assert.match(corpusDigest, /^[0-9a-f]{64}$/);
});

test("zero gates: no ungrounded/incomplete ALLOWED, no unregistered-policy ALLOWED", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  for (const o of outputs) {
    const s = o.structural;
    if (s.classification === "ALLOWED") {
      assert.equal(s.validity, "GROUNDED", `${o.case_id}: ALLOWED must be GROUNDED`);
      assert.equal(s.complete, true, `${o.case_id}: ALLOWED must be complete`);
      assert.equal(o.result.authorization_granted, false, `${o.case_id}: advisory never grants authorization`);
      assert.equal(o.result.execution_performed, false, `${o.case_id}: advisory never performs execution`);
      for (const c of s.cited_rule_ids) {
        assert.ok(!c.includes("unregistered"), `${o.case_id}: unregistered policy must never ground ALLOWED`);
      }
    }
    // REFUSED never carries ALLOWED.
    if (s.status === "REFUSED") {
      assert.notEqual(s.classification, "ALLOWED", `${o.case_id}: REFUSED must never be ALLOWED`);
    }
  }
});

test("zero invented approvers: responsible actors are registered principals only", async () => {
  const { outputs } = await runBattery(ROOT, { timeoutMs: 5000 });
  const known = new Set(["principal:jason", "principal:muse", "principal:chatgpt", "principal:claude"]);
  for (const o of outputs) {
    const r = o.structural.responsible_actor;
    if (r !== null) assert.ok(known.has(r), `${o.case_id}: invented approver '${r}'`);
    for (const req of (o.result.requirements?.outstanding ?? [])) {
      if (req.responsible_actor_ref !== null) {
        assert.ok(known.has(req.responsible_actor_ref), `${o.case_id}: invented requirement approver`);
      }
    }
  }
});
