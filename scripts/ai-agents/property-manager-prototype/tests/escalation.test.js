/**
 * escalation.test.js — touchpoint escalation precision/recall, derived
 * independently from the fixture seeds (not from the battery expectations).
 *
 * Recall: every seeded tenant/money/legal touchpoint on an advisory case
 * must be covered by at least one escalation trigger.
 * Precision: every trigger's touchpoint must be a seeded touchpoint.
 * Document-only inquiry is the positive trigger-free exception.
 * execution_authorized_for_agent is always false; every trigger carries a
 * non-empty required_authorizer and executor split.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../src/index.js";
import { ROOT, loadStore, baseContext, taskFor } from "./testutil.js";

const store = loadStore();
const battery = JSON.parse(readFileSync(join(ROOT, "corpus", "battery.json"), "utf8"));

const ADVISORY = battery.filter((c) => c.category !== "injection" && (c.expected.status === "PROPOSED" || c.expected.status === "BLOCKED"));
// pm-doc-20 (after-hours config conflict) blocks at resolution before advisory
// assembly: urgency cannot be determined, so no triggers are emitted and none
// are guessed. It is excluded from recall like REFUSED cases are.
const RECALL_CASES = ADVISORY.filter((c) => c.case_id !== "pm-doc-20");

test("touchpoint escalation recall is 100% across advisory cases", () => {
  const missing = [];
  for (const bc of RECALL_CASES) {
    const fixtureId = bc.task.case_ref.case_id;
    const c = store.cases.find((x) => x.case_id === fixtureId);
    const r = run(bc.task, baseContext());
    const covered = new Set(r.escalation_triggers.map((t) => t.touchpoint));
    for (const tp of new Set(c.seeded_touchpoints)) {
      if (!covered.has(tp)) missing.push(`${bc.case_id}:${tp}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("touchpoint escalation precision is 100%: no trigger without a seeded touchpoint", () => {
  const extra = [];
  for (const bc of RECALL_CASES) {
    const fixtureId = bc.task.case_ref.case_id;
    const c = store.cases.find((x) => x.case_id === fixtureId);
    const seeded = new Set(c.seeded_touchpoints);
    const r = run(bc.task, baseContext());
    for (const t of r.escalation_triggers) {
      if (!seeded.has(t.touchpoint)) extra.push(`${bc.case_id}:${t.touchpoint}`);
    }
  }
  assert.deepEqual(extra, []);
});

test("document-only inquiry is trigger-free", () => {
  const pure = battery.filter((c) => /^pm-doc-0[1-8]$/.test(c.case_id));
  assert.equal(pure.length, 8);
  for (const bc of pure) {
    const r = run(bc.task, baseContext());
    assert.equal(r.status, "PROPOSED");
    assert.equal(r.escalation_triggers.length, 0, bc.case_id);
    assert.ok(r.recommendations.length > 0);
  }
});

test("no trigger ever authorizes agent execution; authorizer/executor split is always present", () => {
  for (const bc of RECALL_CASES) {
    const r = run(bc.task, baseContext());
    for (const t of r.escalation_triggers) {
      assert.equal(t.execution_authorized_for_agent, false, `${bc.case_id}/${t.escalation_id}`);
      assert.ok(typeof t.required_authorizer === "string" && t.required_authorizer.length > 0);
      assert.ok(typeof t.executor === "string" && t.executor.length > 0);
      assert.notEqual(t.required_authorizer, t.executor);
    }
  }
});

test("urgency follows the fixture table: emergency -> IMMEDIATE, 48h deadline -> HIGH", () => {
  const r1 = run(taskFor(store, "SYN-CASE-003"), baseContext());
  assert.ok(r1.escalation_triggers.every((t) => t.urgency === "IMMEDIATE"), "emergency_safety seed");
  const r2 = run(taskFor(store, "SYN-CASE-006"), baseContext());
  assert.ok(r2.escalation_triggers.every((t) => t.urgency === "HIGH"), "urgent_maintenance seed");
  const r3 = run(taskFor(store, "SYN-CASE-001"), baseContext());
  assert.ok(r3.escalation_triggers.every((t) => t.urgency === "ROUTINE"), "plain routine seed");
});

test("large spend bumps routine urgency to HIGH but never erases escalation", () => {
  // SYN-CASE-007: maintenance, amount 2500, routine seed -> HIGH
  const r = run(taskFor(store, "SYN-CASE-007"), baseContext());
  assert.equal(r.status, "PROPOSED");
  assert.ok(r.escalation_triggers.length > 0);
  assert.ok(r.escalation_triggers.every((t) => t.urgency === "HIGH"));
});

test("$0 amounts still escalate touchpoints", () => {
  // SYN-CASE-001: amount 0 with money touchpoint
  const r = run(taskFor(store, "SYN-CASE-001"), baseContext());
  assert.ok(r.escalation_triggers.some((t) => t.touchpoint === "money"));
});
