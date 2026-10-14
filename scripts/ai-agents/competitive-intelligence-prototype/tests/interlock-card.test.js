/** Interlock + card registry tests (§11 revision 4/5). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EvaluationInterlock } from "../src/interlock.js";
import { CardRegistry, AGGREGATE_CAP_CENTS } from "../src/card.js";

test("interlock: acquire/release happy path", () => {
  const i = new EvaluationInterlock();
  const a = i.acquire({ evaluation_id: "e1", service_id: "rentec" });
  assert.equal(a.ok, true);
  assert.equal(a.lease.generation, 1);
  const r = i.release({ evaluation_id: "e1", generation: 1, terminal_state: "CLOSED" });
  assert.equal(r.ok, true);
  assert.equal(i.holder(), null);
});

test("interlock: second acquire refused while held", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "rentec" });
  const b = i.acquire({ evaluation_id: "e2", service_id: "yardi" });
  assert.equal(b.ok, false);
  assert.equal(b.reason, "slot_held");
});

test("interlock: release requires terminal state", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "rentec" });
  const r = i.release({ evaluation_id: "e1", generation: 1, terminal_state: "EVALUATING" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_terminal");
});

test("interlock: stale generation cannot release", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "rentec" });
  const r = i.release({ evaluation_id: "e1", generation: 99, terminal_state: "CLOSED" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "stale_generation");
});

test("interlock: heartbeat requires current generation", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "rentec" });
  assert.equal(i.heartbeat("e1", 1).ok, true);
  assert.equal(i.heartbeat("e1", 2).ok, false);
});

test("card: attach refuses without issuance approval", () => {
  const c = new CardRegistry(null);
  const r = c.attach({ service_id: "rentec", trial_id: "t1", evaluation_id: "e1", generation: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_issuance_approval");
});

test("card: full lifecycle with approval", () => {
  const c = new CardRegistry({ approved_by: "jason", approved_at: "2026-10-13", card_registry_id: "card1", issuer: "x" });
  assert.equal(c.reserve({ service_id: "rentec", trial_id: "t1" }).ok, true);
  // reserve -> attach is not a legal direct step in this model; release and attach from FREE
  c.state = "FREE"; c.holder = null;
  assert.equal(c.attach({ service_id: "rentec", trial_id: "t1", evaluation_id: "e1", generation: 1 }).ok, true);
  assert.equal(c.beginCancel().ok, true);
  assert.equal(c.reconcile({ cancellation_evidence_ok: true, charge_cents: 100 }).ok, true);
  assert.equal(c.spentCents, 100);
  assert.equal(c.releaseToFree().ok, true);
  assert.equal(c.state, "FREE");
});

test("card: aggregate cap never resets", () => {
  const c = new CardRegistry({ approved_by: "jason", approved_at: "x", card_registry_id: "c", issuer: "x" });
  c.state = "ATTACHED"; c.holder = { service_id: "a" };
  c.beginCancel();
  c.reconcile({ cancellation_evidence_ok: true, charge_cents: 4900 });
  c.releaseToFree();
  // Second use: only 100 cents remain.
  c.state = "ATTACHED"; c.holder = { service_id: "b" };
  c.beginCancel();
  const r = c.reconcile({ cancellation_evidence_ok: true, charge_cents: 200 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "aggregate_cap_exceeded");
  assert.equal(c.state, "QUARANTINED");
});

test("card: reconcile requires cancellation evidence", () => {
  const c = new CardRegistry({ approved_by: "jason", approved_at: "x", card_registry_id: "c", issuer: "x" });
  c.state = "ATTACHED";
  c.beginCancel();
  const r = c.reconcile({ cancellation_evidence_ok: false });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_cancellation_evidence");
});

test("card: second card and top-up denied", () => {
  const c = new CardRegistry(null);
  assert.equal(c.requestSecondCard().ok, false);
  assert.equal(c.requestTopUp().ok, false);
});

test("card: cap is $50", () => {
  assert.equal(AGGREGATE_CAP_CENTS, 5000);
});
