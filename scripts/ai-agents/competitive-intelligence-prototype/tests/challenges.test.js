/** Challenge classification tests (§12). 24+ cases. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyChallenge,
  attemptAllowed,
  makeChallengeRecord,
  createWorkflowRegistry,
  createChallengeHistory,
  HANDLERS,
} from "../src/challenges.js";

function reg(overrides = {}) {
  const r = createWorkflowRegistry();
  const res = r.register({ phase: "trial_signup", origin: "https://example.com", service_id: "compa", ...overrides });
  assert.ok(res.ok, res.errors);
  return res.registration;
}

const cls = (detected, step = "trial_signup", dest = "vendor signup", registration = reg()) =>
  classifyChallenge({ detected, workflow_step: step, destination: dest, registration });

const hist = () => createChallengeHistory();
const allowedCtx = (h, extra = {}) => ({ challenge_id: "ch1", history: h, ...extra });

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
  h.record("ch1", "failed");
  const r = attemptAllowed("checkbox_passive", allowedCtx(h));
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "one_attempt_per_challenge");
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
  h.record("ch1", "failed");
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
    for (let k = 0; k < 5; k++) h.record("ch1", "failed");
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

test("permitted handler without history refuses", () => {
  const r = attemptAllowed("image_captcha", { challenge_id: "ch1", solver_credits_ok: true });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "no_workflow_history");
});

test("caller attempt_count is ignored", () => {
  // attempt_count: 0 must not grant an attempt when history says otherwise.
  const h = hist();
  h.record("ch1", "failed");
  const r = attemptAllowed("checkbox_passive", { challenge_id: "ch1", history: h, attempt_count: 0 });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, "one_attempt_per_challenge");
});
