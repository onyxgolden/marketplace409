// Work Package Planner slice 5 — the planner-authored ordered work
// breakdown for one work package. Steps are created BEFORE drawings
// exist; later, controlled drawings refine them through links
// (planning context only — a link never edits a drawing, never
// verifies drawing text, never adopts quantities). The schedule here
// is the deterministic manual sequence of active steps (1..N), not a
// dated baseline: no planned dates, no status workflow, no percent
// complete are stored anywhere in this slice.
//
// Two scope §4 items are explicitly DEFERRED (see the migration
// header): assignment attribution and takeoff links. This panel never
// fabricates either association — it shows package-level read-only
// context from the craft plan and takeoff progress instead, and says
// so in plain words.
"use client";

import { useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { formatEstimate } from "@/domains/work-management/workSteps";

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
  reorder: "Moved",
  retire: "Retired",
  historical_correction: "Correction",
  parent_drawing_deleted: "Drawing deleted",
};

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

function revisionSummary(revision) {
  const oldValues = revision.oldValues || {};
  const newValues = revision.newValues || {};
  const parts = [];
  if (oldValues.sequence_no != null && newValues.sequence_no != null && oldValues.sequence_no !== newValues.sequence_no) {
    parts.push(`#${oldValues.sequence_no} → #${newValues.sequence_no}`);
  }
  if (oldValues.title != null && newValues.title != null && oldValues.title !== newValues.title) {
    parts.push(`“${oldValues.title}” → “${newValues.title}”`);
  }
  if (newValues.retired_at != null && oldValues.retired_at == null) parts.push("retired");
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function StepHistory({ packageId, stepId }) {
  const { data, error, isLoading } = useStaleWhileRevalidate(
    `work-packages:${packageId}:work-steps:${stepId}:revisions`,
    () => api(`/api/work-packages/${packageId}/work-steps/${stepId}/revisions`).then((b) => b.revisions),
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
          <span className="block text-slate-500">{revisionSummary(revision)}</span>
        </li>
      ))}
    </ul>
  );
}

function LinkHistory({ packageId, stepId, linkId }) {
  const { data, error, isLoading } = useStaleWhileRevalidate(
    `work-packages:${packageId}:work-steps:${stepId}:drawings:${linkId}:revisions`,
    () => api(`/api/work-packages/${packageId}/work-steps/${stepId}/drawings/${linkId}/revisions`).then((b) => b.revisions),
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
        </li>
      ))}
    </ul>
  );
}

function drawingDisplay(link) {
  if (link.drawing) {
    const title = link.drawing.title ? ` — ${link.drawing.title}` : "";
    return `${link.drawing.drawingNumber} (${link.drawing.drawingType})${title}`;
  }
  return `Drawing deleted — was ${link.originalDrawingId}`;
}

// One step's drawing links: planning context only. A link never edits
// the drawing, and a deleted drawing detaches the link (kept in
// history) instead of deleting the step's record of it.
function StepDrawings({ packageId, step, drawings, busy, onChanged }) {
  const [linkDrawingId, setLinkDrawingId] = useState("");
  const [refinementNote, setRefinementNote] = useState("");
  const [linkError, setLinkError] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [retiringLinkId, setRetiringLinkId] = useState(null);
  const [retireReason, setRetireReason] = useState("");
  const [linkHistoryId, setLinkHistoryId] = useState(null);

  const { data, error, isLoading, refresh } = useStaleWhileRevalidate(
    `work-packages:${packageId}:work-steps:${step.id}:drawings`,
    () => api(`/api/work-packages/${packageId}/work-steps/${step.id}/drawings`).then((b) => b.links),
    { ttlMs: 10_000 },
  );
  const links = data || [];
  const activeDrawingIds = new Set(links.filter((l) => !l.retiredAt && l.drawingId).map((l) => l.drawingId));
  const linkableDrawings = (drawings || []).filter((d) => !activeDrawingIds.has(d.id));

  async function onLink(event) {
    event.preventDefault();
    setLinkBusy(true); setLinkError("");
    try {
      await api(`/api/work-packages/${packageId}/work-steps/${step.id}/drawings`, {
        method: "POST",
        body: JSON.stringify({
          drawingId: linkDrawingId,
          ...(refinementNote.trim() ? { refinementNote: refinementNote.trim() } : {}),
        }),
      });
      setLinkDrawingId("");
      setRefinementNote("");
      await refresh();
      if (onChanged) onChanged();
    } catch (e) {
      setLinkError(e.message);
    } finally { setLinkBusy(false); }
  }

  async function onConfirmRetireLink(link) {
    setLinkBusy(true); setLinkError("");
    try {
      await api(`/api/work-packages/${packageId}/work-steps/${step.id}/drawings/${link.id}/retire`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: link.version, reason: retireReason }),
      });
      setRetiringLinkId(null);
      setRetireReason("");
      await refresh();
      if (onChanged) onChanged();
    } catch (e) {
      setLinkError(e.message);
    } finally { setLinkBusy(false); }
  }

  return (
    <div className="mt-2 rounded border border-slate-100 p-3">
      <p className="text-xs font-medium text-slate-700">Drawings for this step</p>
      <p className="mt-1 text-xs text-slate-500">
        Which controlled drawings this step was planned from. Linking never edits the drawing.
      </p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {linkError && <p className="mt-2 text-xs text-red-600">{linkError}</p>}
      {isLoading ? (
        <p className="mt-2 text-xs text-slate-500">Loading drawings…</p>
      ) : links.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">No drawings linked yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {links.map((link) => (
            <li key={link.id} className="text-xs text-slate-600">
              <span className="font-medium text-slate-900">{drawingDisplay(link)}</span>
              {link.drawingId == null && (
                <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-slate-600">Drawing deleted</span>
              )}
              {link.retiredAt && (
                <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-slate-600">Retired</span>
              )}
              {link.refinementNote && <span className="block text-slate-500">{link.refinementNote}</span>}
              {retiringLinkId === link.id ? (
                <div className="mt-2 space-y-2">
                  <input className={input} aria-label="Reason for removing this drawing link"
                    placeholder="Reason for removing this link (required)"
                    value={retireReason} onChange={(e) => setRetireReason(e.target.value)} maxLength={1000} required />
                  <div className="flex gap-2">
                    <button className={btnPrimary} disabled={linkBusy || !retireReason.trim()}
                      onClick={() => onConfirmRetireLink(link)}>Remove this link</button>
                    <button className={btnGhost} disabled={linkBusy}
                      onClick={() => { setRetiringLinkId(null); setRetireReason(""); }}>Keep it</button>
                  </div>
                </div>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1">
                  {!link.retiredAt && (
                    <button className={btnGhost} disabled={busy || linkBusy}
                      onClick={() => { setRetiringLinkId(link.id); setRetireReason(""); }}>
                      Remove link
                    </button>
                  )}
                  <button className={btnGhost} disabled={linkBusy}
                    onClick={() => setLinkHistoryId((current) => (current === link.id ? null : link.id))}>
                    {linkHistoryId === link.id ? "Hide history" : "History"}
                  </button>
                </div>
              )}
              {linkHistoryId === link.id && (
                <LinkHistory packageId={packageId} stepId={step.id} linkId={link.id} />
              )}
            </li>
          ))}
        </ul>
      )}
      {!step.retiredAt && linkableDrawings.length > 0 && (
        <form onSubmit={onLink} className="mt-2 flex flex-col gap-2 sm:flex-row">
          <select className={`${input} flex-1`} aria-label="Drawing to link" value={linkDrawingId}
            onChange={(e) => setLinkDrawingId(e.target.value)} required>
            <option value="">Link a drawing…</option>
            {linkableDrawings.map((drawing) => (
              <option key={drawing.id} value={drawing.id}>
                {drawing.drawingNumber} ({drawing.drawingType}){drawing.title ? ` — ${drawing.title}` : ""}
              </option>
            ))}
          </select>
          <input className={`${input} flex-1`} aria-label="Refinement note"
            placeholder="How this drawing refines the step (optional)"
            value={refinementNote} onChange={(e) => setRefinementNote(e.target.value)} maxLength={1000} />
          <button type="submit" className={btnPrimary} disabled={busy || linkBusy || !linkDrawingId}>Link drawing</button>
        </form>
      )}
    </div>
  );
}

// Package-level, read-only context from the craft plan: which days
// have planned crew and how many person-hours. This is the package's
// plan, not a per-step assignment — steps are not attributed to
// assignments in this slice.
function AssignmentContext({ packageId }) {
  const { data, error } = useStaleWhileRevalidate(
    `work-packages:${packageId}:work-steps:assignment-context`,
    () => api(`/api/work-packages/${packageId}/craft-assignments`).then((b) => b.dayTotals),
    { ttlMs: 10_000 },
  );
  if (error) return null;
  const dayTotals = data || [];
  return (
    <div className="mt-3 rounded border border-slate-100 p-3 text-xs text-slate-600">
      <p className="font-medium text-slate-900">Planned crew (from craft assignments)</p>
      {dayTotals.length === 0 ? (
        <p className="mt-1 text-slate-500">No craft assignments planned in the current window.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {dayTotals.map((day) => (
            <li key={day.workDate}>
              {formatDate(day.workDate)} — <span className="font-medium text-slate-900">{day.plannedPersonHours} person-hours</span>
              {` · ${day.assignmentCount} assignment${day.assignmentCount === 1 ? "" : "s"}`}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-slate-500">Package-level plan, not per-step attribution.</p>
    </div>
  );
}

// Package-level, read-only context from takeoff progress: how much of
// the takeoff quantity is installed so far. Steps carry no percent
// complete in this slice, so this is context only.
function ProgressContext({ packageId }) {
  const { data, error } = useStaleWhileRevalidate(
    `work-packages:${packageId}:work-steps:progress-context`,
    () => api(`/api/work-packages/${packageId}/progress/summary`).then((b) => b.summary),
    { ttlMs: 10_000 },
  );
  if (error) return null;
  const summary = data || null;
  if (!summary) return null;
  const lines = summary.lines || [];
  const aggregatePercent = summary.package?.aggregatePercent;
  return (
    <div className="mt-3 rounded border border-slate-100 p-3 text-xs text-slate-600">
      <p className="font-medium text-slate-900">Takeoff progress (from progress entries)</p>
      {lines.length === 0 ? (
        <p className="mt-1 text-slate-500">No takeoff lines yet — progress will show here once drawings have takeoff lines.</p>
      ) : (
        <p className="mt-1">
          {aggregatePercent == null ? "—" : `${aggregatePercent}%`} installed across {lines.length} takeoff line{lines.length === 1 ? "" : "s"}
          {summary.asOf ? ` (as of ${formatDate(summary.asOf)})` : ""}
        </p>
      )}
      <p className="mt-1 text-slate-500">Package-level context only — steps are not linked to takeoff lines in this slice.</p>
    </div>
  );
}

// The planner-authored ordered work breakdown: steps come first,
// drawings refine them later. The list below IS the schedule order —
// move a step up or down and the new order is saved as one
// transaction, guarded so a stale order is rejected instead of
// silently overwriting someone else's change.
export default function WorkPackageSteps({ packageId, onChanged = null }) {
  const [showRetired, setShowRetired] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [form, setForm] = useState({
    title: "", description: "", craftLabel: "", plannedDurationDays: "",
    plannedPersonHours: "", sourceNote: "", insertAt: "", supersedesStepId: "", reason: "",
  });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [retiringId, setRetiringId] = useState(null);
  const [retireReason, setRetireReason] = useState("");
  const [retireHistoricalCorrection, setRetireHistoricalCorrection] = useState(false);
  const [historyId, setHistoryId] = useState(null);
  const [drawingsId, setDrawingsId] = useState(null);

  // Retired steps are fetched too (they are the only supersession
  // candidates), but hidden from the list unless asked for.
  const { data, error: loadError, isLoading, refresh } = useStaleWhileRevalidate(
    `work-packages:${packageId}:work-steps:all`,
    () => api(`/api/work-packages/${packageId}/work-steps?includeRetired=true&limit=200`),
    { ttlMs: 10_000 },
  );
  const steps = data?.steps || [];
  const generation = data?.generation ?? 0;
  const packageStatus = data?.packageStatus || "";
  const isTerminal = packageStatus === "cancelled" || packageStatus === "verified_closed";
  const activeSteps = steps.filter((s) => !s.retiredAt);
  const retiredSteps = steps.filter((s) => s.retiredAt);
  const stepById = new Map(steps.map((s) => [s.id, s]));

  const { data: drawingsData } = useStaleWhileRevalidate(
    `work-packages:${packageId}:drawings`,
    () => api(`/api/work-packages/${packageId}/drawings`).then((b) => b.drawings),
    { ttlMs: 10_000 },
  );
  const drawings = drawingsData || [];

  async function reload(message) {
    if (message) setConfirmation(message);
    await refresh();
    if (onChanged) onChanged();
  }

  function createBody(source) {
    return {
      title: source.title,
      ...(source.description.trim() ? { description: source.description } : {}),
      ...(source.craftLabel.trim() ? { craftLabel: source.craftLabel } : {}),
      ...(source.plannedDurationDays !== "" ? { plannedDurationDays: Number(source.plannedDurationDays) } : {}),
      ...(source.plannedPersonHours !== "" ? { plannedPersonHours: Number(source.plannedPersonHours) } : {}),
      ...(source.sourceNote.trim() ? { sourceNote: source.sourceNote } : {}),
      ...(source.insertAt !== "" ? { insertAt: Number(source.insertAt) } : {}),
      ...(source.supersedesStepId ? { supersedesStepId: source.supersedesStepId } : {}),
      ...(source.reason.trim() ? { reason: source.reason } : {}),
    };
  }

  // Edit PATCH body: an emptied optional field is an explicit clear
  // (null), not an omission — the backend presence flags read null as
  // "clear" and an absent key as "keep", so omitting a cleared field
  // would silently preserve the old value.
  function editBody(source) {
    return {
      title: source.title,
      description: source.description.trim() ? source.description : null,
      craftLabel: source.craftLabel.trim() ? source.craftLabel : null,
      plannedDurationDays: source.plannedDurationDays !== "" ? Number(source.plannedDurationDays) : null,
      plannedPersonHours: source.plannedPersonHours !== "" ? Number(source.plannedPersonHours) : null,
      sourceNote: source.sourceNote.trim() ? source.sourceNote : null,
    };
  }

  async function onCreate(event) {
    event.preventDefault();
    setBusy(true); setError(""); setConfirmation("");
    try {
      const created = await api(`/api/work-packages/${packageId}/work-steps`, {
        method: "POST", body: JSON.stringify(createBody(form)),
      });
      setForm({
        title: "", description: "", craftLabel: "", plannedDurationDays: "",
        plannedPersonHours: "", sourceNote: "", insertAt: "", supersedesStepId: "", reason: "",
      });
      await reload(`Work step added — #${created.step.sequenceNo} ${created.step.title}.`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  function startEdit(step) {
    setEditingId(step.id);
    setRetiringId(null);
    setEditForm({
      title: step.title,
      description: step.description || "",
      craftLabel: step.craftLabel || "",
      plannedDurationDays: step.plannedDurationDays == null ? "" : String(step.plannedDurationDays),
      plannedPersonHours: step.plannedPersonHours == null ? "" : String(step.plannedPersonHours),
      sourceNote: step.sourceNote || "",
      historicalCorrection: isTerminal,
      reason: "",
    });
    setError(""); setConfirmation("");
  }

  async function onSaveEdit(event, step) {
    event.preventDefault();
    setBusy(true); setError(""); setConfirmation("");
    try {
      const updated = await api(`/api/work-packages/${packageId}/work-steps/${step.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: step.version,
          ...editBody(editForm),
          ...(editForm.historicalCorrection ? { historicalCorrection: true } : {}),
          ...(editForm.reason.trim() ? { reason: editForm.reason } : {}),
        }),
      });
      setEditingId(null);
      setEditForm(null);
      await reload(`Work step updated — #${updated.step.sequenceNo} ${updated.step.title}.`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function onConfirmRetire(step) {
    setBusy(true); setError(""); setConfirmation("");
    try {
      const retired = await api(`/api/work-packages/${packageId}/work-steps/${step.id}/retire`, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: step.version,
          reason: retireReason,
          ...(retireHistoricalCorrection ? { historicalCorrection: true } : {}),
        }),
      });
      setRetiringId(null);
      setRetireReason("");
      setRetireHistoricalCorrection(false);
      await reload(`Work step retired — #${retired.step.sequenceNo} ${retired.step.title}.`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function onMove(step, direction) {
    const index = activeSteps.findIndex((s) => s.id === step.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= activeSteps.length) return;
    const next = [...activeSteps];
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true); setError(""); setConfirmation("");
    try {
      const reordered = await api(`/api/work-packages/${packageId}/work-steps/reorder`, {
        method: "POST",
        body: JSON.stringify({
          stepIds: next.map((s) => s.id),
          expectedGeneration: generation,
        }),
      });
      await reload(`Schedule order updated — ${reordered.steps.length} active steps.`);
    } catch (e) {
      setError(e.message);
      await refresh();
    } finally { setBusy(false); }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Work steps</h2>
      <p className="mt-1 text-xs text-slate-500">
        The planner-authored work breakdown, in schedule order. Steps come before drawings — drawings
        refine them later through links. No planned dates, no status workflow, and no percent complete
        live here; the schedule is the order below.
      </p>
      {isTerminal && (
        <p className="mt-2 text-sm text-amber-700">
          This package is closed — new steps can&apos;t be added, and only corrections to existing steps are allowed.
        </p>
      )}
      {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {confirmation && <p className="mt-2 text-sm text-emerald-700">{confirmation}</p>}

      <AssignmentContext packageId={packageId} />
      <ProgressContext packageId={packageId} />

      {!isTerminal && (
        <form onSubmit={onCreate} className="mt-3 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <label className={label} htmlFor="step-title">Step title</label>
              <input id="step-title" className={input} placeholder="e.g. Fabricate pipe spool"
                value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                required maxLength={160} />
            </div>
            <div>
              <label className={label} htmlFor="step-craft">Craft (optional)</label>
              <input id="step-craft" className={input} list="step-craft-suggestions" placeholder="e.g. Pipefitter"
                value={form.craftLabel} onChange={(e) => setForm((f) => ({ ...f, craftLabel: e.target.value }))}
                maxLength={80} />
              <datalist id="step-craft-suggestions">
                {COMMON_CRAFTS.map((craft) => <option key={craft} value={craft} />)}
              </datalist>
            </div>
            <div>
              <label className={label} htmlFor="step-duration">Days (optional)</label>
              <input id="step-duration" className={input} type="number" min="1" max="366" step="1"
                placeholder="3" value={form.plannedDurationDays}
                onChange={(e) => setForm((f) => ({ ...f, plannedDurationDays: e.target.value }))} />
            </div>
            <div>
              <label className={label} htmlFor="step-hours">Person-hours (optional)</label>
              <input id="step-hours" className={input} type="number" min="0.01" max="1000000" step="0.01"
                placeholder="24.5" value={form.plannedPersonHours}
                onChange={(e) => setForm((f) => ({ ...f, plannedPersonHours: e.target.value }))} />
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-[2]">
              <label className={label} htmlFor="step-description">Description (optional)</label>
              <input id="step-description" className={input} placeholder="What this step covers"
                value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                maxLength={4000} />
            </div>
            <div className="flex-1">
              <label className={label} htmlFor="step-source">Source note (optional)</label>
              <input id="step-source" className={input} placeholder="Where this step came from"
                value={form.sourceNote} onChange={(e) => setForm((f) => ({ ...f, sourceNote: e.target.value }))}
                maxLength={1000} />
            </div>
            <div>
              <label className={label} htmlFor="step-insert">Insert at (optional)</label>
              <input id="step-insert" className={input} type="number" min="1" step="1"
                placeholder={`End (${activeSteps.length + 1})`} value={form.insertAt}
                onChange={(e) => setForm((f) => ({ ...f, insertAt: e.target.value }))} />
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <label className={label} htmlFor="step-supersedes">Replaces (optional)</label>
              <select id="step-supersedes" className={input} value={form.supersedesStepId}
                onChange={(e) => setForm((f) => ({ ...f, supersedesStepId: e.target.value }))}>
                <option value="">Does not replace another step</option>
                {retiredSteps.map((retired) => (
                  <option key={retired.id} value={retired.id}>#{retired.sequenceNo} {retired.title}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className={label} htmlFor="step-reason">Reason (optional)</label>
              <input id="step-reason" className={input} placeholder="Why this step was added"
                value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                maxLength={1000} />
            </div>
            <div className="flex items-end">
              <button type="submit" className={btnPrimary} disabled={busy}>Add step</button>
            </div>
          </div>
        </form>
      )}

      <div className="mt-3 flex items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
          Show retired
        </label>
      </div>

      {isLoading ? (
        <p className="mt-3 text-xs text-slate-500">Loading work steps…</p>
      ) : activeSteps.length === 0 && retiredSteps.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No work steps yet — add the first one above.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {(showRetired ? steps : activeSteps).map((step) => (
            <li key={step.id} className="rounded border border-slate-100 p-3 text-xs">
              {editingId === step.id ? (
                <form onSubmit={(e) => onSaveEdit(e, step)} className="space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input className={`${input} flex-1`} aria-label="Step title" value={editForm.title}
                      onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                      required maxLength={160} />
                    <input className={input} aria-label="Craft" list="step-craft-suggestions"
                      placeholder="Craft (optional)" value={editForm.craftLabel}
                      onChange={(e) => setEditForm((f) => ({ ...f, craftLabel: e.target.value }))} maxLength={80} />
                    <input className={input} aria-label="Planned duration days" type="number" min="1" max="366" step="1"
                      placeholder="Days (optional)" value={editForm.plannedDurationDays}
                      onChange={(e) => setEditForm((f) => ({ ...f, plannedDurationDays: e.target.value }))} />
                    <input className={input} aria-label="Planned person-hours" type="number" min="0.01" max="1000000" step="0.01"
                      placeholder="Person-hours (optional)" value={editForm.plannedPersonHours}
                      onChange={(e) => setEditForm((f) => ({ ...f, plannedPersonHours: e.target.value }))} />
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input className={`${input} flex-[2]`} aria-label="Description" placeholder="Description (optional)"
                      value={editForm.description}
                      onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} maxLength={4000} />
                    <input className={`${input} flex-1`} aria-label="Source note" placeholder="Source note (optional)"
                      value={editForm.sourceNote}
                      onChange={(e) => setEditForm((f) => ({ ...f, sourceNote: e.target.value }))} maxLength={1000} />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={editForm.historicalCorrection}
                      disabled={isTerminal}
                      onChange={(e) => setEditForm((f) => ({ ...f, historicalCorrection: e.target.checked }))} />
                    {isTerminal
                      ? "This package is closed, so this edit is recorded as a historical correction"
                      : "Record this edit as a historical correction"}
                  </label>
                  <input className={input} aria-label="Reason for this change"
                    placeholder={editForm.historicalCorrection || isTerminal ? "Reason for this change (required)" : "Reason for this change (optional)"}
                    value={editForm.reason}
                    onChange={(e) => setEditForm((f) => ({ ...f, reason: e.target.value }))}
                    maxLength={1000} required={editForm.historicalCorrection || isTerminal} />
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
                      <span className="font-medium text-slate-900">#{step.sequenceNo} {step.title}</span>
                      {step.craftLabel && <span className="ml-2 text-slate-500">· {step.craftLabel}</span>}
                      {step.supersedesStepId && (
                        <span className="ml-2 text-slate-500">
                          · Replaces #{stepById.get(step.supersedesStepId)?.sequenceNo ?? "?"} {stepById.get(step.supersedesStepId)?.title ?? "a retired step"}
                        </span>
                      )}
                      {step.retiredAt && (
                        <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-slate-600">Retired</span>
                      )}
                    </div>
                    <span className="text-slate-400">v{step.version}</span>
                  </div>
                  <p className="mt-1 text-slate-600">
                    {formatEstimate(step.plannedDurationDays, "days")}
                    {" · "}
                    {formatEstimate(step.plannedPersonHours, "person-hours")}
                  </p>
                  {step.description && <p className="mt-1 text-slate-600">{step.description}</p>}
                  {step.sourceNote && <p className="mt-1 text-slate-500">Source: {step.sourceNote}</p>}
                  {retiringId === step.id ? (
                    <div className="mt-2 space-y-2">
                      <input className={input} aria-label="Reason for retiring" placeholder="Reason for retiring (required)"
                        value={retireReason} onChange={(e) => setRetireReason(e.target.value)} maxLength={1000} required />
                      <label className="flex items-center gap-2 text-xs text-slate-700">
                        <input type="checkbox" aria-label="Record this retirement as a historical correction"
                          checked={retireHistoricalCorrection}
                          onChange={(e) => setRetireHistoricalCorrection(e.target.checked)} />
                        Record this retirement as a historical correction
                      </label>
                      <div className="flex gap-2">
                        <button className={btnPrimary} disabled={busy || !retireReason.trim()}
                          onClick={() => onConfirmRetire(step)}>
                          Retire this step
                        </button>
                        <button className={btnGhost} disabled={busy}
                          onClick={() => { setRetiringId(null); setRetireReason(""); setRetireHistoricalCorrection(false); }}>
                          Keep it
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {!step.retiredAt && !isTerminal && (
                        <>
                          <button className={btnGhost} disabled={busy}
                            onClick={() => onMove(step, -1)}
                            aria-label={`Move ${step.title} up`}>
                            ↑ Move up
                          </button>
                          <button className={btnGhost} disabled={busy}
                            onClick={() => onMove(step, 1)}
                            aria-label={`Move ${step.title} down`}>
                            ↓ Move down
                          </button>
                        </>
                      )}
                      {!step.retiredAt && (
                        <>
                          <button className={btnGhost} disabled={busy} onClick={() => startEdit(step)}>Edit</button>
                          <button className={btnGhost} disabled={busy}
                            onClick={() => { setRetiringId(step.id); setRetireReason(""); setRetireHistoricalCorrection(false); setEditingId(null); }}>
                            Retire
                          </button>
                        </>
                      )}
                      <button className={btnGhost} disabled={busy}
                        onClick={() => setDrawingsId((current) => (current === step.id ? null : step.id))}>
                        {drawingsId === step.id ? "Hide drawings" : "Drawings"}
                      </button>
                      <button className={btnGhost} disabled={busy}
                        onClick={() => setHistoryId((current) => (current === step.id ? null : step.id))}>
                        {historyId === step.id ? "Hide history" : "History"}
                      </button>
                    </div>
                  )}
                  {drawingsId === step.id && (
                    <StepDrawings packageId={packageId} step={step} drawings={drawings} busy={busy}
                      onChanged={() => reload()} />
                  )}
                  {historyId === step.id && (
                    <StepHistory packageId={packageId} stepId={step.id} />
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
