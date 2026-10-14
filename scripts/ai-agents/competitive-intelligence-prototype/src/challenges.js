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
 *
 * CI-005 round 4: the registration binds phase + origin + service_id +
 * evaluation_id — all required. The origin is canonicalized at registration
 * so later comparisons are exact, not string-prefix games.
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
      if (typeof evaluation_id !== "string" || !evaluation_id) errors.push("evaluation_id required");
      if (errors.length > 0) return { ok: false, errors };
      let canonOrigin;
      try {
        canonOrigin = new URL(origin).origin;
      } catch {
        return { ok: false, errors: ["origin must be a parseable URL"] };
      }
      n += 1;
      const id = `wfreg-${n}`;
      const reg = { registration_id: id, phase, origin: canonOrigin, service_id, evaluation_id };
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
/**
 * Host-held challenge history, keyed by STABLE WORKFLOW OPERATION
 * (registration_id::handler), never by challenge_id (CI-005).
 *
 * The AUTHORIZATION gate is tryReserve(): one synchronous check-and-reserve
 * that returns granted/denied atomically (CI-005 round 4). Two callers can
 * never both observe "free" — the first synchronous call wins and the loser
 * is denied. attempts() is a read-only view for diagnostics; consume() is
 * the legacy allocator. The host persists the history via snapshot()/restore()
 * so a restart cannot re-arm a consumed attempt.
 */
export function createChallengeHistory() {
  const counts = new Map();
  return {
    consume(workflowKey) {
      if (typeof workflowKey !== "string" || !workflowKey) {
        throw new Error("consume requires a workflow attempt key (registration_id::handler)");
      }
      const next = (counts.get(workflowKey) || 0) + 1;
      counts.set(workflowKey, next);
      return next;
    },
    /**
     * Atomic check-and-reserve: grants exactly one attempt per workflow key.
     * Returns {granted:true} for the first caller, {granted:false} for every
     * later one — including after a failed/crashed handler (a crashed
     * reservation stays consumed; there is no retry). The grant is bound to
     * the resolved workflow/handler via the key; the key is stable across
     * restarts when the host persists snapshot()/restore().
     */
    tryReserve(workflowKey) {
      if (typeof workflowKey !== "string" || !workflowKey) {
        return { granted: false, reason: "invalid_workflow_key" };
      }
      if (counts.has(workflowKey)) {
        return { granted: false, reason: "already_consumed", detail: "one attempt per signup workflow/handler" };
      }
      counts.set(workflowKey, 1);
      return { granted: true, attempts: 1 };
    },
    attempts(workflowKey) {
      if (typeof workflowKey !== "string" || !workflowKey) return 0;
      return counts.get(workflowKey) || 0;
    },
    /** Durable snapshot for the host store (restart persistence contract). */
    snapshot() {
      return { counts: [...counts.entries()] };
    },
    restore(snap) {
      counts.clear();
      if (snap && Array.isArray(snap.counts)) {
        for (const [k, v] of snap.counts) {
          if (typeof k === "string" && Number.isInteger(v)) counts.set(k, v);
        }
      }
      return { ok: true };
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
/**
 * Stable workflow-operation key for attempt accounting (CI-005).
 * One attempt is allocated per signup workflow + handler, never per
 * challenge_id: a challenge-ID change or a process restart is not a new
 * attempt. The host persists the history; the key is stable across both.
 */
export function workflowAttemptKey(registration_id, handler) {
  return `${registration_id}::${handler}`;
}

/**
 * Canonicalize an observed origin for exact comparison (CI-005 round 4).
 * Returns the URL origin, or null when the input is not a parseable URL
 * (free-text destinations are covered by the target_origin binding instead).
 */
function canonOrigin(v) {
  if (typeof v !== "string" || !v) return null;
  try {
    return new URL(v).origin;
  } catch {
    return null;
  }
}

export function classifyChallenge({
  detected, workflow_step, destination, target_origin = null,
  service_id = null, evaluation_id = null, registration_id = null, registry = null,
}) {
  const step = workflow_step || "unknown_step";
  const dest = destination || target_origin || "unknown_destination";
  // CI-005: the registration is resolved against a SEPARATELY INJECTED
  // trusted registry — a caller-supplied registration-shaped object is never
  // authoritative. Unknown registration_id refuses.
  const registration =
    registry && typeof registry.get === "function" && typeof registration_id === "string"
      ? registry.get(registration_id)
      : null;
  if (!registration || typeof registration.registration_id !== "string" || registration.phase !== PERMITTED_PHASE) {
    return { type: "unknown", handler: "refuse", receipt: refuseReceipt("unknown", "UNREGISTERED_WORKFLOW", step, dest) };
  }
  if (step !== registration.phase) {
    return { type: "unknown", handler: "refuse", receipt: refuseReceipt("unknown", "PHASE_MISMATCH", step, dest) };
  }
  // CI-005 round 4: all three actual bindings are required. The challenge
  // must be independently observed on the registered origin/service/
  // evaluation — omitting one is a refusal, not an exemption from the check.
  // Origins are canonicalized (new URL().origin) before exact comparison.
  if (typeof target_origin !== "string" || !target_origin) {
    return { type: "unknown", handler: "refuse", receipt: refuseReceipt("unknown", "BINDING_REQUIRED", step, dest) };
  }
  if (typeof service_id !== "string" || !service_id) {
    return { type: "unknown", handler: "refuse", receipt: refuseReceipt("unknown", "BINDING_REQUIRED", step, dest) };
  }
  if (typeof evaluation_id !== "string" || !evaluation_id) {
    return { type: "unknown", handler: "refuse", receipt: refuseReceipt("unknown", "BINDING_REQUIRED", step, dest) };
  }
  const observedOrigin = canonOrigin(target_origin);
  if (observedOrigin !== registration.origin) {
    return { type: "unknown", handler: "refuse", receipt: refuseReceipt("unknown", "ORIGIN_MISMATCH", step, dest) };
  }
  if (service_id !== registration.service_id) {
    return { type: "unknown", handler: "refuse", receipt: refuseReceipt("unknown", "SERVICE_MISMATCH", step, dest) };
  }
  if (evaluation_id !== registration.evaluation_id) {
    return { type: "unknown", handler: "refuse", receipt: refuseReceipt("unknown", "EVALUATION_MISMATCH", step, dest) };
  }
  // The destination is resolved to its origin and compared to the
  // registration. A URL destination on an unrelated origin refuses even
  // when the observed bindings above were supplied — a valid registration
  // is not portable authority for unrelated destinations.
  const destOrigin = canonOrigin(destination);
  if (destOrigin !== null && destOrigin !== registration.origin) {
    return { type: "unknown", handler: "refuse", receipt: refuseReceipt("unknown", "DESTINATION_MISMATCH", step, dest) };
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
    registration_id: registration.registration_id,
    workflow_attempt_key: type !== "unknown" ? workflowAttemptKey(registration.registration_id, handler) : null,
  };
  if (type === "image_captcha") {
    receipt.risk_flags.push("TOS_VIOLATION_RISK", "ACCOUNT_BAN_RISK");
  }
  return { type, handler, receipt };
}

/**
 * Decide whether a handler attempt is allowed.
 * ctx: {workflowKey, history, solver_credits_ok, own_mailbox_ready}
 * Attempts are read from the durable history — a caller attempt_count is
 * ignored. Permitted handlers require history; without it they refuse.
 *
 * CI-005 round 4: this is ADVISORY (read-only). The authorization gate is
 * history.tryReserve(workflowKey) — one atomic check-and-reserve that must
 * succeed before any external submission. attemptAllowed:true followed by a
 * denied tryReserve means the handler cannot execute.
 */
export function attemptAllowed(type, ctx = {}) {
  // CI-005: attempts are keyed by stable workflow operation
  // (registration_id::handler). challenge_id is NOT an attempt key — a
  // challenge-ID change never grants a new attempt. Caller-supplied
  // attempt_count is ignored; only the host-held history counts.
  const { workflowKey, history, solver_credits_ok, own_mailbox_ready } = ctx;
  switch (type) {
    case "email_verification":
    case "checkbox_passive":
    case "image_captcha": {
      if (!workflowKey || !history || typeof history.attempts !== "function" || typeof history.consume !== "function") {
        return { allowed: false, reason: "no_workflow_history", detail: "attempts require durable host-held workflow history" };
      }
      if (history.attempts(workflowKey) >= 1) {
        return { allowed: false, reason: "one_attempt_per_workflow", detail: "one attempt per signup workflow/handler; challenge_id change is not a new attempt" };
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
