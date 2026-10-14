/**
 * challenges.js — autonomous challenge classification per contract §12.
 *
 * One handler attempt per signup challenge workflow. No retry loops.
 * Phone/SMS and payment/fraud challenges are NEVER handled.
 * Every classification produces a ChallengeRecord; unclear purpose -> skip.
 *
 * Trust model (CI-005):
 * - Handlers require a TRUSTED workflow registration (host-registered
 *   own-trial-signup binding). Without it, every challenge is unknown/refuse.
 * - Prohibited purposes (payment/fraud/phone) WIN over image/checkbox/email
 *   wording — a payment CAPTCHA is payment_fraud, never image_captcha.
 * - Attempt counts come from a durable host-held history keyed by
 *   challenge_id, never a caller-supplied attempt_count.
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

/** Only this phase may use the permitted handlers. */
export const PERMITTED_PHASE = "trial_signup";

/**
 * Host-held workflow registry. The host registers the genuine own-trial
 * signup workflow; classification binds challenges to that registration.
 */
export function createWorkflowRegistry() {
  const regs = new Map();
  let n = 0;
  return {
    register({ phase, origin, service_id, evaluation_id }) {
      const errors = [];
      if (typeof phase !== "string" || !phase) errors.push("phase required");
      if (typeof origin !== "string" || !origin) errors.push("origin required");
      if (typeof service_id !== "string" || !service_id) errors.push("service_id required");
      if (errors.length > 0) return { ok: false, errors };
      n += 1;
      const id = `wfreg-${n}`;
      const reg = { registration_id: id, phase, origin, service_id, evaluation_id: evaluation_id || null };
      regs.set(id, reg);
      return { ok: true, registration: { ...reg } };
    },
    get(registration_id) {
      const r = regs.get(registration_id);
      return r ? { ...r } : null;
    },
  };
}

/** Durable per-challenge attempt history (host-held). */
export function createChallengeHistory() {
  const counts = new Map();
  return {
    record(challenge_id, outcome) {
      const next = (counts.get(challenge_id) || 0) + 1;
      counts.set(challenge_id, next);
      return next;
    },
    attempts(challenge_id) {
      return counts.get(challenge_id) || 0;
    },
  };
}

// Prohibited purposes are checked FIRST — wording never overrides purpose.
const PROHIBITED = [
  {
    re: /payment|card|fraud|3d.?secure|issuer|billing|checkout|order.?total/i,
    type: "payment_fraud",
    reason_code: "BLOCKED_PAYMENT_OR_FRAUD_CHALLENGE",
  },
  {
    re: /phone|sms|text.?message|mobile.?number|voice.?call|authenticator.?app/i,
    type: "phone_sms",
    reason_code: "BLOCKED_PHONE_VERIFICATION",
  },
];

function refuseReceipt(type, reason_code, workflow_step, destination) {
  return {
    challenge_type: type,
    handler: "refuse",
    purpose_classification: `${workflow_step || "unknown_step"} -> ${destination || "unknown_destination"}`,
    risk_flags: [],
    reason_code,
  };
}

/**
 * Classify a detected challenge. Returns {type, handler, receipt}.
 * registration: a trusted registration object from createWorkflowRegistry().
 * Without a valid own-trial-signup registration, everything is unknown/refuse.
 * The registered phase must match workflow_step — a spoofed page purpose
 * that disagrees with the registration refuses.
 */
export function classifyChallenge({ detected, workflow_step, destination, registration }) {
  const step = workflow_step || "unknown_step";
  const dest = destination || "unknown_destination";
  if (
    !registration ||
    typeof registration.registration_id !== "string" ||
    registration.phase !== PERMITTED_PHASE
  ) {
    return { type: "unknown", handler: "refuse", receipt: refuseReceipt("unknown", "UNREGISTERED_WORKFLOW", step, dest) };
  }
  if (step !== registration.phase) {
    return { type: "unknown", handler: "refuse", receipt: refuseReceipt("unknown", "PHASE_MISMATCH", step, dest) };
  }

  // Purpose first: prohibited payment/fraud/phone wins over any wording.
  const hay = `${detected || ""} ${step} ${dest}`;
  for (const p of PROHIBITED) {
    if (p.re.test(hay)) {
      return { type: p.type, handler: "refuse", receipt: refuseReceipt(p.type, p.reason_code, step, dest) };
    }
  }

  const text = `${detected || ""}`.toLowerCase();
  let type = "unknown";
  let reason_code = "CHALLENGE_UNCLASSIFIED";
  if (/email|mailbox|verification (code|link)/.test(text)) {
    type = "email_verification";
    reason_code = null;
  } else if (/checkbox|passive|browser check|cloudflare challenge/.test(text)) {
    type = "checkbox_passive";
    reason_code = null;
  } else if (/captcha|image|labeling|recaptcha|hcaptcha/.test(text)) {
    type = "image_captcha";
    reason_code = null;
  }

  const handler = HANDLERS[type];
  const receipt = {
    challenge_type: type,
    handler,
    purpose_classification: `${step} -> ${dest}`,
    risk_flags: [],
    reason_code,
  };
  if (type === "image_captcha") {
    receipt.risk_flags.push("TOS_VIOLATION_RISK", "ACCOUNT_BAN_RISK");
  }
  return { type, handler, receipt };
}

/**
 * Decide whether a handler attempt is allowed.
 * ctx: {challenge_id, history, solver_credits_ok, own_mailbox_ready}
 * Attempts are read from the durable history — a caller attempt_count is
 * ignored. Permitted handlers require history; without it they refuse.
 */
export function attemptAllowed(type, ctx = {}) {
  const { challenge_id, history, solver_credits_ok, own_mailbox_ready } = ctx;
  switch (type) {
    case "email_verification":
    case "checkbox_passive":
    case "image_captcha": {
      if (!challenge_id || !history || typeof history.attempts !== "function") {
        return { allowed: false, reason: "no_workflow_history", detail: "attempts require durable host-held history" };
      }
      if (history.attempts(challenge_id) >= 1) {
        return { allowed: false, reason: "one_attempt_per_challenge", detail: "no retry loops; a new challenge is not a new attempt" };
      }
      if (type === "email_verification") {
        return own_mailbox_ready
          ? { allowed: true }
          : { allowed: false, reason: "mailbox_unavailable", log: "EMAIL_VERIFICATION_UNCLEARED" };
      }
      if (type === "image_captcha") {
        return solver_credits_ok
          ? { allowed: true }
          : { allowed: false, reason: "solver_unavailable", log: "SOLVER_UNAVAILABLE" };
      }
      return { allowed: true };
    }
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
