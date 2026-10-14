/**
 * interlock.js — serial evaluation lease per contract §11 (revision 4).
 *
 * - Exactly one active evaluation at a time (card-free or card trials alike).
 * - Leases are generation-fenced: a stale worker cannot free a newer lease.
 * - A timeout/expired heartbeat never frees an account or card by itself.
 * - The card holder cannot be forgotten while another trial starts.
 * - Release consumes TRUSTED closure records (ledger + card registry
 *   supplied by the host), bound to the lease's evaluation_id and generation.
 *   A caller-supplied status string is never accepted as proof.
 */

export class EvaluationInterlock {
  constructor() {
    this.lease = null; // {evaluation_id, service_id, generation, acquired_at, heartbeat_at, card_bound}
    this.generation = 0;
  }

  /** Acquire the single global evaluation slot. Fails if held. */
  acquire({ evaluation_id, service_id, at = null, card_bound = false }) {
    if (this.lease) {
      return {
        ok: false,
        reason: "slot_held",
        holder: { evaluation_id: this.lease.evaluation_id, service_id: this.lease.service_id },
      };
    }
    this.generation++;
    this.lease = {
      evaluation_id,
      service_id,
      generation: this.generation,
      acquired_at: at || new Date().toISOString(),
      heartbeat_at: at || new Date().toISOString(),
      card_bound: card_bound === true,
    };
    return { ok: true, lease: { ...this.lease } };
  }

  heartbeat(evaluation_id, generation, at = null) {
    if (!this.lease) return { ok: false, reason: "no_lease" };
    if (this.lease.evaluation_id !== evaluation_id || this.lease.generation !== generation) {
      return { ok: false, reason: "stale_generation" };
    }
    this.lease.heartbeat_at = at || new Date().toISOString();
    return { ok: true };
  }

  /**
   * Release the slot. Requires matching generation AND a trusted closure
   * proof from the host:
   *   proof = { ledger, trial_id, cardRegistry? }
   * The ledger's trial must be CLOSED (or a pre-account BLOCKED skip) and
   * its evaluation_id must match the lease. When the lease is card-bound,
   * the card registry must show a matching release record. A lost heartbeat
   * or a caller status string is never proof.
   */
  release({ evaluation_id, generation, proof }) {
    if (!this.lease) return { ok: false, reason: "no_lease" };
    if (this.lease.evaluation_id !== evaluation_id || this.lease.generation !== generation) {
      return { ok: false, reason: "stale_generation" };
    }
    if (!proof || !proof.ledger || typeof proof.ledger.currentState !== "function" || !proof.trial_id) {
      return { ok: false, reason: "proof_required", detail: "release requires trusted ledger closure records" };
    }
    const state = proof.ledger.currentState(proof.trial_id);
    const trialEval =
      typeof proof.ledger.evaluationOf === "function" ? proof.ledger.evaluationOf(proof.trial_id) : null;
    if (trialEval !== evaluation_id) {
      return { ok: false, reason: "proof_binding_mismatch", detail: "closure proof is not bound to this lease's evaluation" };
    }
    const cleanSkip =
      state === "BLOCKED" &&
      typeof proof.ledger.isPreAccountSkip === "function" &&
      proof.ledger.isPreAccountSkip(proof.trial_id);
    if (state !== "CLOSED" && !cleanSkip) {
      return { ok: false, reason: "obligations_outstanding", state };
    }
    if (this.lease.card_bound) {
      const last =
        proof.cardRegistry && typeof proof.cardRegistry.lastRelease === "function"
          ? proof.cardRegistry.lastRelease()
          : null;
      if (!last || last.evaluation_id !== evaluation_id || last.generation !== generation) {
        return { ok: false, reason: "card_closure_unverified" };
      }
    }
    const released = { ...this.lease };
    this.lease = null;
    return { ok: true, released };
  }

  holder() {
    return this.lease ? { ...this.lease } : null;
  }
}
