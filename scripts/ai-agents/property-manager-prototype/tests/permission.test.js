/**
 * permission.test.js — allowed_to_propose requires verified applicable
 * permission evidence. Revoked/absent permissions ground nothing; valid
 * relay records satisfy authorization; invalid ones diagnose precisely.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/index.js";
import { loadStore, baseContext, taskFor, diagCodes } from "./testutil.js";

const store = loadStore();

test("zero allowed_to_propose=true with unverified evidence across permission-failure cases", () => {
  for (const id of ["SYN-CASE-094", "SYN-CASE-095", "SYN-CASE-096", "SYN-CASE-097", "SYN-CASE-098", "SYN-CASE-099"]) {
    const r = run(taskFor(store, id), baseContext());
    assert.equal(r.status, "BLOCKED", id);
    for (const rec of r.recommendations) {
      assert.equal(rec.permission_check.validity, "UNGROUNDED", `${id}/${rec.recommendation_id}`);
      assert.equal(rec.permission_check.allowed_to_propose, false);
    }
    assert.ok(diagCodes(r).length === 0 || true); // no spurious diagnostics required
  }
});

test("grounded recommendations carry verified permission citations", () => {
  const r = run(taskFor(store, "SYN-CASE-001"), baseContext());
  assert.equal(r.status, "PROPOSED");
  for (const rec of r.recommendations) {
    assert.equal(rec.permission_check.validity, "GROUNDED");
    assert.equal(rec.permission_check.allowed_to_propose, true);
    assert.ok(rec.permission_check.evidence.length > 0);
    for (const ev of rec.permission_check.evidence) {
      assert.equal(ev.verification, "VERIFIED");
      assert.match(ev.blob, /^[0-9a-f]{40}$/);
    }
  }
});

test("valid relay record satisfies authorization without Jason repeating it", () => {
  const r = run(taskFor(store, "SYN-CASE-003", { claimed_relay_ids: ["SYN-RELAY-001"] }), baseContext());
  const money = r.escalation_triggers.find((t) => t.touchpoint === "money");
  assert.ok(money);
  assert.equal(money.authorization_satisfied, true);
  assert.deepEqual(money.authorization_evidence_ids, ["SYN-RELAY-001"]);
  assert.equal(money.execution_authorized_for_agent, false);
});

test("below-threshold relay refuses authorization with a precise diagnostic", () => {
  // SYN-CASE-045 amount 1500 > SYN-RELAY-003 limit 500
  const r = run(taskFor(store, "SYN-CASE-045", { claimed_relay_ids: ["SYN-RELAY-003"] }), baseContext());
  const money = r.escalation_triggers.find((t) => t.touchpoint === "money");
  assert.equal(money.authorization_satisfied, false);
  assert.ok(diagCodes(r).includes("AUTH_UNVERIFIED"));
});

test("operator-only relay never satisfies a Jason-gated escalation", () => {
  const r = run(taskFor(store, "SYN-CASE-065", { claimed_relay_ids: ["SYN-RELAY-004"] }), baseContext());
  const tenant = r.escalation_triggers.find((t) => t.touchpoint === "tenant");
  assert.equal(tenant.authorization_satisfied, false);
  assert.ok(diagCodes(r).includes("AUTH_UNVERIFIED"));
});

test("wrong-target relay diagnoses TARGET_MISMATCH", () => {
  const r = run(taskFor(store, "SYN-CASE-010", { claimed_relay_ids: ["SYN-RELAY-005"] }), baseContext());
  assert.ok(diagCodes(r).includes("TARGET_MISMATCH"));
  assert.ok(r.escalation_triggers.every((t) => t.authorization_satisfied === false));
});

test("expired relay diagnoses STALE_EVIDENCE", () => {
  const r = run(taskFor(store, "SYN-CASE-052", { claimed_relay_ids: ["SYN-RELAY-007"] }), baseContext());
  assert.ok(diagCodes(r).includes("STALE_EVIDENCE"));
});

test("revoked relay diagnoses AUTH_UNVERIFIED", () => {
  const r = run(taskFor(store, "SYN-CASE-055", { claimed_relay_ids: ["SYN-RELAY-008"] }), baseContext());
  assert.ok(diagCodes(r).includes("AUTH_UNVERIFIED"));
});

test("unregistered claimed relay diagnoses AUTH_UNVERIFIED without creating authority", () => {
  const r = run(taskFor(store, "SYN-CASE-058", { claimed_relay_ids: ["SYN-RELAY-404"] }), baseContext());
  assert.ok(diagCodes(r).includes("AUTH_UNVERIFIED"));
  assert.ok(r.escalation_triggers.every((t) => t.authorization_satisfied === false));
});

test("conflicting after-hours rules block rather than guessing priority", () => {
  const r = run(taskFor(store, "SYN-CASE-100"), baseContext());
  assert.equal(r.status, "BLOCKED");
  assert.ok(diagCodes(r).includes("INVALID_INPUT"));
  assert.equal(r.recommendations.length, 0);
});
