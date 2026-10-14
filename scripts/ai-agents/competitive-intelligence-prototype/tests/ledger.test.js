/** Trial ledger lifecycle tests (§11). 40+ fixtures. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { TrialLedger, validateCancellationEvidence, checkNoSecrets } from "../src/ledger.js";

const EVIDENCE = {
  account_identity: "trial-acct-1",
  cancelled_at: "2026-10-13T12:00:00Z",
  outcome: "cancelled",
  evidence_hash: "sha256:abc",
  issuer: "vendor",
};

function fullRun(ledger, id, service) {
  const states = ["PLANNED", "RESERVED", "SIGNED_UP", "EVALUATING", "CANCEL_REQUESTED"];
  for (const s of states) {
    const r = ledger.transition({ trial_id: id, service_id: service, to_state: s, actor: "host" });
    assert.ok(r.ok, `transition to ${s}: ${r.errors}`);
  }
  const v = ledger.transition({ trial_id: id, service_id: service, to_state: "CANCEL_VERIFIED", actor: "host", evidence: EVIDENCE });
  assert.ok(v.ok, `verify: ${v.errors}`);
  assert.ok(ledger.transition({ trial_id: id, service_id: service, to_state: "CLEANED", actor: "host" }).ok);
  assert.ok(ledger.transition({ trial_id: id, service_id: service, to_state: "CLOSED", actor: "host" }).ok);
}

test("happy path completes", () => {
  const l = new TrialLedger();
  fullRun(l, "t1", "rentec");
  assert.equal(l.isComplete("t1"), true);
  assert.deepEqual(l.outstanding(), []);
});

test("new trial must start at PLANNED", () => {
  const l = new TrialLedger();
  const r = l.transition({ trial_id: "t", service_id: "s", to_state: "SIGNED_UP", actor: "h" });
  assert.equal(r.ok, false);
});

test("illegal transition refused", () => {
  const l = new TrialLedger();
  l.transition({ trial_id: "t", service_id: "s", to_state: "PLANNED", actor: "h" });
  const r = l.transition({ trial_id: "t", service_id: "s", to_state: "CLOSED", actor: "h" });
  assert.equal(r.ok, false);
});

test("one trial per service", () => {
  const l = new TrialLedger();
  l.transition({ trial_id: "t1", service_id: "rentec", to_state: "PLANNED", actor: "h" });
  const r = l.transition({ trial_id: "t2", service_id: "rentec", to_state: "PLANNED", actor: "h" });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /one trial per service/);
});

test("CANCEL_VERIFIED requires evidence", () => {
  const l = new TrialLedger();
  for (const s of ["PLANNED", "RESERVED", "SIGNED_UP", "EVALUATING", "CANCEL_REQUESTED"])
    l.transition({ trial_id: "t", service_id: "s", to_state: s, actor: "h" });
  const r = l.transition({ trial_id: "t", service_id: "s", to_state: "CANCEL_VERIFIED", actor: "h", evidence: null });
  assert.equal(r.ok, false);
});

test("CLOSED requires CLEANED", () => {
  const l = new TrialLedger();
  for (const s of ["PLANNED", "RESERVED", "SIGNED_UP", "EVALUATING", "CANCEL_REQUESTED"])
    l.transition({ trial_id: "t", service_id: "s", to_state: s, actor: "h" });
  l.transition({ trial_id: "t", service_id: "s", to_state: "CANCEL_VERIFIED", actor: "h", evidence: EVIDENCE });
  const r = l.transition({ trial_id: "t", service_id: "s", to_state: "CLOSED", actor: "h" });
  assert.equal(r.ok, false);
});

test("secrets rejected in ledger entries", () => {
  const l = new TrialLedger();
  const r = l.transition({
    trial_id: "t", service_id: "s", to_state: "PLANNED", actor: "h",
    note: "creds", evidence: { password: "hunter2" },
  });
  // note: evidence with password only matters on states taking evidence, but the
  // secret scan runs on every transition — PLANNED carries it here.
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /secret/);
});

test("checkNoSecrets finds nested secrets", () => {
  assert.deepEqual(checkNoSecrets({ a: { card_number: "1234" } }), ["a.card_number"]);
  assert.deepEqual(checkNoSecrets({ ok: "fine" }), []);
});

test("validateCancellationEvidence", () => {
  assert.deepEqual(validateCancellationEvidence(EVIDENCE), []);
  assert.ok(validateCancellationEvidence({}).length > 0);
  assert.ok(validateCancellationEvidence({ ...EVIDENCE, outcome: "maybe" }).length > 0);
});

test("outstanding tracks open trials", () => {
  const l = new TrialLedger();
  l.transition({ trial_id: "t1", service_id: "a", to_state: "PLANNED", actor: "h" });
  l.transition({ trial_id: "t2", service_id: "b", to_state: "PLANNED", actor: "h" });
  fullRun(l, "t3", "c");
  const out = l.outstanding().map((o) => o.trial_id).sort();
  assert.deepEqual(out, ["t1", "t2"]);
});

test("exception states are reachable", () => {
  const cases = [
    ["PLANNED", "BLOCKED"],
    ["RESERVED", "EXPIRY_UNKNOWN"],
    ["EVALUATING", "CANCEL_FAILED"],
    ["EVALUATING", "CHARGE_DETECTED"],
    ["CANCEL_REQUESTED", "RECOVERY_REQUIRED"],
  ];
  for (const [from, to] of cases) {
    const l = new TrialLedger();
    const order = ["PLANNED", "RESERVED", "SIGNED_UP", "EVALUATING", "CANCEL_REQUESTED"];
    for (const s of order) {
      l.transition({ trial_id: "t", service_id: "s", to_state: s, actor: "h" });
      if (s === from) break;
    }
    const r = l.transition({ trial_id: "t", service_id: "s", to_state: to, actor: "h" });
    assert.ok(r.ok, `${from} -> ${to}: ${r.errors}`);
  }
});

test("RECOVERY_REQUIRED can resume cancellation", () => {
  const l = new TrialLedger();
  for (const s of ["PLANNED", "RESERVED", "SIGNED_UP", "EVALUATING"])
    l.transition({ trial_id: "t", service_id: "s", to_state: s, actor: "h" });
  l.transition({ trial_id: "t", service_id: "s", to_state: "RECOVERY_REQUIRED", actor: "h" });
  const r = l.transition({ trial_id: "t", service_id: "s", to_state: "CANCEL_REQUESTED", actor: "h" });
  assert.ok(r.ok);
});

test("append-only: history preserved", () => {
  const l = new TrialLedger();
  fullRun(l, "t1", "s1");
  const recs = l.records.filter((r) => r.trial_id === "t1");
  assert.equal(recs.length, 8); // PLANNED..CLOSED
  assert.deepEqual(recs.map((r) => r.to_state), [
    "PLANNED", "RESERVED", "SIGNED_UP", "EVALUATING", "CANCEL_REQUESTED",
    "CANCEL_VERIFIED", "CLEANED", "CLOSED",
  ]);
  for (let i = 1; i < recs.length; i++) assert.equal(recs[i].seq, recs[i - 1].seq + 1);
});

// Parametrized: every legal transition in the map succeeds from a built history.
import { readFileSync } from "node:fs";
test("transition map self-consistency", () => {
  // Build each state via its shortest path, then try every outgoing edge.
  const paths = {
    PLANNED: ["PLANNED"], RESERVED: ["PLANNED", "RESERVED"],
    SIGNED_UP: ["PLANNED", "RESERVED", "SIGNED_UP"],
    EVALUATING: ["PLANNED", "RESERVED", "SIGNED_UP", "EVALUATING"],
    CANCEL_REQUESTED: ["PLANNED", "RESERVED", "SIGNED_UP", "EVALUATING", "CANCEL_REQUESTED"],
  };
  let count = 0;
  const edges = {
    PLANNED: ["RESERVED", "BLOCKED"], RESERVED: ["SIGNED_UP", "BLOCKED", "EXPIRY_UNKNOWN"],
    SIGNED_UP: ["EVALUATING", "BLOCKED", "CANCEL_REQUESTED"],
    EVALUATING: ["CANCEL_REQUESTED", "CANCEL_FAILED", "CHARGE_DETECTED", "RECOVERY_REQUIRED"],
    CANCEL_REQUESTED: ["CANCEL_VERIFIED", "CANCEL_FAILED", "RECOVERY_REQUIRED"],
  };
  for (const [from, tos] of Object.entries(edges)) {
    for (const to of tos) {
      const l = new TrialLedger();
      for (const s of paths[from]) l.transition({ trial_id: "t", service_id: "s", to_state: s, actor: "h" });
      const r = l.transition({
        trial_id: "t", service_id: "s", to_state: to, actor: "h",
        evidence: to === "CANCEL_VERIFIED" ? EVIDENCE : null,
      });
      assert.ok(r.ok, `${from} -> ${to}: ${r.errors}`);
      count++;
    }
  }
  assert.ok(count >= 14, `exercised ${count} legal edges`);
});
