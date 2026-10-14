/**
 * ledger.js — trial lifecycle ledger per contract §11.
 *
 * State machine:
 *   PLANNED -> RESERVED -> SIGNED_UP -> EVALUATING -> CANCEL_REQUESTED
 *     -> CANCEL_VERIFIED -> CLEANED -> CLOSED
 * Exceptions: BLOCKED, EXPIRY_UNKNOWN, CANCEL_FAILED, CHARGE_DETECTED,
 *   RECOVERY_REQUIRED.
 *
 * Rules enforced here (pure logic over a provided record list):
 * - Append-only: transitions are new entries, never edits.
 * - One trial per service across all time (service_id registry).
 * - CLOSED requires cancellation evidence (CANCEL_VERIFIED first).
 * - Cancellation evidence must identify account/service, state/time, outcome.
 * - No secrets in the ledger (validated: rejects password/token/card fields).
 */

export const TRIAL_STATES = [
  "PLANNED",
  "RESERVED",
  "SIGNED_UP",
  "EVALUATING",
  "CANCEL_REQUESTED",
  "CANCEL_VERIFIED",
  "CLEANED",
  "CLOSED",
];

export const TRIAL_EXCEPTIONS = [
  "BLOCKED",
  "EXPIRY_UNKNOWN",
  "CANCEL_FAILED",
  "CHARGE_DETECTED",
  "RECOVERY_REQUIRED",
];

const LEGAL_TRANSITIONS = {
  PLANNED: ["RESERVED", "BLOCKED"],
  RESERVED: ["SIGNED_UP", "BLOCKED", "EXPIRY_UNKNOWN"],
  SIGNED_UP: ["EVALUATING", "BLOCKED", "CANCEL_REQUESTED"],
  EVALUATING: ["CANCEL_REQUESTED", "CANCEL_FAILED", "CHARGE_DETECTED", "RECOVERY_REQUIRED"],
  CANCEL_REQUESTED: ["CANCEL_VERIFIED", "CANCEL_FAILED", "RECOVERY_REQUIRED"],
  CANCEL_VERIFIED: ["CLEANED"],
  CLEANED: ["CLOSED"],
  CLOSED: [],
  BLOCKED: [],
  EXPIRY_UNKNOWN: ["BLOCKED", "CANCEL_REQUESTED"],
  CANCEL_FAILED: ["CANCEL_REQUESTED", "RECOVERY_REQUIRED"],
  CHARGE_DETECTED: ["RECOVERY_REQUIRED"],
  RECOVERY_REQUIRED: ["CANCEL_REQUESTED", "CANCEL_FAILED"],
};

const SECRET_FIELDS = ["password", "card_number", "cvv", "token", "secret", "recovery_code", "api_key"];

/** Reject any entry carrying secret material. */
export function checkNoSecrets(entry) {
  const found = [];
  const walk = (obj, path) => {
    if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) {
        if (SECRET_FIELDS.some((s) => k.toLowerCase().includes(s))) found.push(path ? `${path}.${k}` : k);
        walk(v, path ? `${path}.${k}` : k);
      }
    }
  };
  walk(entry, "");
  return found;
}

/** Cancellation evidence must meet the minimum administrative-receipt bar. */
export function validateCancellationEvidence(ev) {
  const errors = [];
  if (!ev || typeof ev !== "object") return ["evidence must be an object"];
  for (const k of ["account_identity", "cancelled_at", "outcome", "evidence_hash", "issuer"]) {
    if (!ev[k]) errors.push(`missing ${k}`);
  }
  if (ev.outcome && !["cancelled", "closed", "deleted", "no_billing"].includes(ev.outcome)) {
    errors.push(`invalid outcome: ${ev.outcome}`);
  }
  return errors;
}

export class TrialLedger {
  /** records: array of existing ledger entries (append-only log). */
  constructor(records = []) {
    this.records = [...records];
  }

  currentState(trial_id) {
    const recs = this.records.filter((r) => r.trial_id === trial_id);
    if (recs.length === 0) return null;
    return recs[recs.length - 1].to_state;
  }

  serviceHasTrial(service_id) {
    return this.records.some((r) => r.service_id === service_id && r.to_state !== "BLOCKED");
  }

  transition({ trial_id, service_id, to_state, actor, evidence = null, note = null, at = null }) {
    const errors = [];
    const from_state = this.currentState(trial_id);

    if (!TRIAL_STATES.includes(to_state) && !TRIAL_EXCEPTIONS.includes(to_state)) {
      errors.push(`unknown state: ${to_state}`);
    }
    if (from_state === null && to_state !== "PLANNED") {
      errors.push(`new trial must start at PLANNED (got ${to_state})`);
    }
    if (from_state !== null && !LEGAL_TRANSITIONS[from_state]?.includes(to_state)) {
      errors.push(`illegal transition ${from_state} -> ${to_state}`);
    }
    if (to_state === "PLANNED" && this.serviceHasTrial(service_id)) {
      errors.push(`one trial per service: ${service_id} already has a trial`);
    }
    if (to_state === "CANCEL_VERIFIED") {
      errors.push(...validateCancellationEvidence(evidence).map((e) => `cancellation evidence: ${e}`));
    }
    if (to_state === "CLOSED" && from_state !== "CLEANED") {
      errors.push("CLOSED requires CLEANED (cancellation evidence verified first)");
    }
    const secrets = checkNoSecrets({ evidence, note });
    if (secrets.length > 0) errors.push(`secret fields in ledger: ${secrets.join(", ")}`);

    if (errors.length > 0) return { ok: false, errors };

    const entry = {
      seq: this.records.length,
      trial_id,
      service_id,
      from_state,
      to_state,
      actor,
      at: at || new Date().toISOString(),
      evidence,
      note,
    };
    this.records.push(entry);
    return { ok: true, entry };
  }

  /** True only when the evaluation is genuinely complete. */
  isComplete(trial_id) {
    return this.currentState(trial_id) === "CLOSED";
  }

  /** Trials with outstanding obligations (account open, card held, etc.). */
  outstanding() {
    const byTrial = new Map();
    for (const r of this.records) {
      byTrial.set(r.trial_id, r.to_state);
    }
    return [...byTrial.entries()]
      .filter(([, s]) => s !== "CLOSED" && s !== "BLOCKED")
      .map(([trial_id, state]) => ({ trial_id, state }));
  }
}
