/**
 * interlock.js — serial evaluation lease per contract §11 (revision 4).
 *
 * - Exactly one active evaluation at a time (card-free or card trials alike).
 * - Leases are generation-fenced: a stale worker cannot free a newer lease.
 * - A timeout/expired heartbeat never frees an account or card by itself.
 * - The card holder cannot be forgotten while another trial starts.
 */

export class EvaluationInterlock {
  constructor() {
    this.lease = null; // {evaluation_id, service_id, generation, acquired_at, heartbeat_at}
    this.generation = 0;
  }

  /** Acquire the single global evaluation slot. Fails if held. */
  acquire({ evaluation_id, service_id, at = null }) {
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
   * Release the slot. Requires matching generation AND a terminal ledger
   * state proof (CLOSED or BLOCKED) — a lost heartbeat is not proof.
   */
  release({ evaluation_id, generation, terminal_state }) {
    if (!this.lease) return { ok: false, reason: "no_lease" };
    if (this.lease.evaluation_id !== evaluation_id || this.lease.generation !== generation) {
      return { ok: false, reason: "stale_generation" };
    }
    if (!["CLOSED", "BLOCKED"].includes(terminal_state)) {
      return { ok: false, reason: "not_terminal", detail: "slot frees only on CLOSED/BLOCKED ledger state" };
    }
    const released = { ...this.lease };
    this.lease = null;
    return { ok: true, released };
  }

  holder() {
    return this.lease ? { ...this.lease } : null;
  }
}
