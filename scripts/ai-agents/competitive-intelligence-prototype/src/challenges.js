/**
 * challenges.js — autonomous challenge classification per contract §12.
 *
 * One handler attempt per signup challenge workflow. No retry loops.
 * Phone/SMS and payment/fraud challenges are NEVER handled.
 * Every classification produces a ChallengeRecord; unclear purpose -> skip.
 */

export const CHALLENGE_TYPES = [
  "email_verification",
  "checkbox_passive",
  "image_captcha",
  "phone_sms",
  "payment_fraud",
  "unknown",
];

export const HANDLERS = {
  email_verification: "own_mailbox_self_service",
  checkbox_passive: "single_bounded_browser_attempt",
  image_captcha: "single_solver_submission",
  phone_sms: "refuse",
  payment_fraud: "refuse",
  unknown: "refuse",
};

/**
 * Classify a detected challenge. Returns {type, handler, receipt}.
 * purpose is derived from the registered workflow step, never page text.
 */
export function classifyChallenge({ detected, workflow_step, destination }) {
  const text = `${detected || ""}`.toLowerCase();
  let type = "unknown";
  if (/email|mailbox|verification (code|link)/.test(text) && /signup|registration/.test(`${workflow_step} ${destination}`.toLowerCase())) {
    type = "email_verification";
  } else if (/checkbox|passive|browser check|cloudflare challenge/.test(text)) {
    type = "checkbox_passive";
  } else if (/captcha|image|labeling|recaptcha|hcaptcha/.test(text)) {
    type = "image_captcha";
  } else if (/phone|sms|text message|mobile number/.test(text)) {
    type = "phone_sms";
  } else if (/payment|card|fraud|3d secure|issuer|billing/.test(text)) {
    type = "payment_fraud";
  }

  const handler = HANDLERS[type];
  const receipt = {
    challenge_type: type,
    handler,
    purpose_classification: `${workflow_step || "unknown_step"} -> ${destination || "unknown_destination"}`,
    risk_flags: [],
  };
  if (type === "image_captcha") {
    receipt.risk_flags.push("TOS_VIOLATION_RISK", "ACCOUNT_BAN_RISK");
  }
  if (type === "phone_sms") receipt.reason_code = "BLOCKED_PHONE_VERIFICATION";
  if (type === "payment_fraud") receipt.reason_code = "BLOCKED_PAYMENT_OR_FRAUD_CHALLENGE";
  if (type === "unknown") receipt.reason_code = "CHALLENGE_UNCLASSIFIED";
  return { type, handler, receipt };
}

/**
 * Decide whether a handler attempt is allowed.
 * ctx: {attempt_count, solver_credits_ok, own_mailbox_ready, card_approved}
 */
export function attemptAllowed(type, ctx = {}) {
  const attempt_count = ctx.attempt_count || 0;
  if (attempt_count >= 1) {
    return { allowed: false, reason: "one_attempt_per_challenge", detail: "no retry loops; a new challenge is not a new attempt" };
  }
  switch (type) {
    case "email_verification":
      return ctx.own_mailbox_ready
        ? { allowed: true }
        : { allowed: false, reason: "mailbox_unavailable", log: "EMAIL_VERIFICATION_UNCLEARED" };
    case "checkbox_passive":
      return { allowed: true };
    case "image_captcha":
      return ctx.solver_credits_ok
        ? { allowed: true }
        : { allowed: false, reason: "solver_unavailable", log: "SOLVER_UNAVAILABLE" };
    case "phone_sms":
    case "payment_fraud":
    case "unknown":
      return { allowed: false, reason: "refused_class", handler: "refuse" };
    default:
      return { allowed: false, reason: "unknown_type" };
  }
}

/** Build the ChallengeRecord for the ledger/log. No secrets allowed. */
export function makeChallengeRecord({
  challenge_id,
  evaluation_id,
  trial_id,
  service_id,
  phase,
  target_origin,
  classification,
  outcome,
  reason_code,
}) {
  return {
    challenge_id,
    evaluation_id: evaluation_id || null,
    trial_id: trial_id || null,
    service_id,
    phase: phase || null,
    target_origin: target_origin || null,
    challenge_type: classification.type,
    handler: classification.handler,
    outcome, // "cleared" | "skipped" | "refused" | "failed"
    reason_code: reason_code || classification.receipt?.reason_code || null,
    risk_flags: classification.receipt?.risk_flags || [],
    account_created: false,
    // Never include: codes, tokens, screenshots bytes, solver keys.
  };
}
