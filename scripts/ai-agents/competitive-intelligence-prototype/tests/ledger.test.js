/** Trial ledger lifecycle tests (§11). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TrialLedger,
  createLedgerStore,
  validateCancellationEvidence,
  validateCleanupEvidence,
  checkNoSecrets,
} from "../src/ledger.js";

const cancelEvidence = (service) => ({
  account_identity: "trial-acct-1",
  service_id: service,
  cancelled_at: "2026-10-13T12:00:00Z",
  outcome: "cancelled",
  evidence_hash: "sha256:def456",
  issuer: "vendor",
});

const cleanupEvidence = (service) => ({
  account_identity: "trial-acct-1",
  service_id: service,
  cleanup_receipt: "cleanup-rcpt-1",
  cleaned_at: "2026-10-13T13:00:00Z",
});

const signupEvidence = () => ({ account_identity: "trial-acct-1" });

function toSignedUp(ledger, id, service) {
  for (const s of ["PLANNED", "RESERVED"]) {
    const r = ledger.transition({ trial_id: id, service_id: service, to_state: s, actor: "host" });
    assert.ok(r.ok, `to ${s}: ${r.errors}`);
  }
  const r = ledger.transition({
    trial_id: id, service_id: service, to_state: "SIGNED_UP", actor: "host",
    evidence: signupEvidence(), evaluation_id: "e1",
  });
  assert.ok(r.ok, `to SIGNED_UP: ${r.errors}`);
}

function fullRun(ledger, id, service) {
  toSignedUp(ledger, id, service);
  for (const s of ["EVALUATING", "CANCEL_REQUESTED"]) {
    const r = ledger.transition({ trial_id: id, service_id: service, to_state: s, actor: "host" });
    assert.ok(r.ok, `to ${s}: ${r.errors}`);
  }
  const v = ledger.transition({
    trial_id: id, service_id: service, to_state: "CANCEL_VERIFIED",
    actor: "host", evidence: cancelEvidence(service),
  });
  assert.ok(v.ok, `verify: ${v.errors}`);
  const cl = ledger.transition({
    trial_id: id, service_id: service, to_state: "CLEANED",
    actor: "host", evidence: cleanupEvidence(service),
  });
  assert.ok(cl.ok, `clean: ${cl.errors}`);
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

test("SIGNED_UP requires account registration", () => {
  const l = new TrialLedger();
  l.transition({ trial_id: "t", service_id: "s", to_state: "PLANNED", actor: "h" });
  l.transition({ trial_id: "t", service_id: "s", to_state: "RESERVED", actor: "h" });
  const r = l.transition({ trial_id: "t", service_id: "s", to_state: "SIGNED_UP", actor: "h" });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /account_identity/);
});

test("one trial per service while outstanding", () => {
  const l = new TrialLedger();
  l.transition({ trial_id: "t1", service_id: "rentec", to_state: "PLANNED", actor: "h" });
  const r = l.transition({ trial_id: "t2", service_id: "rentec", to_state: "PLANNED", actor: "h" });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /outstanding trial/);
});

test("pre-account BLOCKED is a clean skip: service reusable", () => {
  const l = new TrialLedger();
  l.transition({ trial_id: "t1", service_id: "rentec", to_state: "PLANNED", actor: "h" });
  assert.ok(l.transition({ trial_id: "t1", service_id: "rentec", to_state: "BLOCKED", actor: "h" }).ok);
  assert.deepEqual(l.outstanding(), []);
  // A new trial for the same service is allowed after a clean skip.
  assert.ok(l.transition({ trial_id: "t2", service_id: "rentec", to_state: "PLANNED", actor: "h" }).ok);
});

test("post-account BLOCKED is illegal; BLOCKED_UNRESOLVED keeps obligations", () => {
  const l = new TrialLedger();
  toSignedUp(l, "t1", "rentec");
  const bad = l.transition({ trial_id: "t1", service_id: "rentec", to_state: "BLOCKED", actor: "h" });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(" "), /illegal transition/);
  const r = l.transition({ trial_id: "t1", service_id: "rentec", to_state: "BLOCKED_UNRESOLVED", actor: "h" });
  assert.ok(r.ok, r.errors);
  const out = l.outstanding();
  assert.equal(out.length, 1);
  assert.equal(out[0].obligation, "account_closure_required");
  // No new reservation while the block is unresolved.
  const r2 = l.transition({ trial_id: "t2", service_id: "rentec", to_state: "PLANNED", actor: "h" });
  assert.equal(r2.ok, false);
});

test("BLOCKED_UNRESOLVED resolves through the cancellation path", () => {
  const l = new TrialLedger();
  toSignedUp(l, "t1", "rentec");
  l.transition({ trial_id: "t1", service_id: "rentec", to_state: "BLOCKED_UNRESOLVED", actor: "h" });
  assert.ok(l.transition({ trial_id: "t1", service_id: "rentec", to_state: "CANCEL_REQUESTED", actor: "h" }).ok);
  const v = l.transition({
    trial_id: "t1", service_id: "rentec", to_state: "CANCEL_VERIFIED",
    actor: "h", evidence: cancelEvidence("rentec"),
  });
  assert.ok(v.ok, v.errors);
  assert.ok(l.transition({
    trial_id: "t1", service_id: "rentec", to_state: "CLEANED",
    actor: "h", evidence: cleanupEvidence("rentec"),
  }).ok);
  assert.ok(l.transition({ trial_id: "t1", service_id: "rentec", to_state: "CLOSED", actor: "h" }).ok);
  assert.deepEqual(l.outstanding(), []);
});

test("service identity is immutable", () => {
  const l = new TrialLedger();
  l.transition({ trial_id: "t", service_id: "a", to_state: "PLANNED", actor: "h" });
  const r = l.transition({ trial_id: "t", service_id: "b", to_state: "RESERVED", actor: "h" });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /immutable/);
});

test("CANCEL_VERIFIED requires evidence", () => {
  const l = new TrialLedger();
  toSignedUp(l, "t", "s");
  l.transition({ trial_id: "t", service_id: "s", to_state: "EVALUATING", actor: "h" });
  l.transition({ trial_id: "t", service_id: "s", to_state: "CANCEL_REQUESTED", actor: "h" });
  const r = l.transition({ trial_id: "t", service_id: "s", to_state: "CANCEL_VERIFIED", actor: "h", evidence: null });
  assert.equal(r.ok, false);
});

test("cancellation evidence must bind to the trial account/service", () => {
  const l = new TrialLedger();
  toSignedUp(l, "t", "s");
  l.transition({ trial_id: "t", service_id: "s", to_state: "EVALUATING", actor: "h" });
  l.transition({ trial_id: "t", service_id: "s", to_state: "CANCEL_REQUESTED", actor: "h" });
  const wrongAcct = l.transition({
    trial_id: "t", service_id: "s", to_state: "CANCEL_VERIFIED", actor: "h",
    evidence: { ...cancelEvidence("s"), account_identity: "someone-else" },
  });
  assert.equal(wrongAcct.ok, false);
  assert.match(wrongAcct.errors.join(" "), /account_identity/);
  const wrongSvc = l.transition({
    trial_id: "t", service_id: "s", to_state: "CANCEL_VERIFIED", actor: "h",
    evidence: { ...cancelEvidence("other-service") },
  });
  assert.equal(wrongSvc.ok, false);
  assert.match(wrongSvc.errors.join(" "), /service_id/);
});

test("CLEANED requires bound cleanup receipt", () => {
  const l = new TrialLedger();
  toSignedUp(l, "t", "s");
  l.transition({ trial_id: "t", service_id: "s", to_state: "EVALUATING", actor: "h" });
  l.transition({ trial_id: "t", service_id: "s", to_state: "CANCEL_REQUESTED", actor: "h" });
  l.transition({ trial_id: "t", service_id: "s", to_state: "CANCEL_VERIFIED", actor: "h", evidence: cancelEvidence("s") });
  const r = l.transition({ trial_id: "t", service_id: "s", to_state: "CLEANED", actor: "h", evidence: null });
  assert.equal(r.ok, false);
  const r2 = l.transition({
    trial_id: "t", service_id: "s", to_state: "CLEANED", actor: "h",
    evidence: { ...cleanupEvidence("s"), account_identity: "wrong" },
  });
  assert.equal(r2.ok, false);
});

test("CLOSED requires CLEANED", () => {
  const l = new TrialLedger();
  toSignedUp(l, "t", "s");
  l.transition({ trial_id: "t", service_id: "s", to_state: "EVALUATING", actor: "h" });
  l.transition({ trial_id: "t", service_id: "s", to_state: "CANCEL_REQUESTED", actor: "h" });
  l.transition({ trial_id: "t", service_id: "s", to_state: "CANCEL_VERIFIED", actor: "h", evidence: cancelEvidence("s") });
  const r = l.transition({ trial_id: "t", service_id: "s", to_state: "CLOSED", actor: "h" });
  assert.equal(r.ok, false);
});

test("secrets rejected in ledger entries", () => {
  const l = new TrialLedger();
  const r = l.transition({
    trial_id: "t", service_id: "s", to_state: "PLANNED", actor: "h",
    note: "creds", evidence: { password: "hunter2" },
  });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /secret/);
});

test("checkNoSecrets finds nested secrets", () => {
  assert.deepEqual(checkNoSecrets({ a: { card_number: "1234" } }), ["a.card_number"]);
  assert.deepEqual(checkNoSecrets({ ok: "fine" }), []);
});

test("validateCancellationEvidence", () => {
  assert.deepEqual(validateCancellationEvidence(cancelEvidence("s")), []);
  assert.ok(validateCancellationEvidence({}).length > 0);
  assert.ok(validateCancellationEvidence({ ...cancelEvidence("s"), outcome: "maybe" }).length > 0);
  assert.ok(
    validateCancellationEvidence(cancelEvidence("s"), { account_identity: "other", service_id: "s" }).length > 0,
  );
});

test("validateCleanupEvidence", () => {
  assert.deepEqual(validateCleanupEvidence(cleanupEvidence("s")), []);
  assert.ok(validateCleanupEvidence(null).length > 0);
  assert.ok(
    validateCleanupEvidence(cleanupEvidence("s"), { account_identity: "x", service_id: "s" }).length > 0,
  );
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
    ["SIGNED_UP", "BLOCKED_UNRESOLVED"],
    ["EVALUATING", "CANCEL_FAILED"],
    ["EVALUATING", "CHARGE_DETECTED"],
    ["CANCEL_REQUESTED", "RECOVERY_REQUIRED"],
  ];
  for (const [from, to] of cases) {
    const l = new TrialLedger();
    const order = ["PLANNED", "RESERVED", "SIGNED_UP", "EVALUATING", "CANCEL_REQUESTED"];
    for (const s of order) {
      const r = l.transition({
        trial_id: "t", service_id: "s", to_state: s, actor: "h",
        evidence: s === "SIGNED_UP" ? signupEvidence() : null,
      });
      assert.ok(r.ok, `setup ${s}: ${r.errors}`);
      if (s === from) break;
    }
    const r = l.transition({ trial_id: "t", service_id: "s", to_state: to, actor: "h" });
    assert.ok(r.ok, `${from} -> ${to}: ${r.errors}`);
  }
});

test("RECOVERY_REQUIRED can resume cancellation", () => {
  const l = new TrialLedger();
  toSignedUp(l, "t", "s");
  l.transition({ trial_id: "t", service_id: "s", to_state: "EVALUATING", actor: "h" });
  l.transition({ trial_id: "t", service_id: "s", to_state: "RECOVERY_REQUIRED", actor: "h" });
  const r = l.transition({ trial_id: "t", service_id: "s", to_state: "CANCEL_REQUESTED", actor: "h" });
  assert.ok(r.ok);
});

test("append-only: history preserved and entries frozen", () => {
  const l = new TrialLedger();
  fullRun(l, "t1", "s1");
  const recs = l.records.filter((r) => r.trial_id === "t1");
  assert.equal(recs.length, 8); // PLANNED..CLOSED
  assert.deepEqual(recs.map((r) => r.to_state), [
    "PLANNED", "RESERVED", "SIGNED_UP", "EVALUATING", "CANCEL_REQUESTED",
    "CANCEL_VERIFIED", "CLEANED", "CLOSED",
  ]);
  for (let i = 1; i < recs.length; i++) assert.equal(recs[i].seq, recs[i - 1].seq + 1);
  assert.throws(() => {
    recs[0].to_state = "HACKED";
  }, "appended records are immutable");
  assert.equal(recs[0].to_state, "PLANNED");
});

test("restart: a new ledger over the same store keeps obligations", () => {
  const store = createLedgerStore();
  const l1 = new TrialLedger(store);
  toSignedUp(l1, "t1", "rentec");
  const l2 = new TrialLedger(store); // "restarted" instance
  assert.equal(l2.currentState("t1"), "SIGNED_UP");
  assert.equal(l2.outstanding().length, 1);
  // Parallel instances cannot double-reserve the same service.
  const r = l2.transition({ trial_id: "t2", service_id: "rentec", to_state: "PLANNED", actor: "h" });
  assert.equal(r.ok, false);
});

test("transition map self-consistency", () => {
  const paths = {
    PLANNED: ["PLANNED"], RESERVED: ["PLANNED", "RESERVED"],
    SIGNED_UP: ["PLANNED", "RESERVED", "SIGNED_UP"],
    EVALUATING: ["PLANNED", "RESERVED", "SIGNED_UP", "EVALUATING"],
    CANCEL_REQUESTED: ["PLANNED", "RESERVED", "SIGNED_UP", "EVALUATING", "CANCEL_REQUESTED"],
    BLOCKED_UNRESOLVED: ["PLANNED", "RESERVED", "SIGNED_UP", "BLOCKED_UNRESOLVED"],
  };
  const edges = {
    PLANNED: ["RESERVED", "BLOCKED"], RESERVED: ["SIGNED_UP", "BLOCKED", "EXPIRY_UNKNOWN"],
    SIGNED_UP: ["EVALUATING", "BLOCKED_UNRESOLVED", "CANCEL_REQUESTED"],
    EVALUATING: ["CANCEL_REQUESTED", "CANCEL_FAILED", "CHARGE_DETECTED", "RECOVERY_REQUIRED", "BLOCKED_UNRESOLVED"],
    CANCEL_REQUESTED: ["CANCEL_VERIFIED", "CANCEL_FAILED", "RECOVERY_REQUIRED", "BLOCKED_UNRESOLVED"],
    BLOCKED_UNRESOLVED: ["CANCEL_REQUESTED"],
  };
  let count = 0;
  for (const [from, tos] of Object.entries(edges)) {
    for (const to of tos) {
      const l = new TrialLedger();
      for (const s of paths[from]) {
        const r = l.transition({
          trial_id: "t", service_id: "s", to_state: s, actor: "h",
          evidence:
            s === "SIGNED_UP" ? signupEvidence()
            : s === "CANCEL_VERIFIED" ? cancelEvidence("s")
            : s === "CLEANED" ? cleanupEvidence("s")
            : null,
        });
        assert.ok(r.ok, `setup ${s}: ${r.errors}`);
      }
      const r = l.transition({
        trial_id: "t", service_id: "s", to_state: to, actor: "h",
        evidence:
          to === "CANCEL_VERIFIED" ? cancelEvidence("s")
          : to === "SIGNED_UP" ? signupEvidence()
          : null,
      });
      assert.ok(r.ok, `${from} -> ${to}: ${r.errors}`);
      count++;
    }
  }
  assert.ok(count >= 15, `exercised ${count} legal edges`);
});

// CI-003 round 3: a CLOSED trial never frees another trial entitlement. The
// permanent reservation is derived from the append-only history.
test("CI-003: CLOSED trial never re-mints a trial entitlement", () => {
  const l = new TrialLedger();
  fullRun(l, "t1", "s");
  assert.equal(l.currentState("t1"), "CLOSED");
  assert.equal(l.serviceConsumed("s"), true);
  const r = l.transition({ trial_id: "t2", service_id: "s", to_state: "PLANNED", actor: "host" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("across all time")), `errors: ${r.errors}`);
});

// CI-003 round 3: the permanent reservation survives a restart — it is
// derived from the durable record history, not process memory.
test("CI-003: service reservation survives restart via the durable store", () => {
  const store = createLedgerStore();
  const l1 = new TrialLedger(store);
  fullRun(l1, "t1", "s");
  const l2 = new TrialLedger(store); // "restart": new instance, same store
  assert.equal(l2.serviceConsumed("s"), true);
  const r = l2.transition({ trial_id: "t2", service_id: "s", to_state: "PLANNED", actor: "host" });
  assert.equal(r.ok, false);
});

// CI-003 round 3: a pre-account BLOCKED skip never consumed, so the service
// stays plannable (clean skip, no obligations).
test("CI-003: pre-account BLOCKED skip does not consume the service", () => {
  const l = new TrialLedger();
  l.transition({ trial_id: "t1", service_id: "s", to_state: "PLANNED", actor: "host" });
  l.transition({ trial_id: "t1", service_id: "s", to_state: "BLOCKED", actor: "host" });
  assert.equal(l.serviceConsumed("s"), false);
  const r = l.transition({ trial_id: "t2", service_id: "s", to_state: "PLANNED", actor: "host" });
  assert.equal(r.ok, true, `clean skip must stay plannable: ${r.errors}`);
});
