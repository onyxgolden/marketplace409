/**
 * decisionValidator.js — the P5 human-decision contract, layered on
 * the EXISTING private decision shape (rental-ops / planning
 * decisionValidator.js and the drop-side private-decision.mjs).
 *
 * Adapter decisions stay accept / reject / send-back. The P5 human
 * states map onto them:
 *   accept    -> ACCEPTED_FOR_CONSIDERATION (approve for human
 *                consideration ONLY — never applies the patch, never
 *                creates a branch, never launches a PR, never
 *                enqueues work, never schedules, never activates)
 *   reject    -> REJECTED
 *   send-back -> PENDING (back to the queue for re-review)
 *
 * A decision binds item ID + proposal digest + policy version +
 * row ID + actor + time. The actor is server-derived and passed as
 * a separate argument — it is NEVER a field of the decision object
 * (a body "actor" refuses, mirroring private-decision.mjs).
 *
 * Decisions are append-only with expected-version compare-and-set:
 * a missing expected_version refuses, a stale expected_version
 * refuses, so two concurrent decisions cannot silently overwrite
 * each other. Reversal is a new event, never a rewrite. A replay
 * by decision_id is idempotent only when the replayed decision
 * binds the same item, digest, actor and decision bytes — an ID
 * collision with different bytes refuses. No decision mutates the
 * proposal, the receipt, Git refs or worktrees — the stored history
 * is frozen, and the tests prove the proposal digest is identical
 * before and after. The atomic store itself is P5-D; this module
 * must not encode a permissive contract in the meantime.
 */
import { JobRefusal, POLICY_VERSION } from "./jobContracts.js";

export const DECISIONS = Object.freeze(["accept", "reject", "send-back"]);
export const NOTE_MAX_CHARS = 500;

/** P5 human decision states shown in the Workbench. */
export const HUMAN_STATES = Object.freeze(["PENDING", "ACCEPTED_FOR_CONSIDERATION", "REJECTED"]);

export function mapDecisionToHumanState(decision) {
  switch (decision) {
    case "accept":
      return "ACCEPTED_FOR_CONSIDERATION";
    case "reject":
      return "REJECTED";
    case "send-back":
      return "PENDING";
    default:
      throw new JobRefusal("BAD_DECISION", `decision must be accept, reject or send-back, got '${String(decision)}'`);
  }
}

export function humanStateForDecision(decision) {
  return mapDecisionToHumanState(decision);
}

/**
 * Role scoping. Only an operator for the item's owner may decide;
 * a read-only viewer cannot decide, and cross-owner access fails
 * closed. Roles are a closed set — an unknown role refuses rather
 * than defaulting to operator.
 */
export function authorizeDecision({ actorRole, actorOwnerRef, itemOwnerRef }) {
  if (actorRole !== "operator" && actorRole !== "viewer") {
    throw new JobRefusal("BAD_ACTOR", `unknown actor role '${String(actorRole)}'`);
  }
  if (actorRole === "viewer") {
    throw new JobRefusal("ROLE_FORBIDDEN", "read-only viewers cannot record decisions");
  }
  if (typeof actorOwnerRef !== "string" || actorOwnerRef.length === 0) {
    throw new JobRefusal("BAD_ACTOR", "actor owner ref is required");
  }
  if (actorOwnerRef !== itemOwnerRef) {
    throw new JobRefusal("OWNER_MISMATCH", "cross-owner decisions fail closed");
  }
  return true;
}

/**
 * Validate one decision against a private item. `actor` is the
 * server-derived session identity. `expectedVersion` (when given)
 * is the compare-and-set guard supplied explicitly by the
 * authenticated adapter — the trusted equivalent of the decision's
 * own expected_version. The guard is MANDATORY: every new decision
 * must carry an integer non-negative expected_version (in the
 * decision body or from the adapter), equal to the current history
 * length. An omitted version refuses — a decision with no
 * expected_version never silently bypasses compare-and-set.
 */
export function validateDecision(item, decision, actor, { expectedVersion, historyLength } = {}) {
  if (decision === null || typeof decision !== "object" || Array.isArray(decision)) {
    throw new JobRefusal("BAD_DECISION", "decision must be an object");
  }
  const allowed = ["item_id", "proposal_digest", "policy_version", "row_id", "decision", "note", "at", "decision_id", "expected_version"];
  for (const key of Object.keys(decision)) {
    if (!allowed.includes(key)) {
      throw new JobRefusal("BAD_DECISION", `unknown decision field '${key}' (actor is server-derived and never a body field)`);
    }
  }
  if (typeof actor !== "string" || actor.length === 0 || actor.length > 128) {
    throw new JobRefusal("BAD_ACTOR", "the decision actor must come from the authenticated session identity");
  }
  if (decision.item_id !== item.item_id) throw new JobRefusal("ITEM_MISMATCH", "decision is bound to a different item");
  if (decision.proposal_digest !== item.proposal_digest) {
    throw new JobRefusal("STALE_DIGEST", "the proposal has changed since this decision was made; re-review the current proposal");
  }
  if (decision.policy_version !== undefined && decision.policy_version !== POLICY_VERSION) {
    throw new JobRefusal("STALE_DIGEST", `decision binds policy ${String(decision.policy_version)}, current policy is ${POLICY_VERSION}`);
  }
  if (typeof decision.row_id !== "string" || !item.row_ids.includes(decision.row_id)) {
    throw new JobRefusal("UNKNOWN_ROW", `row '${String(decision.row_id)}' is not part of this proposal`);
  }
  if (!DECISIONS.includes(decision.decision)) {
    throw new JobRefusal("BAD_DECISION", "decision must be accept, reject or send-back");
  }
  if (typeof decision.at !== "string" || Number.isNaN(Date.parse(decision.at))) {
    throw new JobRefusal("BAD_DECISION", "at must be an ISO instant");
  }
  if (typeof decision.decision_id !== "string" || decision.decision_id.length === 0) {
    throw new JobRefusal("BAD_DECISION", "decision_id (idempotency key) is required");
  }
  const note = decision.note === undefined ? "" : decision.note;
  if (typeof note !== "string" || note.length > NOTE_MAX_CHARS) {
    throw new JobRefusal("BAD_DECISION", `note must be a string of at most ${NOTE_MAX_CHARS} characters`);
  }
  const expected = decision.expected_version ?? expectedVersion;
  if (expected === undefined) {
    throw new JobRefusal(
      "MISSING_VERSION",
      "expected_version is required for every new decision (compare-and-set guard); reload the current decision history and re-review",
    );
  }
  if (!Number.isInteger(expected) || expected < 0) {
    throw new JobRefusal("BAD_DECISION", "expected_version must be a non-negative integer");
  }
  const current = historyLength ?? 0;
  if (expected !== current) {
    throw new JobRefusal(
      "STALE_VERSION",
      `decision expected version ${expected} but the current decision version is ${current}; reload and re-review`,
    );
  }
  return {
    item_id: decision.item_id,
    proposal_digest: decision.proposal_digest,
    policy_version: POLICY_VERSION,
    row_id: decision.row_id,
    decision: decision.decision,
    human_state: mapDecisionToHumanState(decision.decision),
    note,
    actor,
    at: decision.at,
    decision_id: decision.decision_id,
  };
}

/**
 * Append a decision to a frozen decision history. Returns a NEW
 * frozen array — the input history is never mutated. A decision
 * already in the history (same decision_id) is returned unchanged
 * (idempotent retry) ONLY when the replayed decision binds the
 * same item, digest, actor and decision bytes as the stored
 * record AND the stored record binds the CURRENT item: the
 * stored item ID, proposal digest, row and policy must match the
 * item the replay is being appended to. A replay against a
 * different current item refuses (ITEM_MISMATCH / STALE_DIGEST /
 * UNKNOWN_ROW) even when the replayed bytes are identical to the
 * stored record — the stored decision belongs to its own item, not
 * to whichever item the caller names. A same-ID replay with
 * different bytes refuses (DECISION_ID_CONFLICT) — an ID collision
 * is not a replay. The compare-and-set guard was already
 * performed at first append and the stored version attests to it,
 * so a bound replay does not re-prove the version; replay stays
 * idempotent for the same item even when the history version has
 * advanced. A stale expected_version refuses before anything is
 * appended.
 */
export function appendDecision({ item, history, decision, actor }) {
  const list = Array.isArray(history) ? history : [];
  if (decision !== null && typeof decision === "object" && typeof decision.decision_id === "string") {
    const existing = list.find((d) => d.decision_id === decision.decision_id);
    if (existing) {
      // Current-item binding: a replay is idempotent only for the
      // item the stored decision was recorded against. Without
      // this, a stored decision for item A could be replayed
      // successfully against a request naming item B.
      if (existing.item_id !== item.item_id) {
        throw new JobRefusal("ITEM_MISMATCH", "the recorded decision belongs to a different item");
      }
      if (existing.proposal_digest !== item.proposal_digest) {
        throw new JobRefusal(
          "STALE_DIGEST",
          "the proposal has changed since this decision was recorded; re-review the current proposal",
        );
      }
      if (!item.row_ids.includes(existing.row_id)) {
        throw new JobRefusal("UNKNOWN_ROW", `row '${existing.row_id}' is not part of this proposal`);
      }
      if (existing.policy_version !== POLICY_VERSION) {
        throw new JobRefusal(
          "STALE_DIGEST",
          `the recorded decision binds policy ${existing.policy_version}, current policy is ${POLICY_VERSION}`,
        );
      }
      const replayNote = decision.note === undefined ? "" : decision.note;
      const replayPolicy = decision.policy_version === undefined ? POLICY_VERSION : decision.policy_version;
      if (
        existing.item_id !== decision.item_id ||
        existing.proposal_digest !== decision.proposal_digest ||
        existing.policy_version !== replayPolicy ||
        existing.row_id !== decision.row_id ||
        existing.decision !== decision.decision ||
        existing.note !== replayNote ||
        existing.at !== decision.at ||
        existing.actor !== actor
      ) {
        throw new JobRefusal(
          "DECISION_ID_CONFLICT",
          `decision_id '${decision.decision_id}' is already recorded with different decision bytes; a replay must bind the same item, digest, actor and decision`,
        );
      }
      return Object.freeze([...list]);
    }
  }
  const stored = validateDecision(item, decision, actor, { historyLength: list.length });
  const record = Object.freeze({
    ...stored,
    version: list.length + 1,
    previous_human_state: list.length === 0 ? "PENDING" : list[list.length - 1].human_state,
  });
  return Object.freeze([...list, record]);
}

/** The current human state of a proposal: the latest decision event, or PENDING when none exists. */
export function currentHumanState(history) {
  const list = Array.isArray(history) ? history : [];
  if (list.length === 0) return "PENDING";
  return list[list.length - 1].human_state;
}
