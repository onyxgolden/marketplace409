import { JobRefusal } from "./jobContracts.js";

/**
 * Decision contract for private planning Workbench items. A decision
 * binds item ID + report digest + row ID + actor + decision + time:
 * a refreshed report (new digest) can never inherit an old decision
 * silently — the digest must match the item's current report digest
 * or the decision is refused as STALE_DIGEST. Decisions are review
 * metadata only: "acknowledge" means "this review row is noted",
 * never dispatch, repair, approve a schedule, assign work, change a
 * date/status/baseline, or authorize execution.
 *
 * Closed enum (brief §10): acknowledge, needs-clarification,
 * dismiss-with-reason. There is no Approve schedule, Apply draft,
 * Execute, Send, Auto-fix or Activate decision — clarification stays
 * open until supplied source evidence or an explicit human
 * disposition; prose guessing never clears it.
 */
export const DECISIONS = Object.freeze(["acknowledge", "needs-clarification", "dismiss-with-reason"]);
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
  if (!DECISIONS.includes(decision.decision)) {
    throw new JobRefusal("BAD_DECISION", "decision must be acknowledge, needs-clarification or dismiss-with-reason");
  }
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
