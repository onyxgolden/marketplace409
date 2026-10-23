import { JobRefusal } from "./jobContracts.js";

/**
 * Decision contract for private Workbench items. A decision binds
 * item ID + report digest + row ID + actor + decision + time: a
 * refreshed report (new digest) can never inherit an old decision
 * silently — the digest must match the item's current report digest
 * or the decision is refused as STALE_DIGEST. Decisions are review
 * metadata only: "accept" means "accept this assessment", never
 * dispatch, spend, contact, close, collect, waive or authorize.
 */
export const DECISIONS = Object.freeze(["accept", "reject", "send-back"]);
export const NOTE_MAX_CHARS = 500;

export function validateDecision(item, decision) {
  if (decision === null || typeof decision !== "object" || Array.isArray(decision)) {
    throw new JobRefusal("BAD_DECISION", "decision must be an object");
  }
  const allowed = ["item_id", "report_digest", "row_id", "actor", "decision", "note", "at", "decision_id"];
  for (const key of Object.keys(decision)) {
    if (!allowed.includes(key)) throw new JobRefusal("BAD_DECISION", `unknown decision field '${key}'`);
  }
  if (decision.item_id !== item.item_id) throw new JobRefusal("ITEM_MISMATCH", "decision is bound to a different item");
  if (decision.report_digest !== item.report_digest) {
    throw new JobRefusal("STALE_DIGEST", "the report has been refreshed since this decision was made; re-review the current report");
  }
  if (typeof decision.row_id !== "string" || !item.row_ids.includes(decision.row_id)) {
    throw new JobRefusal("UNKNOWN_ROW", `row '${String(decision.row_id)}' is not part of this report`);
  }
  if (!DECISIONS.includes(decision.decision)) throw new JobRefusal("BAD_DECISION", "decision must be accept, reject or send-back");
  if (typeof decision.actor !== "string" || decision.actor.length === 0) {
    throw new JobRefusal("BAD_DECISION", "actor is required");
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
  return { ...decision, note };
}
