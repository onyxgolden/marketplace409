/** Interlock + card registry tests (§11 revision 4/5/6). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EvaluationInterlock } from "../src/interlock.js";
import {
  CardRegistry,
  createIssuanceStore,
  createCardStore,
  validateIssuance,
  AGGREGATE_CAP_CENTS,
} from "../src/card.js";
import { TrialLedger } from "../src/ledger.js";

const ISSUANCE = {
  approved_by: "jason",
  approved_at: "2026-10-13T00:00:00Z",
  card_registry_id: "card-1",
  issuer: "prepaid-issuer",
};

function issuedStore() {
  const store = createIssuanceStore();
  const r = store.register(ISSUANCE);
  assert.ok(r.ok, r.errors);
  return store;
}

function closedLedgerProof(trial_id = "t1", service_id = "rentec", evaluation_id = "e1") {
  const l = new TrialLedger();
  for (const s of ["PLANNED", "RESERVED"]) l.transition({ trial_id, service_id, to_state: s, actor: "h", evaluation_id });
  l.transition({
    trial_id, service_id, to_state: "SIGNED_UP", actor: "h", evaluation_id,
    evidence: { account_identity: "acct-1" },
  });
  for (const s of ["EVALUATING", "CANCEL_REQUESTED"]) {
    l.transition({ trial_id, service_id, to_state: s, actor: "h" });
  }
  const ev = {
    account_identity: "acct-1", service_id, cancelled_at: "2026-10-13T12:00:00Z",
    outcome: "cancelled", evidence_hash: "sha256:x", issuer: "vendor",
  };
  l.transition({ trial_id, service_id, to_state: "CANCEL_VERIFIED", actor: "h", evidence: ev });
  l.transition({
    trial_id, service_id, to_state: "CLEANED", actor: "h",
    evidence: { account_identity: "acct-1", service_id, cleanup_receipt: "rcpt", cleaned_at: "2026-10-13T13:00:00Z" },
  });
  l.transition({ trial_id, service_id, to_state: "CLOSED", actor: "h" });
  return { ledger: l, trial_id };
}

const cancelEv = (holder) => ({
  trial_id: holder.trial_id,
  service_id: holder.service_id,
  account_identity: "acct-1",
  cancelled_at: "2026-10-13T12:00:00Z",
  outcome: "cancelled",
  evidence_hash: "sha256:x",
  issuer: "vendor",
});

const cleanupRcpt = (holder) => ({
  trial_id: holder.trial_id,
  service_id: holder.service_id,
  account_identity: "acct-1",
  cleaned_at: "2026-10-13T13:00:00Z",
});

// CI-004: trusted trial ledger binding for card cancellation/cleanup. The
// ledger registers account "acct-1" at SIGNED_UP for the holder's trial.
function cardLedger(trial_id, service_id, account = "acct-1") {
  const l = new TrialLedger();
  l.transition({ trial_id, service_id, to_state: "PLANNED", actor: "h" });
  l.transition({ trial_id, service_id, to_state: "RESERVED", actor: "h" });
  l.transition({
    trial_id, service_id, to_state: "SIGNED_UP", actor: "h",
    evidence: { account_identity: account },
  });
  return l;
}

test("interlock: acquire/release happy path with ledger proof", () => {
  const i = new EvaluationInterlock();
  const a = i.acquire({ evaluation_id: "e1", service_id: "rentec" });
  assert.equal(a.ok, true);
  assert.equal(a.lease.generation, 1);
  const r = i.release({ evaluation_id: "e1", generation: 1, proof: closedLedgerProof() });
  assert.equal(r.ok, true);
  assert.equal(i.holder(), null);
});

test("interlock: caller status string is not proof", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "rentec" });
  const r = i.release({ evaluation_id: "e1", generation: 1, terminal_state: "CLOSED" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "proof_required");
});

test("interlock: release refused while obligations outstanding", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "rentec" });
  const l = new TrialLedger();
  l.transition({ trial_id: "t1", service_id: "rentec", to_state: "PLANNED", actor: "h", evaluation_id: "e1" });
  const r = i.release({ evaluation_id: "e1", generation: 1, proof: { ledger: l, trial_id: "t1" } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "obligations_outstanding");
});

test("interlock: proof bound to a different evaluation refuses", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "rentec" });
  const proof = closedLedgerProof("t1", "rentec", "e2"); // different evaluation
  const r = i.release({ evaluation_id: "e1", generation: 1, proof });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "proof_binding_mismatch");
});

test("interlock: second acquire refused while held", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "rentec" });
  const b = i.acquire({ evaluation_id: "e2", service_id: "yardi" });
  assert.equal(b.ok, false);
  assert.equal(b.reason, "slot_held");
});

test("interlock: stale generation cannot release", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "rentec" });
  const r = i.release({ evaluation_id: "e1", generation: 99, proof: closedLedgerProof() });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "stale_generation");
});

test("interlock: heartbeat requires current generation", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "rentec" });
  assert.equal(i.heartbeat("e1", 1).ok, true);
  assert.equal(i.heartbeat("e1", 2).ok, false);
});

test("interlock: card-bound lease requires card closure proof", () => {
  const i = new EvaluationInterlock();
  const card = new CardRegistry(issuedStore());
  i.acquire({ evaluation_id: "e1", service_id: "rentec", card_bound: true });
  // Ledger closed but no card release -> refuse.
  const r = i.release({ evaluation_id: "e1", generation: 1, proof: { ...closedLedgerProof(), cardRegistry: card } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "card_closure_unverified");
  // Attach/release the card properly, then release succeeds.
  const lease = { evaluation_id: "e1", service_id: "rentec", generation: 1 };
  assert.ok(card.reserve({ service_id: "rentec", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i }).ok);
  assert.ok(card.attach({ issuance_id: "card-1", service_id: "rentec", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i }).ok);
  assert.ok(card.beginCancel({ generation: 1 }).ok);
  assert.ok(card.reconcile({ cancellation_evidence: cancelEv(card.holder), generation: 1, trialLedger: cardLedger("t1", "rentec") }).ok);
  assert.ok(card.verifyCleanup({ generation: 1, cleanup_receipt: cleanupRcpt(card.holder), trialLedger: cardLedger("t1", "rentec") }).ok);
  assert.ok(card.releaseToFree({ generation: 1 }).ok);
  const r2 = i.release({ evaluation_id: "e1", generation: 1, proof: { ...closedLedgerProof(), cardRegistry: card } });
  assert.equal(r2.ok, true);
});

test("card: attach refuses without registered issuance", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "rentec" });
  const c = new CardRegistry(createIssuanceStore()); // nothing registered
  const r = c.attach({
    issuance_id: "card-1", service_id: "rentec", trial_id: "t1",
    evaluation_id: "e1", generation: 1, interlock: i,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "issuance_unregistered");
});

test("card: attach refuses forged issuance object (truthiness is not approval)", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "rentec" });
  const c = new CardRegistry(createIssuanceStore());
  const r = c.attach({
    issuance_id: "whatever", service_id: "rentec", trial_id: "t1",
    evaluation_id: "e1", generation: 1, interlock: i,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "issuance_unregistered");
});

test("card: validateIssuance is schema-closed", () => {
  assert.deepEqual(validateIssuance(ISSUANCE), []);
  assert.ok(validateIssuance({}).length > 0);
  assert.ok(validateIssuance({ ...ISSUANCE, approved_at: "not-a-date" }).length > 0);
  assert.ok(validateIssuance({ ...ISSUANCE, extra: 1 }).length > 0);
});

test("card: full lifecycle with registered issuance", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "rentec" });
  const c = new CardRegistry(issuedStore());
  assert.equal(c.reserve({ service_id: "rentec", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i }).ok, true);
  // reserve -> attach continues the same holder, no manual reset.
  assert.equal(
    c.attach({ issuance_id: "card-1", service_id: "rentec", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i }).ok,
    true,
  );
  assert.equal(c.beginCancel({ generation: 1 }).ok, true);
  assert.equal(c.reconcile({ cancellation_evidence: cancelEv(c.holder), charge_cents: 100, generation: 1, trialLedger: cardLedger("t1", "a") }).ok, true);
  assert.equal(c.spentCents, 100);
  assert.equal(c.verifyCleanup({ generation: 1, cleanup_receipt: cleanupRcpt(c.holder), trialLedger: cardLedger("t1", "a") }).ok, true);
  assert.equal(c.releaseToFree({ generation: 1 }).ok, true);
  assert.equal(c.state, "FREE");
});

test("card: attach requires the interlock lease", () => {
  const c = new CardRegistry(issuedStore());
  const r = c.attach({
    issuance_id: "card-1", service_id: "rentec", trial_id: "t1",
    evaluation_id: "e1", generation: 1, interlock: null,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "interlock_required");
});

test("card: aggregate cap never resets", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "a" });
  const c = new CardRegistry(issuedStore());
  c.reserve({ service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.attach({ issuance_id: "card-1", service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.beginCancel({ generation: 1 });
  c.reconcile({ cancellation_evidence: cancelEv(c.holder), charge_cents: 4900, generation: 1, trialLedger: cardLedger("t1", "a") });
  c.verifyCleanup({ generation: 1, cleanup_receipt: cleanupRcpt(c.holder), trialLedger: cardLedger("t1", "a") });
  c.releaseToFree({ generation: 1 });
  // Second use: only 100 cents remain.
  i.release({ evaluation_id: "e1", generation: 1, proof: closedLedgerProof("t1", "a", "e1") });
  i.acquire({ evaluation_id: "e2", service_id: "b" });
  c.reserve({ service_id: "b", trial_id: "t2", evaluation_id: "e2", generation: 2, interlock: i });
  c.attach({ issuance_id: "card-1", service_id: "b", trial_id: "t2", evaluation_id: "e2", generation: 2, interlock: i });
  c.beginCancel({ generation: 2 });
  const r = c.reconcile({ cancellation_evidence: cancelEv(c.holder), charge_cents: 200, generation: 2, trialLedger: cardLedger("t2", "b") });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "aggregate_cap_exceeded");
  assert.equal(c.state, "QUARANTINED");
});

test("card: settled_cents cannot exceed the cap (CI-004 probe)", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "a" });
  const c = new CardRegistry(issuedStore());
  c.reserve({ service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.attach({ issuance_id: "card-1", service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.beginCancel({ generation: 1 });
  // $60 of "settled" with no holds and no prior spend -> refused.
  const r = c.reconcile({ cancellation_evidence: cancelEv(c.holder), settled_cents: 6000, generation: 1, trialLedger: cardLedger("t1", "a") });
  assert.equal(r.ok, false);
  assert.ok(["settled_exceeds_holds", "aggregate_cap_exceeded"].includes(r.reason), r.reason);
});

test("card: invalid amounts refused", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "a" });
  const c = new CardRegistry(issuedStore());
  c.reserve({ service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.attach({ issuance_id: "card-1", service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.beginCancel({ generation: 1 });
  for (const bad of [-5, 1.5, "100", NaN]) {
    const r = c.reconcile({ cancellation_evidence: cancelEv(c.holder), charge_cents: bad, generation: 1 });
    assert.equal(r.ok, false, `charge_cents=${bad}`);
    assert.equal(r.reason, "invalid_amount");
  }
});

test("card: releaseToFree refuses outstanding holds", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "a" });
  const c = new CardRegistry(issuedStore());
  c.reserve({ service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.attach({ issuance_id: "card-1", service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.beginCancel({ generation: 1 });
  assert.ok(c.reconcile({ cancellation_evidence: cancelEv(c.holder), hold_cents: 100, generation: 1, trialLedger: cardLedger("t1", "a") }).ok);
  assert.ok(c.verifyCleanup({ generation: 1, cleanup_receipt: cleanupRcpt(c.holder), trialLedger: cardLedger("t1", "a") }).ok);
  const r = c.releaseToFree({ generation: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "outstanding_holds");
});

test("card: releaseToFree requires verified cleanup", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "a" });
  const c = new CardRegistry(issuedStore());
  c.reserve({ service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.attach({ issuance_id: "card-1", service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.beginCancel({ generation: 1 });
  c.reconcile({ cancellation_evidence: cancelEv(c.holder), generation: 1, trialLedger: cardLedger("t1", "a") });
  const r = c.releaseToFree({ generation: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "cleanup_unverified");
});

test("card: stale generation cannot drive transitions", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "a" });
  const c = new CardRegistry(issuedStore());
  c.reserve({ service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.attach({ issuance_id: "card-1", service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  assert.equal(c.beginCancel({ generation: 99 }).ok, false);
  assert.equal(c.beginCancel({ generation: 99 }).reason, "stale_generation");
});

test("card: reconcile requires bound cancellation evidence", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "a" });
  const c = new CardRegistry(issuedStore());
  c.reserve({ service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.attach({ issuance_id: "card-1", service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.beginCancel({ generation: 1 });
  const r = c.reconcile({ cancellation_evidence: { nope: true }, generation: 1, trialLedger: cardLedger("t1", "a") });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_cancellation_evidence");
  const wrongTrial = c.reconcile({
    cancellation_evidence: { ...cancelEv(c.holder), trial_id: "other" }, generation: 1,
    trialLedger: cardLedger("t1", "a"),
  });
  assert.equal(wrongTrial.ok, false);
});

test("card: restart restores from the durable store", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "a" });
  const store = createCardStore();
  const c = new CardRegistry(issuedStore());
  c.reserve({ service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  store.save(c.snapshot());
  const c2 = CardRegistry.restore(issuedStore(), store.load());
  assert.equal(c2.state, "RESERVED");
  assert.deepEqual(c2.holder.service_id, "a");
  // The restored registry continues the lifecycle without losing the cap.
  c2.attach({ issuance_id: "card-1", service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  assert.equal(c2.state, "ATTACHED");
});

test("card: second card and top-up denied", () => {
  const c = new CardRegistry(null);
  assert.equal(c.requestSecondCard().ok, false);
  assert.equal(c.requestTopUp().ok, false);
});

test("card: cap is $50", () => {
  assert.equal(AGGREGATE_CAP_CENTS, 5000);
});

// CI-003 round 3: the caller's card_bound flag is not authoritative. A card
// attached to this evaluation's trial creates a card obligation even when
// the caller claims card_bound:false — release still requires verified
// card closure.
test("CI-003: card_bound:false cannot bypass a real card obligation", () => {
  const i = new EvaluationInterlock();
  const card = new CardRegistry(issuedStore());
  i.acquire({ evaluation_id: "e1", service_id: "rentec", card_bound: false }); // caller lies
  assert.ok(card.reserve({ service_id: "rentec", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i }).ok);
  assert.ok(card.attach({ issuance_id: "card-1", service_id: "rentec", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i }).ok);
  // Ledger closed, but the card is still attached: release must refuse.
  const r = i.release({ evaluation_id: "e1", generation: 1, proof: { ...closedLedgerProof(), cardRegistry: card } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "card_closure_unverified");
});

// CI-003 round 3: card closure binds the actual service/trial/generation —
// a closure record for a different service does not free this lease.
test("CI-003: card closure bound to a different service is rejected", () => {
  const i = new EvaluationInterlock();
  const card = new CardRegistry(issuedStore());
  i.acquire({ evaluation_id: "e1", service_id: "rentec", card_bound: true });
  // Drive the card lifecycle for a DIFFERENT service, then hand that
  // closure to the rentec lease's release.
  const other = new EvaluationInterlock();
  other.acquire({ evaluation_id: "e1", service_id: "other", card_bound: true });
  assert.ok(card.reserve({ service_id: "other", trial_id: "t9", evaluation_id: "e1", generation: 1, interlock: other }).ok);
  assert.ok(card.attach({ issuance_id: "card-1", service_id: "other", trial_id: "t9", evaluation_id: "e1", generation: 1, interlock: other }).ok);
  assert.ok(card.beginCancel({ generation: 1 }).ok);
  const l = new TrialLedger();
  for (const s of ["PLANNED", "RESERVED"]) l.transition({ trial_id: "t9", service_id: "other", to_state: s, actor: "h" });
  l.transition({ trial_id: "t9", service_id: "other", to_state: "SIGNED_UP", actor: "h", evidence: { account_identity: "acct-1" } });
  assert.ok(card.reconcile({ cancellation_evidence: { ...cancelEv(card.holder), trial_id: "t9", service_id: "other" }, generation: 1, trialLedger: l }).ok);
  assert.ok(card.verifyCleanup({ generation: 1, cleanup_receipt: { ...cleanupRcpt(card.holder), trial_id: "t9", service_id: "other" }, trialLedger: l }).ok);
  assert.ok(card.releaseToFree({ generation: 1 }).ok);
  const r = i.release({ evaluation_id: "e1", generation: 1, proof: { ...closedLedgerProof(), cardRegistry: card } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "card_closure_binding_mismatch");
});

// CI-004 round 3: a request-provided account_identity is not proof. The
// cancellation evidence account must match the trial ledger's REGISTERED
// account for the holder's trial.
test("CI-004: unrelated account_identity in cancellation evidence is refused", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "a" });
  const c = new CardRegistry(issuedStore());
  c.reserve({ service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.attach({ issuance_id: "card-1", service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.beginCancel({ generation: 1 });
  const ledger = cardLedger("t1", "a", "acct-1"); // registered account is acct-1
  const evil = { ...cancelEv(c.holder), account_identity: "unrelated-account" };
  const r = c.reconcile({ cancellation_evidence: evil, generation: 1, trialLedger: ledger });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_cancellation_evidence");
  assert.ok(r.errors.some((e) => e.includes("registered account")), `errors: ${r.errors}`);
});

// CI-004 round 3: reconcile without the trusted ledger refuses — there is
// no trusted account to bind to.
test("CI-004: reconcile without a trial ledger refuses", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "a" });
  const c = new CardRegistry(issuedStore());
  c.reserve({ service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.attach({ issuance_id: "card-1", service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.beginCancel({ generation: 1 });
  const r = c.reconcile({ cancellation_evidence: cancelEv(c.holder), generation: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_trusted_account_binding");
});

// CI-004 round 3: cleanup receipt account must also bind to the registered
// trial account.
test("CI-004: cleanup receipt with unrelated account is refused", () => {
  const i = new EvaluationInterlock();
  i.acquire({ evaluation_id: "e1", service_id: "a" });
  const c = new CardRegistry(issuedStore());
  c.reserve({ service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.attach({ issuance_id: "card-1", service_id: "a", trial_id: "t1", evaluation_id: "e1", generation: 1, interlock: i });
  c.beginCancel({ generation: 1 });
  const ledger = cardLedger("t1", "a", "acct-1");
  assert.ok(c.reconcile({ cancellation_evidence: cancelEv(c.holder), generation: 1, trialLedger: ledger }).ok);
  const evil = { ...cleanupRcpt(c.holder), account_identity: "unrelated-account" };
  const r = c.verifyCleanup({ generation: 1, cleanup_receipt: evil, trialLedger: ledger });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "cleanup_unverified");
});
