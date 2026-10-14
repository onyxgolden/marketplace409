/** Challenge classification tests (§12). 24+ cases. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyChallenge,
  attemptAllowed,
  makeChallengeRecord,
  createWorkflowRegistry,
  createChallengeHistory,
  workflowAttemptKey,
  HANDLERS,
} from "../src/challenges.js";

function setup(overrides = {}) {
  const registry = createWorkflowRegistry();
  // CI-005 round 4: the registration binds phase + origin + service_id +
  // evaluation_id — all required.
  const res = registry.register({ phase: "trial_signup", origin: "https://example.com", service_id: "compa", evaluation_id: "e1", ...overrides });
  assert.ok(res.ok, res.errors);
  return { registry, registration: res.registration };
}

const cls = (detected, step = "trial_signup", dest = "vendor signup", s = setup()) => {
  const c = classifyChallenge({
    detected, workflow_step: step, destination: dest,
    target_origin: "https://example.com", service_id: "compa", evaluation_id: "e1",
    registration_id: s.registration.registration_id, registry: s.registry,
  });
  // Carry the stable workflow-operation key for attempt accounting.
  return { ...c, workflowKey: c.receipt.workflow_attempt_key };
};

const hist = () => createChallengeHistory();
const allowedCtx = (h, extra = {}) => ({ workflowKey: workflowAttemptKey("wfreg-1", "own_mailbox_self_service"), history: h, ...extra });

// 1-3: email verification
test("email verification classified + allowed with mailbox", () => {
  const c = cls("email verification code required");
  assert.equal(c.type, "email_verification");
  assert.equal(c.handler, "own_mailbox_self_service");
  assert.equal(attemptAllowed("email_verification", allowedCtx(hist(), { own_mailbox_ready: true })).allowed, true);
});
test("email verification without mailbox -> skip", () => {
  const r = attemptAllowed("email_verification", allowedCtx(hist(), { own_mailbox_ready: false }));
  assert.equal(r.allowed, false);
  assert.equal(r.log, "EMAIL_VERIFICATION_UNCLEARED");
});
test("email link outside signup phase is not email_verification", () => {
  const c = cls("email verification", "login", "vendor login");
  assert.notEqual(c.type, "email_verification");
  assert.equal(c.receipt.reason_code, "PHASE_MISMATCH");
});

// 4-6: checkbox/passive
test("checkbox challenge classified + single attempt", () => {
  const c = cls("checkbox challenge");
  assert.equal(c.type, "checkbox_passive");
  assert.equal(attemptAllowed("checkbox_passive", allowedCtx(hist())).allowed, true);
});
test("passive browser check", () => {
  assert.equal(cls("passive browser check").type, "checkbox_passive");
});
test("checkbox failure -> skip, no loop (history-driven)", () => {
  const h = hist();
  h.consume(workflowAttemptKey("wfreg-1", "own_mailbox_self_service"));
  const r = attemptAllowed("checkbox_passive", allowedCtx(h));
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "one_attempt_per_workflow");
});

// 7-11: image captcha
test("image captcha classified with risk flags", () => {
  const c = cls("image captcha required");
  assert.equal(c.type, "image_captcha");
  assert.ok(c.receipt.risk_flags.includes("TOS_VIOLATION_RISK"));
  assert.ok(c.receipt.risk_flags.includes("ACCOUNT_BAN_RISK"));
});
test("recaptcha variant", () => {
  assert.equal(cls("recaptcha challenge").type, "image_captcha");
});
test("solver allowed with credits", () => {
  assert.equal(attemptAllowed("image_captcha", allowedCtx(hist(), { solver_credits_ok: true })).allowed, true);
});
test("solver unavailable -> skip", () => {
  const r = attemptAllowed("image_captcha", allowedCtx(hist(), { solver_credits_ok: false }));
  assert.equal(r.allowed, false);
  assert.equal(r.log, "SOLVER_UNAVAILABLE");
});
test("second attempt denied even with credits", () => {
  const h = hist();
  h.consume(workflowAttemptKey("wfreg-1", "own_mailbox_self_service"));
  const r = attemptAllowed("image_captcha", allowedCtx(h, { solver_credits_ok: true }));
  assert.equal(r.allowed, false);
});

// 12-14: phone/SMS refused
test("phone verification refused", () => {
  const c = cls("phone verification via SMS");
  assert.equal(c.type, "phone_sms");
  assert.equal(c.handler, "refuse");
  assert.equal(c.receipt.reason_code, "BLOCKED_PHONE_VERIFICATION");
});
test("sms code refused", () => {
  assert.equal(attemptAllowed("phone_sms", allowedCtx(hist())).allowed, false);
});
test("mobile number request refused", () => {
  assert.equal(cls("enter your mobile number").type, "phone_sms");
});

// 15-17: payment/fraud refused
test("payment challenge refused", () => {
  const c = cls("payment verification required");
  assert.equal(c.type, "payment_fraud");
  assert.equal(c.receipt.reason_code, "BLOCKED_PAYMENT_OR_FRAUD_CHALLENGE");
});
test("3d secure refused", () => {
  assert.equal(cls("3d secure authentication").type, "payment_fraud");
});
test("card fraud check refused", () => {
  assert.equal(attemptAllowed("payment_fraud", allowedCtx(hist())).allowed, false);
});

// 18-20: unknown
test("unknown challenge -> refuse + skip", () => {
  const c = cls("mysterious gate");
  assert.equal(c.type, "unknown");
  assert.equal(c.receipt.reason_code, "CHALLENGE_UNCLASSIFIED");
  assert.equal(attemptAllowed("unknown", allowedCtx(hist())).allowed, false);
});
test("empty detection -> unknown", () => {
  assert.equal(cls("").type, "unknown");
});
test("unrelated text -> unknown", () => {
  assert.equal(cls("welcome to our homepage").type, "unknown");
});

// 21-24: records and handler map
test("challenge record carries no secrets", () => {
  const c = cls("image captcha required");
  const rec = makeChallengeRecord({
    challenge_id: "ch1", service_id: "rentec", classification: c,
    outcome: "skipped", reason_code: "SOLVER_UNAVAILABLE",
  });
  assert.equal(rec.challenge_type, "image_captcha");
  assert.ok(!("code" in rec) && !("token" in rec));
  assert.deepEqual(rec.risk_flags, ["TOS_VIOLATION_RISK", "ACCOUNT_BAN_RISK"]);
});
test("handler map covers all types", () => {
  for (const t of ["email_verification", "checkbox_passive", "image_captcha", "phone_sms", "payment_fraud", "unknown"]) {
    assert.ok(HANDLERS[t], t);
  }
});
test("payment challenge inside trial still refused", () => {
  const c = cls("payment verification", "trial_signup", "vendor trial");
  assert.equal(c.type, "payment_fraud");
  assert.equal(attemptAllowed("payment_fraud", allowedCtx(hist())).allowed, false);
});
test("one attempt policy is global (history-driven)", () => {
  for (const t of ["email_verification", "checkbox_passive", "image_captcha"]) {
    const h = hist();
    for (let k = 0; k < 5; k++) h.consume(workflowAttemptKey("wfreg-1", "own_mailbox_self_service"));
    const ctx = allowedCtx(h, { own_mailbox_ready: true, solver_credits_ok: true });
    assert.equal(attemptAllowed(t, ctx).allowed, false, t);
  }
});

// CI-005 regressions
test("unregistered workflow -> unknown/refuse", () => {
  const c = classifyChallenge({ detected: "image captcha required", workflow_step: "trial_signup", destination: "x" });
  assert.equal(c.type, "unknown");
  assert.equal(c.receipt.reason_code, "UNREGISTERED_WORKFLOW");
});

test("invented registration_id not in the registry refuses", () => {
  const { registry } = setup();
  const c = classifyChallenge({
    detected: "image captcha required", workflow_step: "trial_signup",
    destination: "vendor signup", target_origin: "https://example.com",
    service_id: "compa", evaluation_id: "e1",
    registration_id: "invented-reg-999", registry,
  });
  assert.equal(c.type, "unknown");
  assert.equal(c.receipt.reason_code, "UNREGISTERED_WORKFLOW");
});

test("permitted handler without history refuses", () => {
  const r = attemptAllowed("image_captcha", { workflowKey: "wfreg-1::single_solver_submission", solver_credits_ok: true });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "no_workflow_history");
});

test("caller attempt_count is ignored", () => {
  // attempt_count: 0 must not grant an attempt when history says otherwise.
  const h = hist();
  h.consume(workflowAttemptKey("wfreg-1", "own_mailbox_self_service"));
  const r = attemptAllowed("checkbox_passive", { workflowKey: workflowAttemptKey("wfreg-1", "own_mailbox_self_service"), history: h, attempt_count: 0 });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "one_attempt_per_workflow");
});

// CI-005 round 3: an unrelated destination/origin never authorizes a
// permitted handler, even with a valid registration_id.
test("CI-005: unrelated destination does not authorize", () => {
  const { registry, registration } = setup();
  const c = classifyChallenge({
    detected: "image captcha required", workflow_step: "trial_signup",
    destination: "https://evil.example/phish", target_origin: "https://evil.example/phish",
    service_id: "compa", evaluation_id: "e1",
    registration_id: registration.registration_id, registry,
  });
  assert.equal(c.type, "unknown");
  assert.equal(c.handler, "refuse");
  assert.equal(c.receipt.reason_code, "ORIGIN_MISMATCH");
});

// CI-005 round 3: one attempt per stable workflow operation, allocated
// BEFORE external submission. A challenge-ID change is not a new attempt.
test("CI-005: challenge_id change does not reset attempts", () => {
  const s = setup();
  const c = classifyChallenge({
    detected: "image captcha required", workflow_step: "trial_signup",
    destination: "vendor signup", target_origin: "https://example.com", service_id: "compa",
    evaluation_id: "e1",
    registration_id: s.registration.registration_id, registry: s.registry,
  });
  assert.equal(c.type, "image_captcha");
  const key = c.receipt.workflow_attempt_key;
  assert.ok(key, "classification carries the stable workflow attempt key");
  const h = hist();
  // First attempt allowed...
  assert.equal(attemptAllowed("image_captcha", { workflowKey: key, history: h, solver_credits_ok: true }).allowed, true);
  // ...allocated atomically BEFORE external submission...
  assert.equal(h.consume(key), 1);
  // ...and a "new" challenge_id for the same workflow is still denied.
  const again = attemptAllowed("image_captcha", { workflowKey: key, history: h, solver_credits_ok: true, challenge_id: "ch2-NEW" });
  assert.equal(again.allowed, false);
  assert.equal(again.reason, "one_attempt_per_workflow");
});

// CI-005 round 3: a restarted history (new instance, same workflow key)
// still denies — the key is stable, so re-derivation cannot reset it.
test("CI-005: workflow key is stable across history instances", () => {
  const s = setup();
  const key = workflowAttemptKey(s.registration.registration_id, "single_solver_submission");
  const h1 = hist();
  h1.consume(key);
  const h2 = hist(); // fresh instance, same key derivation
  assert.equal(h2.attempts(key), 0, "fresh instance starts empty (host must persist)");
  assert.equal(h1.attempts(key), 1);
  // The point: the KEY does not change with challenge_id, so a host that
  // persists the history cannot be reset by a challenge-ID rotation.
  assert.equal(
    workflowAttemptKey(s.registration.registration_id, "single_solver_submission"),
    key,
    "key derivation is deterministic",
  );
});

// CI-005 round 4 — verdict probe 2: registered https://vendor.example /
// compa / e1 workflow; image challenge with an UNRELATED destination and
// omitted actual bindings. Must refuse — a valid registration is not
// portable authority for unrelated destinations.
test("CI-005r4: unrelated destination with omitted bindings refuses", () => {
  const registry = createWorkflowRegistry();
  const reg = registry.register({
    phase: "trial_signup", origin: "https://vendor.example", service_id: "compa", evaluation_id: "e1",
  }).registration;
  const c = classifyChallenge({
    detected: "image captcha required", workflow_step: "trial_signup",
    destination: "https://unrelated.example/signup",
    registration_id: reg.registration_id, registry,
    // target_origin / service_id / evaluation_id omitted
  });
  assert.equal(c.type, "unknown");
  assert.equal(c.handler, "refuse");
  assert.equal(c.receipt.reason_code, "BINDING_REQUIRED");
});

// The same probe with the bindings supplied must still refuse on the
// destination origin.
test("CI-005r4: unrelated URL destination refuses even with bindings supplied", () => {
  const registry = createWorkflowRegistry();
  const reg = registry.register({
    phase: "trial_signup", origin: "https://vendor.example", service_id: "compa", evaluation_id: "e1",
  }).registration;
  const c = classifyChallenge({
    detected: "image captcha required", workflow_step: "trial_signup",
    destination: "https://unrelated.example/signup",
    target_origin: "https://vendor.example", service_id: "compa", evaluation_id: "e1",
    registration_id: reg.registration_id, registry,
  });
  assert.equal(c.type, "unknown");
  assert.equal(c.handler, "refuse");
  assert.equal(c.receipt.reason_code, "DESTINATION_MISMATCH");
});

// Each missing binding is a refusal, not an exemption.
for (const missing of ["target_origin", "service_id", "evaluation_id"]) {
  test(`CI-005r4: missing ${missing} binding refuses`, () => {
    const { registry, registration } = setup();
    const args = {
      detected: "image captcha required", workflow_step: "trial_signup",
      destination: "vendor signup",
      target_origin: "https://example.com", service_id: "compa", evaluation_id: "e1",
      registration_id: registration.registration_id, registry,
    };
    delete args[missing];
    const c = classifyChallenge(args);
    assert.equal(c.type, "unknown");
    assert.equal(c.receipt.reason_code, "BINDING_REQUIRED", missing);
  });
}

// Registration without an evaluation binding refuses at registration time.
test("CI-005r4: registration requires evaluation_id", () => {
  const registry = createWorkflowRegistry();
  const r = registry.register({ phase: "trial_signup", origin: "https://example.com", service_id: "compa" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("evaluation_id")));
});

// CI-005 round 4 — verdict probe 3: the atomic attempt grant. Two callers
// racing on one workflow key: exactly one obtains the grant.
test("CI-005r4: simultaneous tryReserve grants exactly one winner", () => {
  const h = hist();
  const key = workflowAttemptKey("wfreg-9", "single_solver_submission");
  const first = h.tryReserve(key);
  const second = h.tryReserve(key);
  const winners = [first, second].filter((r) => r.granted);
  assert.equal(winners.length, 1, "exactly one caller wins the atomic grant");
  assert.equal(second.granted, false);
  assert.equal(second.reason, "already_consumed");
  // The advisory read agrees with the grant state.
  assert.equal(attemptAllowed("image_captcha", { workflowKey: key, history: h, solver_credits_ok: true }).allowed, false);
});

// A failed/crashed handler keeps its reservation consumed — no retry.
test("CI-005r4: crashed reservation stays consumed", () => {
  const h = hist();
  const key = workflowAttemptKey("wfreg-9", "single_solver_submission");
  assert.equal(h.tryReserve(key).granted, true);
  // Handler "crashes" before submitting: no release API exists, the attempt
  // is gone. A retry for the same workflow is denied.
  assert.equal(h.tryReserve(key).granted, false);
  assert.equal(h.attempts(key), 1);
});

// Restart persistence: the host's snapshot/restore carries the grant across
// instances — a fresh history object cannot re-arm the workflow.
test("CI-005r4: attempt grant survives history restore", () => {
  const h1 = hist();
  const key = workflowAttemptKey("wfreg-9", "single_solver_submission");
  assert.equal(h1.tryReserve(key).granted, true);
  const h2 = hist();
  h2.restore(h1.snapshot());
  assert.equal(h2.tryReserve(key).granted, false, "restored history still denies");
  assert.equal(h2.attempts(key), 1);
});

// Invalid keys fail closed.
test("CI-005r4: tryReserve with an invalid key fails closed", () => {
  const h = hist();
  assert.equal(h.tryReserve("").granted, false);
  assert.equal(h.tryReserve(null).granted, false);
});
