/**
 * card.js — optional reusable prepaid card registry per contract §11.
 *
 * - Exactly ONE card. $50 aggregate ceiling across all history (never resets).
 * - Lifecycle: FREE -> RESERVED -> ATTACHED -> CANCEL_PENDING -> RECONCILING -> FREE.
 * - Card attachment requires Jason's issuance approval on record. Until then,
 *   every attach attempt refuses (card-free research continues regardless).
 * - Reassignment requires evidenced cancellation + reconciliation first.
 * - QUARANTINED/CANCEL_FAILED freezes reassignment; no second card, no rotation.
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

export class CardRegistry {
  /**
   * issuance: null until Jason approves, else
   *   {approved_by, approved_at, card_registry_id, issuer}
   */
  constructor(issuance = null) {
    this.issuance = issuance;
    this.state = "FREE";
    this.holder = null; // {service_id, trial_id, evaluation_id, generation}
    this.spentCents = 0; // aggregate across all history, never resets
    this.holdsCents = 0;
    this.history = [];
  }

  get aggregateExposureCents() {
    return this.spentCents + this.holdsCents;
  }

  _record(event) {
    this.history.push({ at: new Date().toISOString(), state: this.state, ...event });
  }

  attach({ service_id, trial_id, evaluation_id, generation }) {
    if (!this.issuance) {
      return { ok: false, reason: "no_issuance_approval", detail: "Jason has not approved card issuance; card-free paths only" };
    }
    if (this.state !== "FREE") {
      return { ok: false, reason: "card_not_free", state: this.state, holder: this.holder };
    }
    this.state = "ATTACHED";
    this.holder = { service_id, trial_id, evaluation_id, generation };
    this._record({ event: "attach", service_id, trial_id });
    return { ok: true };
  }

  reserve({ service_id, trial_id }) {
    if (this.state !== "FREE") return { ok: false, reason: "card_not_free", state: this.state };
    this.state = "RESERVED";
    this.holder = { service_id, trial_id };
    this._record({ event: "reserve", service_id });
    return { ok: true };
  }

  beginCancel() {
    if (!["ATTACHED", "RESERVED"].includes(this.state)) return { ok: false, reason: "bad_state", state: this.state };
    this.state = "CANCEL_PENDING";
    this._record({ event: "begin_cancel" });
    return { ok: true };
  }

  /** Reconciliation requires cancellation evidence + settled finances. */
  reconcile({ cancellation_evidence_ok, settled_cents = 0, hold_cents = 0, charge_cents = 0 }) {
    if (this.state !== "CANCEL_PENDING") return { ok: false, reason: "bad_state", state: this.state };
    if (!cancellation_evidence_ok) {
      return { ok: false, reason: "no_cancellation_evidence", detail: "card cannot be released without evidenced cancellation" };
    }
    const projected = this.spentCents + charge_cents + hold_cents;
    if (projected > AGGREGATE_CAP_CENTS) {
      this.state = "QUARANTINED";
      this._record({ event: "cap_exceeded", projected });
      return { ok: false, reason: "aggregate_cap_exceeded", cap_cents: AGGREGATE_CAP_CENTS, projected };
    }
    this.spentCents += charge_cents + settled_cents;
    this.holdsCents = hold_cents;
    this.state = "RECONCILING";
    this._record({ event: "reconcile", charge_cents, settled_cents });
    // RECONCILING -> FREE happens after cleanup verified by the caller.
    return { ok: true };
  }

  releaseToFree() {
    if (this.state !== "RECONCILING") return { ok: false, reason: "bad_state", state: this.state };
    this.state = "FREE";
    this.holder = null;
    this._record({ event: "release_free" });
    return { ok: true };
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
}
