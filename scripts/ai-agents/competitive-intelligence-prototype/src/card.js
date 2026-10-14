/**
 * card.js — optional reusable prepaid card registry per contract §11.
 *
 * - Exactly ONE card. $50 aggregate ceiling across all history (never resets).
 * - Lifecycle: FREE -> RESERVED -> ATTACHED -> CANCEL_PENDING -> RECONCILING -> FREE.
 * - Card attachment requires a Jason issuance approval REGISTERED in the
 *   host's issuance store. A truthy object is not approval; unregistered
 *   issuance IDs refuse. Until registration, every attach attempt refuses
 *   (card-free research continues regardless).
 * - Reserve/attach require the live interlock lease (holder/generation match).
 * - All money fields are strict non-negative integers (cents). Exposure is
 *   spent + holds, where settled amounts move holds->spent without double
 *   counting; the cap is enforced BEFORE any mutation.
 * - No FREE while holds, charges, cancellation, or cleanup are outstanding.
 * - Reassignment requires evidenced cancellation + reconciliation first.
 * - QUARANTINED/CANCEL_FAILED freezes reassignment; no second card, no rotation.
 * - Single-card durable store: snapshot()/restore() + createCardStore().
 */

export const CARD_STATES = ["FREE", "RESERVED", "ATTACHED", "CANCEL_PENDING", "RECONCILING", "QUARANTINED"];
export const AGGREGATE_CAP_CENTS = 5000; // $50.00

const LEGAL = {
  FREE: ["RESERVED", "QUARANTINED"],
  RESERVED: ["ATTACHED", "FREE", "QUARANTINED"],
  ATTACHED: ["CANCEL_PENDING", "QUARANTINED"],
  CANCEL_PENDING: ["RECONCILING", "QUARANTINED"],
  RECONCILING: ["FREE", "QUARANTINED"],
  QUARANTINED: [],
};

const ISSUANCE_KEYS = ["approved_by", "approved_at", "card_registry_id", "issuer"];
const CANCEL_OUTCOMES = ["cancelled", "closed", "deleted", "no_billing"];

function isValidDateTime(s) {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

/** Schema-valid issuance registration (closed). Truthiness is not approval. */
export function validateIssuance(iss) {
  const errors = [];
  if (!iss || typeof iss !== "object" || Array.isArray(iss)) return ["issuance must be an object"];
  for (const k of Object.keys(iss)) {
    if (!ISSUANCE_KEYS.includes(k)) errors.push(`unknown field ${k} (closed issuance schema)`);
  }
  if (typeof iss.approved_by !== "string" || !iss.approved_by) errors.push("approved_by required");
  if (!isValidDateTime(iss.approved_at)) errors.push("approved_at must be ISO date-time");
  if (typeof iss.card_registry_id !== "string" || !iss.card_registry_id) errors.push("card_registry_id required");
  if (typeof iss.issuer !== "string" || !iss.issuer) errors.push("issuer required");
  return errors;
}

/**
 * Host-held issuance store. Jason's approval is registered here once;
 * attach() looks the issuance_id up — it never trusts a caller object.
 */
export function createIssuanceStore() {
  const issuances = new Map();
  return {
    register(issuance) {
      const errors = validateIssuance(issuance);
      if (errors.length > 0) return { ok: false, errors };
      const id = issuance.card_registry_id;
      if (issuances.has(id)) return { ok: false, errors: ["duplicate issuance registration"] };
      issuances.set(id, { ...issuance });
      return { ok: true, issuance_id: id };
    },
    get(issuance_id) {
      return issuances.get(issuance_id) || null;
    },
  };
}

function validateCents(n, name) {
  if (!Number.isInteger(n) || n < 0) return `${name} must be a non-negative integer (cents)`;
  return null;
}

/** Cancellation evidence must bind to the card holder's trial/service/account. */
export function validateCardCancellation(ev, holder) {
  const errors = [];
  if (!ev || typeof ev !== "object") return ["cancellation evidence must be an object"];
  for (const k of ["trial_id", "service_id", "account_identity", "cancelled_at", "outcome", "evidence_hash", "issuer"]) {
    if (!ev[k]) errors.push(`missing ${k}`);
  }
  if (ev.outcome && !CANCEL_OUTCOMES.includes(ev.outcome)) errors.push(`invalid outcome: ${ev.outcome}`);
  if (ev.cancelled_at && !isValidDateTime(ev.cancelled_at)) errors.push("cancelled_at must be ISO date-time");
  if (holder) {
    if (ev.trial_id !== holder.trial_id) errors.push("trial_id does not match the card holder");
    if (ev.service_id !== holder.service_id) errors.push("service_id does not match the card holder");
  }
  return errors;
}

/** Durable single-card store (fixture): the host persists snapshots. */
export function createCardStore() {
  let snap = null;
  return {
    save(s) {
      snap = JSON.parse(JSON.stringify(s));
    },
    load() {
      return snap ? JSON.parse(JSON.stringify(snap)) : null;
    },
  };
}

export class CardRegistry {
  /**
   * issuanceStore: from createIssuanceStore(), held by the host.
   * Without a store, attach always refuses (no issuance can be verified).
   */
  constructor(issuanceStore = null) {
    this.issuanceStore = issuanceStore;
    this.state = "FREE";
    this.holder = null; // {service_id, trial_id, evaluation_id, generation}
    this.spentCents = 0; // aggregate settled charges across all history, never resets
    this.holdsCents = 0; // current outstanding holds
    this.cleanupVerified = false;
    this._lastRelease = null; // {evaluation_id, generation, service_id, trial_id, at}
    this.history = [];
  }

  get aggregateExposureCents() {
    return this.spentCents + this.holdsCents;
  }

  _record(event) {
    this.history.push({ at: new Date().toISOString(), state: this.state, ...event });
  }

  _checkGeneration(generation) {
    if (!Number.isInteger(generation) || generation <= 0) return "invalid_generation";
    if (!this.holder || this.holder.generation !== generation) return "stale_generation";
    return null;
  }

  _checkInterlock(interlock, { evaluation_id, service_id, generation }) {
    if (!interlock || typeof interlock.holder !== "function") return "interlock_required";
    const h = interlock.holder();
    if (!h || h.evaluation_id !== evaluation_id || h.service_id !== service_id || h.generation !== generation) {
      return "interlock_mismatch";
    }
    return null;
  }

  reserve({ service_id, trial_id, evaluation_id, generation, interlock }) {
    if (this.state !== "FREE") return { ok: false, reason: "card_not_free", state: this.state };
    const il = this._checkInterlock(interlock, { evaluation_id, service_id, generation });
    if (il) return { ok: false, reason: il };
    this.state = "RESERVED";
    this.holder = { service_id, trial_id, evaluation_id, generation };
    this.cleanupVerified = false;
    this._record({ event: "reserve", service_id, trial_id, evaluation_id, generation });
    return { ok: true };
  }

  attach({ issuance_id, service_id, trial_id, evaluation_id, generation, interlock }) {
    const issuance = this.issuanceStore ? this.issuanceStore.get(issuance_id) : null;
    if (!issuance) {
      return {
        ok: false,
        reason: "issuance_unregistered",
        detail: "no registered Jason issuance approval; card-free paths only",
      };
    }
    if (!["FREE", "RESERVED"].includes(this.state)) {
      return { ok: false, reason: "card_not_free", state: this.state, holder: this.holder };
    }
    if (this.state === "RESERVED") {
      const h = this.holder;
      if (!h || h.service_id !== service_id || h.trial_id !== trial_id || h.evaluation_id !== evaluation_id) {
        return { ok: false, reason: "holder_mismatch", detail: "attach must continue the reservation holder" };
      }
    }
    const il = this._checkInterlock(interlock, { evaluation_id, service_id, generation });
    if (il) return { ok: false, reason: il };
    this.state = "ATTACHED";
    this.holder = { service_id, trial_id, evaluation_id, generation };
    this.cleanupVerified = false;
    this._record({ event: "attach", service_id, trial_id, evaluation_id, generation, issuance_id });
    return { ok: true };
  }

  beginCancel({ generation }) {
    if (!["ATTACHED", "RESERVED"].includes(this.state)) return { ok: false, reason: "bad_state", state: this.state };
    const g = this._checkGeneration(generation);
    if (g) return { ok: false, reason: g };
    this.state = "CANCEL_PENDING";
    this._record({ event: "begin_cancel" });
    return { ok: true };
  }

  /**
   * Reconciliation requires bound cancellation evidence + settled finances.
   * Cents semantics (no double counting):
   *   settled_cents: previously-held amounts now captured (holds -> spent)
   *   charge_cents:  new charges (new exposure)
   *   hold_cents:    new outstanding holds (replaces holdsCents)
   * Cap is enforced on post-mutation exposure BEFORE mutating.
   */
  reconcile({ cancellation_evidence, settled_cents = 0, hold_cents = 0, charge_cents = 0, generation }) {
    if (this.state !== "CANCEL_PENDING") return { ok: false, reason: "bad_state", state: this.state };
    const g = this._checkGeneration(generation);
    if (g) return { ok: false, reason: g };
    for (const [n, v] of [["settled_cents", settled_cents], ["hold_cents", hold_cents], ["charge_cents", charge_cents]]) {
      const e = validateCents(v, n);
      if (e) return { ok: false, reason: "invalid_amount", detail: e };
    }
    const evErrors = validateCardCancellation(cancellation_evidence, this.holder);
    if (evErrors.length > 0) {
      return { ok: false, reason: "no_cancellation_evidence", errors: evErrors };
    }
    if (settled_cents > this.holdsCents) {
      return { ok: false, reason: "settled_exceeds_holds", detail: `settled ${settled_cents} > holds ${this.holdsCents}` };
    }
    const exposure = this.spentCents + charge_cents + settled_cents + hold_cents;
    if (exposure > AGGREGATE_CAP_CENTS) {
      this.state = "QUARANTINED";
      this._record({ event: "cap_exceeded", exposure });
      return { ok: false, reason: "aggregate_cap_exceeded", cap_cents: AGGREGATE_CAP_CENTS, exposure };
    }
    this.spentCents += charge_cents + settled_cents;
    this.holdsCents = hold_cents;
    this.state = "RECONCILING";
    this._record({ event: "reconcile", charge_cents, settled_cents, hold_cents });
    return { ok: true };
  }

  /** Cleanup must be verified (bound receipt) before the card goes FREE. */
  verifyCleanup({ generation, cleanup_receipt }) {
    if (this.state !== "RECONCILING") return { ok: false, reason: "bad_state", state: this.state };
    const g = this._checkGeneration(generation);
    if (g) return { ok: false, reason: g };
    const h = this.holder;
    const errors = [];
    if (!cleanup_receipt || typeof cleanup_receipt !== "object") errors.push("cleanup receipt required");
    else {
      if (cleanup_receipt.trial_id !== h.trial_id) errors.push("trial_id mismatch");
      if (cleanup_receipt.service_id !== h.service_id) errors.push("service_id mismatch");
      if (typeof cleanup_receipt.account_identity !== "string" || !cleanup_receipt.account_identity) {
        errors.push("account_identity required");
      }
    }
    if (errors.length > 0) return { ok: false, reason: "cleanup_unverified", errors };
    this.cleanupVerified = true;
    this._record({ event: "cleanup_verified" });
    return { ok: true };
  }

  /** No FREE while holds, charges, or unverified cleanup remain. */
  releaseToFree({ generation }) {
    if (this.state !== "RECONCILING") return { ok: false, reason: "bad_state", state: this.state };
    const g = this._checkGeneration(generation);
    if (g) return { ok: false, reason: g };
    if (this.holdsCents !== 0) {
      return { ok: false, reason: "outstanding_holds", holds_cents: this.holdsCents };
    }
    if (!this.cleanupVerified) {
      return { ok: false, reason: "cleanup_unverified" };
    }
    const h = this.holder;
    this._lastRelease = {
      evaluation_id: h.evaluation_id,
      generation: h.generation,
      service_id: h.service_id,
      trial_id: h.trial_id,
      at: new Date().toISOString(),
    };
    this.state = "FREE";
    this.holder = null;
    this.cleanupVerified = false;
    this._record({ event: "release_free" });
    return { ok: true };
  }

  /** Last card release record (for the interlock closure proof). */
  lastRelease() {
    return this._lastRelease ? { ...this._lastRelease } : null;
  }

  quarantine(reason) {
    this.state = "QUARANTINED";
    this._record({ event: "quarantine", reason });
    return { ok: true };
  }

  /** Refuse any second card, rotation, or top-up. */
  requestSecondCard() {
    return { ok: false, reason: "second_card_denied", detail: "exactly one card; replacement is a new Jason decision" };
  }
  requestTopUp() {
    return { ok: false, reason: "topup_denied", detail: "$50 is an aggregate ceiling; no reload authorized" };
  }

  /** Durable snapshot for the single-card store. */
  snapshot() {
    return {
      state: this.state,
      holder: this.holder ? { ...this.holder } : null,
      spentCents: this.spentCents,
      holdsCents: this.holdsCents,
      cleanupVerified: this.cleanupVerified,
      lastRelease: this._lastRelease ? { ...this._lastRelease } : null,
      history: this.history.map((h) => ({ ...h })),
    };
  }

  static restore(issuanceStore, snap) {
    const c = new CardRegistry(issuanceStore);
    c.state = snap.state;
    c.holder = snap.holder ? { ...snap.holder } : null;
    c.spentCents = snap.spentCents;
    c.holdsCents = snap.holdsCents;
    c.cleanupVerified = snap.cleanupVerified;
    c._lastRelease = snap.lastRelease ? { ...snap.lastRelease } : null;
    c.history = (snap.history || []).map((h) => ({ ...h }));
    return c;
  }
}
