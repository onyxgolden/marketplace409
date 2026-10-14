/** Challenge classification tests (§12). 24+ cases. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyChallenge, attemptAllowed, makeChallengeRecord, HANDLERS } from "../src/challenges.js";

const cls = (detected, step = "signup", dest = "vendor signup") =>
  classifyChallenge({ detected, workflow_step: step, destination: dest });

// 1-3: email verification
test("email verification classified + allowed with mailbox", () => {
  const c = cls("email verification code required", "signup", "vendor signup");
  assert.equal(c.type, "email_verification");
  assert.equal(c.handler, "own_mailbox_self_service");
  assert.equal(attemptAllowed("email_verification", { own_mailbox_ready: true }).allowed, true);
});
test("email verification without mailbox -> skip", () => {
  const r = attemptAllowed("email_verification", { own_mailbox_ready: false });
  assert.equal(r.allowed, false);
  assert.equal(r.log, "EMAIL_VERIFICATION_UNCLEARED");
});
test("email link outside signup is not email_verification", () => {
  const c = cls("email verification", "login", "vendor login");
  assert.notEqual(c.type, "email_verification");
});

// 4-6: checkbox/passive
test("checkbox challenge classified + single attempt", () => {
  const c = cls("checkbox challenge");
  assert.equal(c.type, "checkbox_passive");
  assert.equal(attemptAllowed("checkbox_passive", {}).allowed, true);
});
test("passive browser check", () => {
  assert.equal(cls("passive browser check").type, "checkbox_passive");
});
test("checkbox failure -> skip, no loop", () => {
  const r = attemptAllowed("checkbox_passive", { attempt_count: 1 });
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
  assert.equal(attemptAllowed("image_captcha", { solver_credits_ok: true }).allowed, true);
});
test("solver unavailable -> skip", () => {
  const r = attemptAllowed("image_captcha", { solver_credits_ok: false });
  assert.equal(r.allowed, false);
  assert.equal(r.log, "SOLVER_UNAVAILABLE");
});
test("second attempt denied even with credits", () => {
  const r = attemptAllowed("image_captcha", { solver_credits_ok: true, attempt_count: 1 });
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
  assert.equal(attemptAllowed("phone_sms", {}).allowed, false);
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
  assert.equal(attemptAllowed("payment_fraud", {}).allowed, false);
});

// 18-20: unknown
test("unknown challenge -> refuse + skip", () => {
  const c = cls("mysterious gate");
  assert.equal(c.type, "unknown");
  assert.equal(c.receipt.reason_code, "CHALLENGE_UNCLASSIFIED");
  assert.equal(attemptAllowed("unknown", {}).allowed, false);
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
  const c = cls("payment verification", "trial_checkout", "vendor trial");
  assert.equal(c.type, "payment_fraud");
  assert.equal(attemptAllowed("payment_fraud", { attempt_count: 0 }).allowed, false);
});
test("one attempt policy is global", () => {
  for (const t of ["email_verification", "checkbox_passive", "image_captcha"]) {
    const ctx = { attempt_count: 5, own_mailbox_ready: true, solver_credits_ok: true };
    assert.equal(attemptAllowed(t, ctx).allowed, false, t);
  }
});
