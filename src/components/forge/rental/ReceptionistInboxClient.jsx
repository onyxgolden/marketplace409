"use client";

import { useEffect, useState } from "react";

// Brandy-facing Calls / Receptionist inbox. Filters: all, emergency,
// unacknowledged, needs review. Call detail shows slots with provenance,
// the proposed draft, and the alert timeline with provider receipts.
// Review actions are explicit Approve / Reject / Needs info and are
// version-guarded (409 on concurrent review — reload and retry).
const FILTERS = [
  { id: "all", label: "All calls" },
  { id: "emergency", label: "Emergencies" },
  { id: "unacknowledged", label: "Unacknowledged alerts" },
  { id: "needs-review", label: "Needs review" },
];

export default function ReceptionistInboxClient() {
  const [filter, setFilter] = useState("all");
  const [calls, setCalls] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Initial + filter-change fetch lives inside the effect: the async
  // continuation (after await) sets state, not the effect body itself.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError("");
      const [callsRes, alertsRes] = await Promise.all([
        fetch(`/api/rental/receptionist/calls?filter=${filter}`),
        fetch("/api/rental/receptionist/alerts"),
      ]);
      const callsJson = await callsRes.json().catch(() => ({}));
      const alertsJson = await alertsRes.json().catch(() => ({}));
      if (cancelled) return;
      if (!callsRes.ok) return setError(callsJson.error || "Unable to load calls.");
      if (!alertsRes.ok) return setError(alertsJson.error || "Unable to load alerts.");
      setCalls(callsJson.calls || []);
      setAlerts(alertsJson.alerts || []);
    })();
    return () => { cancelled = true; };
  }, [filter]);

  const openCall = async (call) => {
    setSelected(call);
    setDetail(null);
    const res = await fetch(`/api/rental/receptionist/calls/${call.id}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setError(json.error || "Unable to load the call.");
    setDetail(json);
  };

  const reviewDraft = async (draft, reviewState) => {
    setNotice("");
    setError("");
    const res = await fetch(`/api/rental/receptionist/drafts/${draft.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewState, version: draft.version }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return setError(json.error || "Unable to record the review.");
    setNotice(`Draft ${reviewState.toLowerCase()} — recorded.`);
    if (selected) openCall(selected);
  };

  const unacknowledged = alerts.filter((a) => a.resolution_state === "UNRESOLVED");

  return (
    <div>
      {unacknowledged.length > 0 && (
        <p role="alert">
          <strong>UNACKNOWLEDGED emergency alert{unacknowledged.length > 1 ? "s" : ""}:</strong>{" "}
          {unacknowledged.map((a) => `${a.hazard} (${a.emergency_event_id})`).join(", ")} — no human has acknowledged. Do not treat as handled.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div>
        {FILTERS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}>
            {f.label}
          </button>
        ))}
      </div>
      <h2>Calls</h2>
      {calls.length === 0 ? (
        <p>No calls match this filter.</p>
      ) : (
        <ul>
          {calls.map((call) => (
            <li key={call.id}>
              <button type="button" onClick={() => openCall(call)}>
                {call.intent || "UNKNOWN"} — {call.name_claimed || "Name not provided"} —{" "}
                {call.need_excerpt || "Need not provided"} —{" "}
                {new Date(call.started_at).toLocaleString()}
                {call.unacknowledged ? " — UNACKNOWLEDGED" : ""}
                {call.callback_confirmed ? " — callback confirmed" : " — callback unverified"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && detail && (
        <section>
          <h2>Call detail (AI-captured claim — unverified)</h2>
          <dl>
            <dt>Intent</dt><dd>{detail.call.intent || "not provided"}</dd>
            <dt>Caller name (claimed)</dt><dd>{detail.call.name_claimed || "not provided"}</dd>
            <dt>Need (caller-stated)</dt><dd>{detail.call.need_excerpt || "not provided"}</dd>
            <dt>Callback confirmed</dt><dd>{detail.call.callback_confirmed ? "Yes" : "No — unverified"}</dd>
            <dt>Processing state</dt><dd>{detail.call.processing_state}</dd>
            <dt>Policy version</dt><dd>{detail.call.policy_version}</dd>
          </dl>
          <h3>Events</h3>
          <ul>
            {(detail.events || []).map((e) => (
              <li key={e.event_id}>{e.event_type} — {new Date(e.occurred_at).toLocaleString()} (turn {e.source_turn_id || "—"})</li>
            ))}
          </ul>
          <h3>Alert timeline</h3>
          {(detail.alerts || []).length === 0 ? <p>No emergency alert for this call.</p> : (
            <ul>
              {detail.alerts.map((a) => (
                <li key={a.id}>
                  {a.hazard} — detected {new Date(a.detected_at).toLocaleString()} — {a.resolution_state}
                  {a.human_ack_at ? ` — acknowledged ${new Date(a.human_ack_at).toLocaleString()} (${a.ack_method})` : " — NOT acknowledged"}
                  {a.backup_attempted_at ? ` — backup attempted ${new Date(a.backup_attempted_at).toLocaleString()}` : ""}
                </li>
              ))}
              {(detail.alertAttempts || []).map((a, i) => (
                <li key={`attempt-${i}`}>
                  {a.target_role} {a.channel} attempt {a.attempt_no}: {a.state}
                  {a.provider_sid ? ` (provider ${a.provider_sid})` : ""}
                  {a.failure_class ? ` — ${a.failure_class}` : ""}
                </li>
              ))}
            </ul>
          )}
          <h3>Drafts pending review</h3>
          {(detail.drafts || []).length === 0 ? <p>No draft for this call.</p> : (
            <ul>
              {detail.drafts.map((draft) => (
                <li key={draft.id}>
                  {draft.draft_kind} — {draft.review_state}
                  {draft.review_state === "PENDING" && (
                    <span>
                      {" "}
                      <button type="button" onClick={() => reviewDraft(draft, "APPROVED")}>Approve</button>{" "}
                      <button type="button" onClick={() => reviewDraft(draft, "REJECTED")}>Reject</button>{" "}
                      <button type="button" onClick={() => reviewDraft(draft, "NEEDS_INFO")}>Needs info</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
