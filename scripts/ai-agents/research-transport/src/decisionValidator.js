/**
 * decisionValidator.js — the Research decision gate for private
 * Workbench items (P1-B).
 *
 * Mirrors the existing private decision adapter's binding contract
 * (drop tools/agent-workbench/private-decision.mjs, pinned by tests
 * on both sides): a decision binds item ID + report digest + row ID
 * + actor + decision + time, so a refreshed preview can never
 * silently inherit an old decision, and a decision can never address
 * a row that is not part of the item.
 *
 * Two deliberate Research differences from the rental-ops adapter:
 * - The decision enum is binary: accept | reject. The brief's gate
 *   is explicit operator ACCEPT or REJECT per item; send-back is
 *   not a Research decision and refuses.
 * - ACCEPT means "accepted for human consideration" — never
 *   approval to write production data, activate an agent, contact
 *   anyone, spend, or enqueue execution. The decision record is
 *   review metadata only; no external action executes from it.
 *   That meaning lives here, in the README, and in the decision
 *   record's own documentation — there is no code path that turns
 *   an accepted item into an action.
 *
 * The actor is always the server-derived session identity passed by
 * the caller — never a body field. A body "actor" is not even in
 * the allowlist.
 */

import { sha256Hex } from "./canonical.js";
import { CODES, refuse } from "./errors.js";

export const RESEARCH_DECISIONS = Object.freeze(["accept", "reject"]);
export const NOTE_MAX_CHARS = 500;

function requireActor(actor) {
  if (typeof actor !== "string" || actor.length === 0 || actor.length > 128) {
    refuse(CODES.BAD_DECISION, "the decision actor must come from the authenticated session identity");
  }
}

function requireIsoInstant(value, what) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    refuse(CODES.BAD_DECISION, `${what} must be an ISO instant`);
  }
}

/**
 * Build the stored decision from an API body. The actor is the
 * server-derived session identity passed by the caller.
 */
export function decisionFromBody(item, body, nowIso, actor) {
  requireActor(actor);
  requireIsoInstant(nowIso, "nowIso");
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    refuse(CODES.BAD_DECISION, "body must be an object");
  }
  const allowed = ["itemId", "reportDigest", "rowId", "decision", "note", "decisionId"];
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) refuse(CODES.BAD_DECISION, `unknown field '${key}'`);
  }
  if (body.itemId !== item.item_id) refuse(CODES.ITEM_MISMATCH, "decision is bound to a different item");
  if (body.reportDigest !== item.report_digest) {
    refuse(CODES.STALE_DIGEST, "the preview has been refreshed since this page was rendered; reload and re-review");
  }
  if (typeof body.rowId !== "string" || !item.row_ids.includes(body.rowId)) {
    refuse(CODES.UNKNOWN_ROW, `row '${String(body.rowId)}' is not part of this preview`);
  }
  if (!RESEARCH_DECISIONS.includes(body.decision)) {
    refuse(CODES.BAD_DECISION, "decision must be accept or reject");
  }
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > NOTE_MAX_CHARS) refuse(CODES.BAD_DECISION, `note exceeds ${NOTE_MAX_CHARS} characters`);
  let decisionId = body.decisionId;
  if (decisionId === undefined || decisionId === null || decisionId === "") {
    // Derive a stable idempotency key so a retried click dedupes.
    decisionId = `srv-${sha256Hex(JSON.stringify([item.item_id, item.report_digest, body.rowId, body.decision, note])).slice(0, 24)}`;
  }
  if (typeof decisionId !== "string" || decisionId.length > 128) {
    refuse(CODES.BAD_DECISION, "decisionId malformed");
  }
  return {
    item_id: item.item_id,
    report_digest: item.report_digest,
    row_id: body.rowId,
    actor,
    decision: body.decision,
    note,
    at: nowIso,
    decision_id: decisionId,
  };
}

/** Store-side validate callback (appendDecision runs it before appending). */
export function validateResearchDecision(item, decision) {
  if (decision.item_id !== item.item_id) refuse(CODES.ITEM_MISMATCH, "decision is bound to a different item");
  if (decision.report_digest !== item.report_digest) refuse(CODES.STALE_DIGEST, "preview refreshed");
  if (!item.row_ids.includes(decision.row_id)) refuse(CODES.UNKNOWN_ROW, String(decision.row_id));
  if (!RESEARCH_DECISIONS.includes(decision.decision)) refuse(CODES.BAD_DECISION, "closed decision enum");
  requireActor(decision.actor);
  requireIsoInstant(decision.at, "decision.at");
  if (typeof decision.decision_id !== "string" || decision.decision_id.length === 0) {
    refuse(CODES.BAD_DECISION, "decision_id (idempotency key) is required");
  }
  if (typeof decision.note !== "string" || decision.note.length > NOTE_MAX_CHARS) {
    refuse(CODES.BAD_DECISION, `note must be a string of at most ${NOTE_MAX_CHARS} characters`);
  }
}
