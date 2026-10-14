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
  /**
   * cardRegistry: the host's TRUSTED card registry, injected at construction
   * (CI-003 round 4). Card obligations are discovered from this binding —
   * never from optional caller proof input. A lease the card attaches to is
   * atomically marked card_bound via markCardAttached(); missing card
   * evidence cannot erase an existing obligation.
   */
  constructor({ cardRegistry = null } = {}) {
    this.lease = null; // {evaluation_id, service_id, generation, acquired_at, heartbeat_at, card_bound}
    this.generation = 0;
    this.cardRegistry = cardRegistry;
  }

  /** Bind (or rebind) the host's trusted card registry. */
  bindCardRegistry(cardRegistry) {
    this.cardRegistry = cardRegistry;
    return { ok: true };
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
   * Atomically mark the current lease as card-bound (CI-003 round 4).
   * Called by CardRegistry.attach() on successful attachment, BEFORE the
   * card mutates its own state: if the lease does not match, attachment
   * fails and no card state changes. The lease's card_bound flag is host
   * state — a later release cannot claim "card-free" by omitting evidence.
   */
  markCardAttached({ evaluation_id, service_id, generation }) {
    if (!this.lease) return { ok: false, reason: "no_lease" };
    if (
      this.lease.evaluation_id !== evaluation_id ||
      this.lease.service_id !== service_id ||
      this.lease.generation !== generation
    ) {
      return { ok: false, reason: "stale_generation", detail: "card attachment does not match the current lease" };
    }
    this.lease.card_bound = true;
    return { ok: true };
  }

  /**
   * Release the slot. Requires matching generation AND a trusted closure
   * proof from the host:
   *   proof = { ledger, trial_id }
   * The ledger's trial must be CLOSED (or a pre-account BLOCKED skip) and
   * its evaluation_id AND registered service_id must match the lease
   * (CI-003 round 5: evaluation alone does not prove the closure belongs
   * to this lease). Card obligations are discovered
   * from the TRUSTED card registry bound at construction (CI-003 round 4) —
   * never from optional caller proof input. A lost heartbeat or a caller
   * status string is never proof.
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
    // CI-003 round 5: a matching evaluation_id does not make a wrong-service
    // trial the closure of this lease. The trial ledger's registered service
    // must match the lease service BEFORE accepting any closure — card-free
    // or card-bound, CLOSED or a safe pre-account skip. Refuse mismatch
    // without changing the lease.
    const trialService =
      typeof proof.ledger.serviceOf === "function" ? proof.ledger.serviceOf(proof.trial_id) : null;
    if (trialService !== this.lease.service_id) {
      return {
        ok: false, reason: "proof_binding_mismatch",
        detail: `closure proof binds service ${trialService}, lease is ${this.lease.service_id}`,
      };
    }
    const cleanSkip =
      state === "BLOCKED" &&
      typeof proof.ledger.isPreAccountSkip === "function" &&
      proof.ledger.isPreAccountSkip(proof.trial_id);
    if (state !== "CLOSED" && !cleanSkip) {
      return { ok: false, reason: "obligations_outstanding", state };
    }
    // CI-003 round 4: card obligations are determined from the TRUSTED card
    // registry bound at construction, never from the caller's card_bound
    // flag or an optional proof-supplied registry. If the lease is
    // card-bound (marked atomically at attach time), closure MUST be proven
    // against the bound registry — omitting card evidence refuses.
    const cardReg = this.cardRegistry;
    const cardHolder = cardReg && cardReg.holder ? cardReg.holder : null;
    const lastCardRelease =
      cardReg && typeof cardReg.lastRelease === "function" ? cardReg.lastRelease() : null;
    let cardObligated = this.lease.card_bound === true;
    if (cardHolder && cardHolder.evaluation_id === evaluation_id) cardObligated = true;
    if (lastCardRelease && lastCardRelease.evaluation_id === evaluation_id) cardObligated = true;
    if (cardObligated) {
      if (!cardReg) {
        return { ok: false, reason: "card_closure_unverified", detail: "card obligations require the trusted card registry bound at construction" };
      }
      if (!lastCardRelease || lastCardRelease.evaluation_id !== evaluation_id || lastCardRelease.generation !== generation) {
        return { ok: false, reason: "card_closure_unverified" };
      }
      // Bind the closure to the actual service/trial/generation — a closure
      // record for a different service, trial, or generation does not free
      // this lease's card obligation.
      if (lastCardRelease.service_id !== this.lease.service_id || lastCardRelease.trial_id !== proof.trial_id) {
        return {
          ok: false, reason: "card_closure_binding_mismatch",
          detail: `card closure binds ${lastCardRelease.service_id}/${lastCardRelease.trial_id}, lease is ${this.lease.service_id}/${proof.trial_id}`,
        };
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
