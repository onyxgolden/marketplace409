// Call Shield persistence helpers: mapping between the S1 pure domain
// model and the S2 Postgres tables. The domain stays storage-agnostic;
// this module is the only place that knows the row shapes.
import { applyEvents } from "@/domains/callShield/callShieldCase";

export const CASE_COLUMNS = "id, owner_id, reported_business_name, notes, recording_notice_acknowledged_at, created_at, updated_at";
export const EVENT_COLUMNS = "id, owner_id, case_id, seq, type, payload, recorded_at";

function toDomainEvent(row) {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload || {},
    recordedAt: row.recorded_at,
  };
}

/** Rebuild a case's domain state from its persisted event rows (seq order). */
export function rebuildCaseState(eventRows) {
  const ordered = [...eventRows].sort((a, b) => a.seq - b.seq);
  return applyEvents([], ordered.map(toDomainEvent));
}

/**
 * Load a case's domain state: verifies the case belongs to the owner, then
 * rebuilds from its event rows. Returns null when the case is not found.
 */
export async function loadCaseState(supabaseClient, ownerId, caseId) {
  const { data: caseRow, error: caseError } = await supabaseClient
    .from("call_shield_cases")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("id", caseId)
    .maybeSingle();
  if (caseError) throw caseError;
  if (!caseRow) return null;

  const { data: eventRows, error: eventsError } = await supabaseClient
    .from("call_shield_case_events")
    .select(EVENT_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("case_id", caseId)
    .order("seq", { ascending: true });
  if (eventsError) throw eventsError;
  return rebuildCaseState(eventRows || []);
}

/**
 * Append one domain event to a case. seq is assigned server-side as
 * max(seq)+1 so clients can never fork the timeline. The unique
 * (case_id, seq) constraint makes concurrent appends safe: on a
 * unique-violation we re-read the max and retry.
 */
export async function persistEvent(supabaseClient, ownerId, caseId, domainEvent, attempts = 5) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data: maxRow, error: maxError } = await supabaseClient
      .from("call_shield_case_events")
      .select("seq")
      .eq("owner_id", ownerId)
      .eq("case_id", caseId)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxError) throw maxError;
    const seq = (maxRow?.seq ?? -1) + 1;

    const { error } = await supabaseClient.from("call_shield_case_events").insert({
      id: domainEvent.id,
      owner_id: ownerId,
      case_id: caseId,
      seq,
      type: domainEvent.type,
      payload: domainEvent.payload || {},
    });
    if (!error) return seq;
    // Postgres unique_violation on (case_id, seq): another writer won the
    // race — re-read and try the next seq.
    if (error.code === "23505") {
      lastError = error;
      continue;
    }
    throw error;
  }
  throw lastError || new Error("Unable to append the event.");
}

export function serializeCase(row, state) {
  return {
    id: row.id,
    reportedBusinessName: row.reported_business_name,
    notes: row.notes,
    recordingNoticeAcknowledgedAt: row.recording_notice_acknowledged_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    callCount: state?.calls?.length ?? 0,
    calls: state?.calls ?? [],
    events: state?.events ?? [],
  };
}
