/**
 * ledger.js — trial lifecycle ledger per contract §11.
 *
 * State machine:
 *   PLANNED -> RESERVED -> SIGNED_UP -> EVALUATING -> CANCEL_REQUESTED
 *     -> CANCEL_VERIFIED -> CLEANED -> CLOSED
 * Exceptions: BLOCKED (pre-account safe skip, terminal, no obligations),
 *   BLOCKED_UNRESOLVED (post-account block — obligations persist until the
 *   account is cancelled/closed with bound evidence), EXPIRY_UNKNOWN,
 *   CANCEL_FAILED, CHARGE_DETECTED, RECOVERY_REQUIRED.
 *
 * Rules enforced here (pure logic over a host-provided record store):
 * - Append-only: transitions are new frozen entries, never edits.
 * - One trial per service while obligations are outstanding.
 * - CI-003: one trial per service across ALL time. serviceConsumed() is
 *   derived from the append-only history (any SIGNED_UP record), so the
 *   permanent reservation survives restarts by construction — the history
 *   IS the registry. CLOSED trials never free another trial entitlement;
 *   a pre-account BLOCKED skip never consumed and stays plannable.
 * - Trial/service identity is immutable once PLANNED.
 * - SIGNED_UP registers the account identity; cancellation and cleanup
 *   evidence must bind to that same account/service or it is refused.
 * - CLOSED requires CANCEL_VERIFIED then CLEANED (with cleanup receipt).
 * - BLOCKED_UNRESOLVED keeps the trial in outstanding() — a new
 *   reservation or interlock release cannot proceed past it.
 * - No secrets in the ledger (validated: rejects password/token/card fields).
 * - Durability: the host supplies a store (createLedgerStore); two ledger
 *   instances over one store share state, so restarts cannot forget history
 *   and parallel instances cannot double-reserve.
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
  "BLOCKED_UNRESOLVED",
  "EXPIRY_UNKNOWN",
  "CANCEL_FAILED",
  "CHARGE_DETECTED",
  "RECOVERY_REQUIRED",
];

const LEGAL_TRANSITIONS = {
  PLANNED: ["RESERVED", "BLOCKED"],
  RESERVED: ["SIGNED_UP", "BLOCKED", "EXPIRY_UNKNOWN"],
  SIGNED_UP: ["EVALUATING", "CANCEL_REQUESTED", "BLOCKED_UNRESOLVED"],
  EVALUATING: ["CANCEL_REQUESTED", "CANCEL_FAILED", "CHARGE_DETECTED", "RECOVERY_REQUIRED", "BLOCKED_UNRESOLVED"],
  CANCEL_REQUESTED: ["CANCEL_VERIFIED", "CANCEL_FAILED", "RECOVERY_REQUIRED", "BLOCKED_UNRESOLVED"],
  CANCEL_VERIFIED: ["CLEANED"],
  CLEANED: ["CLOSED"],
  CLOSED: [],
  BLOCKED: [],
  BLOCKED_UNRESOLVED: ["CANCEL_REQUESTED"],
  EXPIRY_UNKNOWN: ["BLOCKED", "CANCEL_REQUESTED"],
  CANCEL_FAILED: ["CANCEL_REQUESTED", "RECOVERY_REQUIRED"],
  CHARGE_DETECTED: ["RECOVERY_REQUIRED"],
  RECOVERY_REQUIRED: ["CANCEL_REQUESTED", "CANCEL_FAILED"],
};

const CANCEL_OUTCOMES = ["cancelled", "closed", "deleted", "no_billing"];

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

function deepFreeze(v) {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    for (const k of Object.keys(v)) deepFreeze(v[k]);
    Object.freeze(v);
  }
  return v;
}

/**
 * Cancellation evidence must bind to THIS trial: the receipt's account
 * identity and service must match what SIGNED_UP registered. Truthy fields
 * alone are not evidence.
 */
export function validateCancellationEvidence(ev, binding = null) {
  const errors = [];
  if (!ev || typeof ev !== "object") return ["evidence must be an object"];
  for (const k of ["account_identity", "service_id", "cancelled_at", "outcome", "evidence_hash", "issuer"]) {
    if (!ev[k]) errors.push(`missing ${k}`);
  }
  if (ev.outcome && !CANCEL_OUTCOMES.includes(ev.outcome)) {
    errors.push(`invalid outcome: ${ev.outcome}`);
  }
  if (ev.cancelled_at && Number.isNaN(Date.parse(ev.cancelled_at))) errors.push("cancelled_at must be ISO date-time");
  if (binding) {
    if (ev.account_identity !== binding.account_identity) errors.push("account_identity does not match the registered trial account");
    if (ev.service_id !== binding.service_id) errors.push("service_id does not match the trial service");
  }
  return errors;
}

/** Cleanup evidence must bind to the trial and confirm cleanup happened. */
export function validateCleanupEvidence(ev, binding = null) {
  const errors = [];
  if (!ev || typeof ev !== "object") return ["cleanup evidence must be an object"];
  for (const k of ["account_identity", "service_id", "cleanup_receipt", "cleaned_at"]) {
    if (!ev[k]) errors.push(`missing ${k}`);
  }
  if (ev.cleaned_at && Number.isNaN(Date.parse(ev.cleaned_at))) errors.push("cleaned_at must be ISO date-time");
  if (binding) {
    if (ev.account_identity !== binding.account_identity) errors.push("account_identity does not match the registered trial account");
    if (ev.service_id !== binding.service_id) errors.push("service_id does not match the trial service");
  }
  return errors;
}

/**
 * Durable append-only record store (fixture implementation of the host-store
 * contract). All entries are frozen on append; load() returns the live frozen
 * entries. Two ledgers sharing one store see the same history.
 */
export function createLedgerStore(initialRecords = []) {
  const records = [];
  const store = {
    append(entry) {
      const frozen = Object.freeze({ ...deepFreeze({ ...entry }), seq: records.length });
      records.push(frozen);
      return frozen;
    },
    load() {
      return [...records];
    },
  };
  for (const r of initialRecords) store.append(r);
  return store;
}

export class TrialLedger {
  /**
   * storeOrRecords: a store from createLedgerStore(), or a plain array of
   * existing entries (wrapped in a private store).
   */
  constructor(storeOrRecords = []) {
    this.store =
      storeOrRecords && typeof storeOrRecords.append === "function" && typeof storeOrRecords.load === "function"
        ? storeOrRecords
        : createLedgerStore(storeOrRecords);
  }

  get records() {
    return this.store.load();
  }

  _trialRecords(trial_id) {
    return this.records.filter((r) => r.trial_id === trial_id);
  }

  currentState(trial_id) {
    const recs = this._trialRecords(trial_id);
    if (recs.length === 0) return null;
    return recs[recs.length - 1].to_state;
  }

  /** evaluation_id bound at PLANNED (binds the interlock lease). */
  evaluationOf(trial_id) {
    const recs = this._trialRecords(trial_id);
    return recs.length === 0 ? null : recs[0].evaluation_id || null;
  }

  /** service_id bound at PLANNED (immutable across the trial lifecycle). */
  serviceOf(trial_id) {
    const recs = this._trialRecords(trial_id);
    return recs.length === 0 ? null : recs[0].service_id || null;
  }

  /** account identity registered at SIGNED_UP. */
  accountOf(trial_id) {
    const rec = this._trialRecords(trial_id).find((r) => r.to_state === "SIGNED_UP");
    return rec?.evidence?.account_identity || null;
  }

  /** True when the trial ended as a pre-account safe skip (no obligations). */
  isPreAccountSkip(trial_id) {
    const recs = this._trialRecords(trial_id);
    if (recs.length === 0 || recs[recs.length - 1].to_state !== "BLOCKED") return false;
    return recs.every((r) => ["PLANNED", "RESERVED", "BLOCKED"].includes(r.to_state));
  }

  _latestByTrial() {
    const byTrial = new Map();
    for (const r of this.records) byTrial.set(r.trial_id, r);
    return byTrial;
  }

  /** A service has an outstanding trial unless every trial is CLOSED or a pre-account skip. */
  serviceHasOutstandingTrial(service_id) {
    for (const [, r] of this._latestByTrial()) {
      if (r.service_id !== service_id) continue;
      if (r.to_state === "CLOSED") continue;
      if (r.to_state === "BLOCKED" && this.isPreAccountSkip(r.trial_id)) continue;
      return true;
    }
    return false;
  }

  /**
   * CI-003: permanent service reservation. True when ANY trial for this
   * service ever reached SIGNED_UP. Derived from the append-only record
   * history, so it survives process restarts by construction — the history
   * IS the registry; there is no separate in-memory flag to lose.
   *
   * A service consumed this way never becomes plannable again: CLOSED
   * trials never free another trial entitlement (cancellation evidence is
   * what closes the trial, not what re-arms the service). A pre-account
   * BLOCKED skip never consumed (it never signed up), so it stays plannable.
   */
  serviceConsumed(service_id) {
    return this.records.some((r) => r.service_id === service_id && r.to_state === "SIGNED_UP");
  }

  transition({ trial_id, service_id, to_state, actor, evidence = null, note = null, at = null, evaluation_id = null }) {
    const errors = [];
    const trialRecs = this._trialRecords(trial_id);
    const from_state = trialRecs.length === 0 ? null : trialRecs[trialRecs.length - 1].to_state;

    if (!TRIAL_STATES.includes(to_state) && !TRIAL_EXCEPTIONS.includes(to_state)) {
      errors.push(`unknown state: ${to_state}`);
    }
    if (from_state === null && to_state !== "PLANNED") {
      errors.push(`new trial must start at PLANNED (got ${to_state})`);
    }
    if (from_state !== null && !LEGAL_TRANSITIONS[from_state]?.includes(to_state)) {
      errors.push(`illegal transition ${from_state} -> ${to_state}`);
    }
    // Identity is immutable once PLANNED.
    const expectedService = trialRecs.length === 0 ? null : trialRecs[0].service_id;
    if (expectedService !== null && service_id !== expectedService) {
      errors.push(`service identity is immutable: ${expectedService} != ${service_id}`);
    }
    const expectedEval = trialRecs.length === 0 ? null : trialRecs[0].evaluation_id || null;
    if (expectedEval !== null && evaluation_id !== null && evaluation_id !== expectedEval) {
      errors.push(`evaluation identity is immutable: ${expectedEval} != ${evaluation_id}`);
    }
    if (to_state === "PLANNED" && this.serviceHasOutstandingTrial(service_id)) {
      errors.push(`one trial per service: ${service_id} has an outstanding trial`);
    }
    // CI-003: permanent reservation — a service that ever signed up can never
    // be planned again, even after CLOSED. Cancellation evidence closes the
    // trial; it does not re-arm the service entitlement.
    if (to_state === "PLANNED" && this.serviceConsumed(service_id)) {
      errors.push(`one trial per service across all time: ${service_id} already consumed its trial (CLOSED trials never free another)`);
    }
    if (to_state === "SIGNED_UP") {
      if (!evidence || typeof evidence.account_identity !== "string" || !evidence.account_identity) {
        errors.push("SIGNED_UP requires evidence.account_identity (account registration)");
      }
    }
    const binding =
      expectedService !== null
        ? { account_identity: this.accountOf(trial_id), service_id: expectedService }
        : null;
    if (to_state === "CANCEL_VERIFIED") {
      errors.push(...validateCancellationEvidence(evidence, binding).map((e) => `cancellation evidence: ${e}`));
    }
    if (to_state === "CLEANED") {
      errors.push(...validateCleanupEvidence(evidence, binding).map((e) => `cleanup evidence: ${e}`));
    }
    if (to_state === "CLOSED" && from_state !== "CLEANED") {
      errors.push("CLOSED requires CLEANED (cancellation evidence verified first)");
    }
    const secrets = checkNoSecrets({ evidence, note });
    if (secrets.length > 0) errors.push(`secret fields in ledger: ${secrets.join(", ")}`);

    if (errors.length > 0) return { ok: false, errors };

    const entry = this.store.append({
      trial_id,
      service_id: expectedService || service_id,
      from_state,
      to_state,
      actor,
      at: at || new Date().toISOString(),
      evidence: evidence ? JSON.parse(JSON.stringify(evidence)) : null,
      note,
      evaluation_id: expectedEval || evaluation_id || null,
    });
    return { ok: true, entry };
  }

  /** True only when the evaluation is genuinely complete. */
  isComplete(trial_id) {
    return this.currentState(trial_id) === "CLOSED";
  }

  /**
   * Trials with outstanding obligations. A post-account BLOCKED_UNRESOLVED
   * stays outstanding — the account was never cancelled.
   */
  outstanding() {
    const out = [];
    for (const [trial_id, r] of this._latestByTrial()) {
      if (r.to_state === "CLOSED") continue;
      if (r.to_state === "BLOCKED" && this.isPreAccountSkip(trial_id)) continue;
      out.push({
        trial_id,
        state: r.to_state,
        obligation: r.to_state === "BLOCKED_UNRESOLVED" ? "account_closure_required" : "completion_required",
      });
    }
    return out;
  }
}
