"use client";

import { useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const label = "block text-xs font-medium text-slate-600 mb-1";
const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;

const COMMON_CRAFTS = [
  "Pipefitter", "Welder", "Boilermaker", "Ironworker", "Electrician",
  "Millwright", "Carpenter", "Laborer", "Crane Operator", "Rigger",
  "Insulator", "Painter", "Scaffolder", "Instrument Technician",
  "Operator", "Supervisor",
];

async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

const ACTION_LABELS = {
  create: "Added",
  update: "Edited",
  reassign: "Reassigned",
  retire: "Retired",
  restore: "Restored",
};

function chicagoToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function shiftDisplay(assignment) {
  if (assignment.shiftKind === "other") return assignment.shiftLabel || "Other";
  return assignment.shiftKind === "night" ? "Night" : "Day";
}

function formatWhen(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
      weekday: "short", year: "numeric", month: "short", day: "numeric",
    });
  } catch {
    return String(value);
  }
}

function snapshotSummary(values) {
  if (!values) return "—";
  const parts = [];
  if (values.work_date != null) parts.push(formatDate(values.work_date));
  if (values.craft_label != null) parts.push(values.craft_label);
  if (values.shift_kind != null) parts.push(values.shift_kind === "other" ? (values.shift_label || "other") : values.shift_kind);
  if (values.crew_size != null) parts.push(`${values.crew_size} crew`);
  if (values.hours_per_person != null) parts.push(`${values.hours_per_person} hrs each`);
  if (values.retired_at != null) parts.push("retired");
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function AssignmentHistory({ packageId, assignmentId }) {
  const { data, error, isLoading } = useStaleWhileRevalidate(
    `work-packages:${packageId}:craft-assignments:${assignmentId}:revisions`,
    () => api(`/api/work-packages/${packageId}/craft-assignments/${assignmentId}/revisions`).then((b) => b.revisions),
    { ttlMs: 10_000 },
  );
  if (isLoading) return <p className="mt-2 text-xs text-slate-500">Loading history…</p>;
  if (error) return <p className="mt-2 text-xs text-red-600">{error}</p>;
  const revisions = data || [];
  if (revisions.length === 0) return <p className="mt-2 text-xs text-slate-500">No history yet.</p>;
  return (
    <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600">
      {revisions.map((revision) => (
        <li key={revision.id}>
          <span className="font-medium text-slate-900">{ACTION_LABELS[revision.action] || revision.action}</span>
          {` — version ${revision.version} · ${formatWhen(revision.recordedAt)}`}
          {revision.reason ? ` · “${revision.reason}”` : ""}
          {revision.historicalCorrection ? " · past-day correction" : ""}
          {(revision.action === "update" || revision.action === "reassign") && (
            <span className="block text-slate-500">
              {snapshotSummary(revision.oldValues)} → {snapshotSummary(revision.newValues)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

// Planned day-by-day craft and crew for one work package: one craft and
// one shift per day, with crew size and hours per person. This is the
// plan — what actually happened is recorded separately as progress. A
// past day can only be changed as a marked correction with a reason, and
// every change stays in the assignment's history.
export default function WorkPackageCraftAssignments({ packageId, onChanged = null }) {
  const today = chicagoToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState("");
  const [craftFilter, setCraftFilter] = useState("");
  const [shiftFilter, setShiftFilter] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [form, setForm] = useState({
    workDate: today, craft: "", shiftKind: "day", shiftLabel: "",
    crewSize: "", hoursPerPerson: "", crewLabel: "", note: "",
    historicalCorrection: false, reason: "",
  });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [retiringId, setRetiringId] = useState(null);
  const [retireReason, setRetireReason] = useState("");
  const [retireHistoricalCorrection, setRetireHistoricalCorrection] = useState(false);
  const [historyId, setHistoryId] = useState(null);

  const query = new URLSearchParams({
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(craftFilter.trim() ? { craft: craftFilter.trim() } : {}),
    ...(shiftFilter ? { shift: shiftFilter } : {}),
    ...(showRetired ? { includeRetired: "true" } : {}),
  }).toString();
  const { data, error: loadError, isLoading, refresh } = useStaleWhileRevalidate(
    `work-packages:${packageId}:craft-assignments:${query}`,
    () => api(`/api/work-packages/${packageId}/craft-assignments?${query}`),
    { ttlMs: 10_000 },
  );
  const assignments = data?.assignments || [];
  const dayTotals = data?.dayTotals || [];
  const isPastDate = (date) => date && date < today;

  async function reload(message) {
    if (message) setConfirmation(message);
    await refresh();
    if (onChanged) onChanged();
  }

  function createBody(source) {
    return {
      workDate: source.workDate,
      craft: source.craft,
      shiftKind: source.shiftKind,
      ...(source.shiftKind === "other" ? { shiftLabel: source.shiftLabel } : {}),
      crewSize: Number(source.crewSize),
      hoursPerPerson: Number(source.hoursPerPerson),
      ...(source.crewLabel.trim() ? { crewLabel: source.crewLabel } : {}),
      ...(source.note.trim() ? { note: source.note } : {}),
      ...(source.historicalCorrection ? { historicalCorrection: true, reason: source.reason } : {}),
    };
  }

  // Edit PATCH body: unlike create, an emptied optional crew name or
  // note is an explicit clear (null), not an omission — the backend
  // presence flags read null as "clear" and an absent key as "keep",
  // so omitting a cleared field would silently preserve the old value.
  // Fields the user did not touch stay present with their stored
  // values, so nothing else is cleared by accident.
  function editBody(source) {
    return {
      workDate: source.workDate,
      craft: source.craft,
      shiftKind: source.shiftKind,
      ...(source.shiftKind === "other" ? { shiftLabel: source.shiftLabel } : {}),
      crewSize: Number(source.crewSize),
      hoursPerPerson: Number(source.hoursPerPerson),
      crewLabel: source.crewLabel.trim() ? source.crewLabel : null,
      note: source.note.trim() ? source.note : null,
      ...(source.historicalCorrection ? { historicalCorrection: true, reason: source.reason } : {}),
    };
  }

  async function onCreate(event) {
    event.preventDefault();
    setBusy(true); setError(""); setConfirmation("");
    try {
      const created = await api(`/api/work-packages/${packageId}/craft-assignments`, {
        method: "POST", body: JSON.stringify(createBody(form)),
      });
      setForm({
        workDate: today, craft: "", shiftKind: "day", shiftLabel: "",
        crewSize: "", hoursPerPerson: "", crewLabel: "", note: "",
        historicalCorrection: false, reason: "",
      });
      await reload(`Craft assignment added — ${created.assignment.craftLabel}, ${formatDate(created.assignment.workDate)} (${shiftDisplay(created.assignment)}).`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  function startEdit(assignment) {
    setEditingId(assignment.id);
    setRetiringId(null);
    setEditForm({
      workDate: assignment.workDate, craft: assignment.craftLabel, shiftKind: assignment.shiftKind,
      shiftLabel: assignment.shiftLabel || "", crewSize: String(assignment.crewSize),
      hoursPerPerson: String(assignment.hoursPerPerson), crewLabel: assignment.crewLabel || "",
      note: assignment.note || "", historicalCorrection: false, reason: "",
    });
    setError(""); setConfirmation("");
  }

  async function onSaveEdit(event, assignment) {
    event.preventDefault();
    setBusy(true); setError(""); setConfirmation("");
    try {
      const updated = await api(`/api/work-packages/${packageId}/craft-assignments/${assignment.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: assignment.version,
          ...editBody(editForm),
          ...(editForm.reason.trim() ? { reason: editForm.reason } : {}),
        }),
      });
      setEditingId(null);
      setEditForm(null);
      await reload(`Craft assignment updated — ${updated.assignment.craftLabel}, ${formatDate(updated.assignment.workDate)}.`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function onConfirmRetire(assignment) {
    setBusy(true); setError(""); setConfirmation("");
    try {
      const retired = await api(`/api/work-packages/${packageId}/craft-assignments/${assignment.id}/retire`, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: assignment.version,
          reason: retireReason,
          ...(isPastDate(assignment.workDate) && retireHistoricalCorrection ? { historicalCorrection: true } : {}),
        }),
      });
      setRetiringId(null);
      setRetireReason("");
      setRetireHistoricalCorrection(false);
      await reload(`Craft assignment retired — ${retired.assignment.craftLabel}, ${formatDate(retired.assignment.workDate)}.`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Craft &amp; crew assignments</h2>
      <p className="mt-1 text-xs text-slate-500">
        The plan for who works, by day: one craft and one shift per day, with crew size and hours
        per person. What actually happened is recorded separately as progress. A past day can only
        be changed as a marked correction with a reason; every change stays in the history.
      </p>
      {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {confirmation && <p className="mt-2 text-sm text-emerald-700">{confirmation}</p>}

      <form onSubmit={onCreate} className="mt-3 space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div>
            <label className={label} htmlFor="craft-date">Work date</label>
            <input id="craft-date" className={input} type="date" value={form.workDate}
              onChange={(e) => setForm((f) => ({ ...f, workDate: e.target.value }))} required />
          </div>
          <div className="flex-1">
            <label className={label} htmlFor="craft-craft">Craft</label>
            <input id="craft-craft" className={input} list="craft-suggestions" placeholder="e.g. Pipefitter"
              value={form.craft} onChange={(e) => setForm((f) => ({ ...f, craft: e.target.value }))}
              required maxLength={80} />
            <datalist id="craft-suggestions">
              {COMMON_CRAFTS.map((craft) => <option key={craft} value={craft} />)}
            </datalist>
          </div>
          <div>
            <label className={label} htmlFor="craft-shift">Shift</label>
            <select id="craft-shift" className={input} value={form.shiftKind}
              onChange={(e) => setForm((f) => ({ ...f, shiftKind: e.target.value }))}>
              <option value="day">Day</option>
              <option value="night">Night</option>
              <option value="other">Other</option>
            </select>
          </div>
          {form.shiftKind === "other" && (
            <div className="flex-1">
              <label className={label} htmlFor="craft-shift-label">Shift name</label>
              <input id="craft-shift-label" className={input} placeholder="e.g. Swing"
                value={form.shiftLabel} onChange={(e) => setForm((f) => ({ ...f, shiftLabel: e.target.value }))}
                required maxLength={80} />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div>
            <label className={label} htmlFor="craft-crew-size">Crew size</label>
            <input id="craft-crew-size" className={input} type="number" min="1" max="500" step="1"
              placeholder="6" value={form.crewSize}
              onChange={(e) => setForm((f) => ({ ...f, crewSize: e.target.value }))} required />
          </div>
          <div>
            <label className={label} htmlFor="craft-hours">Hours per person</label>
            <input id="craft-hours" className={input} type="number" min="0.01" max="24" step="0.01"
              placeholder="8" value={form.hoursPerPerson}
              onChange={(e) => setForm((f) => ({ ...f, hoursPerPerson: e.target.value }))} required />
          </div>
          <div className="flex-1">
            <label className={label} htmlFor="craft-crew-label">Crew name (optional)</label>
            <input id="craft-crew-label" className={input} placeholder="e.g. Crew A"
              value={form.crewLabel} onChange={(e) => setForm((f) => ({ ...f, crewLabel: e.target.value }))}
              maxLength={80} />
          </div>
          <div className="flex-[2]">
            <label className={label} htmlFor="craft-note">Note (optional)</label>
            <input id="craft-note" className={input} placeholder="What this crew is doing"
              value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              maxLength={1000} />
          </div>
          <div className="flex items-end">
            <button type="submit" className={btnPrimary} disabled={busy}>Add assignment</button>
          </div>
        </div>
        {isPastDate(form.workDate) && (
          <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3">
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" checked={form.historicalCorrection}
                onChange={(e) => setForm((f) => ({ ...f, historicalCorrection: e.target.checked }))} />
              This is a correction to a past day
            </label>
            <input className={input} aria-label="Reason for this past-day correction"
              placeholder="Reason for this past-day correction (required)"
              value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              maxLength={2000} required={form.historicalCorrection} />
          </div>
        )}
      </form>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label className={label} htmlFor="craft-from">From</label>
          <input id="craft-from" className={input} type="date" value={from}
            onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="craft-to">To</label>
          <input id="craft-to" className={input} type="date" value={to}
            onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="craft-filter">Craft</label>
          <input id="craft-filter" className={input} placeholder="All crafts" value={craftFilter}
            onChange={(e) => setCraftFilter(e.target.value)} maxLength={80} />
        </div>
        <div>
          <label className={label} htmlFor="craft-shift-filter">Shift</label>
          <select id="craft-shift-filter" className={input} value={shiftFilter}
            onChange={(e) => setShiftFilter(e.target.value)}>
            <option value="">All shifts</option>
            <option value="day">Day</option>
            <option value="night">Night</option>
            <option value="other">Other</option>
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-xs text-slate-600">
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
          Show retired
        </label>
      </div>

      {dayTotals.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-slate-600">
          {dayTotals.map((day) => (
            <li key={day.workDate}>
              {formatDate(day.workDate)} — <span className="font-medium text-slate-900">{day.plannedPersonHours} person-hours</span>
              {` · ${day.assignmentCount} assignment${day.assignmentCount === 1 ? "" : "s"}`}
            </li>
          ))}
        </ul>
      )}

      {isLoading ? (
        <p className="mt-3 text-xs text-slate-500">Loading craft assignments…</p>
      ) : assignments.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No craft assignments in this window yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {assignments.map((assignment) => (
            <li key={assignment.id} className="rounded border border-slate-100 p-3 text-xs">
              {editingId === assignment.id ? (
                <form onSubmit={(e) => onSaveEdit(e, assignment)} className="space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input className={input} aria-label="Work date" type="date" value={editForm.workDate}
                      onChange={(e) => setEditForm((f) => ({ ...f, workDate: e.target.value }))} required />
                    <input className={`${input} flex-1`} aria-label="Craft" list="craft-suggestions"
                      value={editForm.craft}
                      onChange={(e) => setEditForm((f) => ({ ...f, craft: e.target.value }))}
                      required maxLength={80} />
                    <select className={input} aria-label="Shift" value={editForm.shiftKind}
                      onChange={(e) => setEditForm((f) => ({ ...f, shiftKind: e.target.value }))}>
                      <option value="day">Day</option>
                      <option value="night">Night</option>
                      <option value="other">Other</option>
                    </select>
                    {editForm.shiftKind === "other" && (
                      <input className={input} aria-label="Shift name" placeholder="Shift name"
                        value={editForm.shiftLabel}
                        onChange={(e) => setEditForm((f) => ({ ...f, shiftLabel: e.target.value }))}
                        required maxLength={80} />
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input className={input} aria-label="Crew size" type="number" min="1" max="500" step="1"
                      value={editForm.crewSize}
                      onChange={(e) => setEditForm((f) => ({ ...f, crewSize: e.target.value }))} required />
                    <input className={input} aria-label="Hours per person" type="number" min="0.01" max="24" step="0.01"
                      value={editForm.hoursPerPerson}
                      onChange={(e) => setEditForm((f) => ({ ...f, hoursPerPerson: e.target.value }))} required />
                    <input className={`${input} flex-1`} aria-label="Crew name" placeholder="Crew name (optional)"
                      value={editForm.crewLabel}
                      onChange={(e) => setEditForm((f) => ({ ...f, crewLabel: e.target.value }))} maxLength={80} />
                    <input className={`${input} flex-[2]`} aria-label="Note" placeholder="Note (optional)"
                      value={editForm.note}
                      onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))} maxLength={1000} />
                  </div>
                  {isPastDate(editForm.workDate) ? (
                    <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3">
                      <label className="flex items-center gap-2 text-xs text-slate-700">
                        <input type="checkbox" checked={editForm.historicalCorrection}
                          onChange={(e) => setEditForm((f) => ({ ...f, historicalCorrection: e.target.checked }))} />
                        This is a correction to a past day
                      </label>
                      <input className={input} aria-label="Reason for this past-day correction"
                        placeholder="Reason for this past-day correction (required)"
                        value={editForm.reason}
                        onChange={(e) => setEditForm((f) => ({ ...f, reason: e.target.value }))}
                        maxLength={2000} required={editForm.historicalCorrection} />
                    </div>
                  ) : (
                    <input className={input} aria-label="Reason for this change" placeholder="Reason for this change (optional)"
                      value={editForm.reason}
                      onChange={(e) => setEditForm((f) => ({ ...f, reason: e.target.value }))} maxLength={2000} />
                  )}
                  <div className="flex gap-2">
                    <button type="submit" className={btnPrimary} disabled={busy}>Save changes</button>
                    <button type="button" className={btnGhost} disabled={busy}
                      onClick={() => { setEditingId(null); setEditForm(null); }}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium text-slate-900">{formatDate(assignment.workDate)} — {assignment.craftLabel}</span>
                      <span className="ml-2 text-slate-500">{shiftDisplay(assignment)}</span>
                      {assignment.crewLabel && <span className="ml-2 text-slate-500">· {assignment.crewLabel}</span>}
                      {assignment.retiredAt && (
                        <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-slate-600">Retired</span>
                      )}
                    </div>
                    <span className="text-slate-400">v{assignment.version}</span>
                  </div>
                  <p className="mt-1 text-slate-600">
                    {assignment.crewSize} crew · {assignment.hoursPerPerson} hrs each · {assignment.plannedPersonHours} person-hours
                  </p>
                  {assignment.note && <p className="mt-1 text-slate-600">{assignment.note}</p>}
                  {retiringId === assignment.id ? (
                    <div className="mt-2 space-y-2">
                      <input className={input} aria-label="Reason for retiring" placeholder="Reason for retiring (required)"
                        value={retireReason} onChange={(e) => setRetireReason(e.target.value)} maxLength={2000} required />
                      {isPastDate(assignment.workDate) && (
                        <label className="flex items-center gap-2 text-xs text-slate-700">
                          <input type="checkbox" aria-label="This retires a past day — mark it as a historical correction"
                            checked={retireHistoricalCorrection}
                            onChange={(e) => setRetireHistoricalCorrection(e.target.checked)} />
                          This retires a past day — mark it as a historical correction
                        </label>
                      )}
                      <div className="flex gap-2">
                        <button className={btnPrimary}
                          disabled={busy || !retireReason.trim() || (isPastDate(assignment.workDate) && !retireHistoricalCorrection)}
                          onClick={() => onConfirmRetire(assignment)}>
                          Retire this assignment
                        </button>
                        <button className={btnGhost} disabled={busy}
                          onClick={() => { setRetiringId(null); setRetireReason(""); setRetireHistoricalCorrection(false); }}>
                          Keep it
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {!assignment.retiredAt && (
                        <>
                          <button className={btnGhost} disabled={busy} onClick={() => startEdit(assignment)}>Edit</button>
                          <button className={btnGhost} disabled={busy}
                            onClick={() => { setRetiringId(assignment.id); setRetireReason(""); setRetireHistoricalCorrection(false); setEditingId(null); }}>
                            Retire
                          </button>
                        </>
                      )}
                      <button className={btnGhost} disabled={busy}
                        onClick={() => setHistoryId((current) => (current === assignment.id ? null : assignment.id))}>
                        {historyId === assignment.id ? "Hide history" : "History"}
                      </button>
                    </div>
                  )}
                  {historyId === assignment.id && (
                    <AssignmentHistory packageId={packageId} assignmentId={assignment.id} />
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
