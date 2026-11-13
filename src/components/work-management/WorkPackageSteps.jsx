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

import { Fragment, useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { badgeClass } from "./WorkPackageDrawingReadiness.jsx";
import { usePageQuery, usePackagePageContext } from "./packagePageContext.jsx";
import { scopedSWRKey } from "./workspaceQuery.js";
import EditableGridCell from "./EditableGridCell.jsx";
import WorkPackageImportDialog from "./WorkPackageImportDialog.jsx";

// The work-steps worklist is a Maximo-style editable grid now (same
// pattern as the package list): double-click a cell, dropdown where
// the value is fixed, type where it isn't. The full edit form stays
// for the fields the grid does not carry (source note, reason,
// historical correction). Days/hours show as plain numbers — the old
// "Planned N days" card text is gone with the cards.
const STEPS_GRID_COLS = "grid-cols-[3rem_minmax(10rem,2fr)_minmax(10rem,2fr)_8rem_5.5rem_6rem_11rem]";
const BLANK_ROWS = 10;

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

async function api(pageQuery, path, options) {
  const response = await fetch(pageQuery(path), {
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
  // Bounded reads: one fixed-size page per request, with a growing
  // offset. "Show more" loads the next page and appends it — the
  // page size never grows, so no request can exceed the service's
  // 200-row limit however long the history gets.
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const [pages, setPages] = useState(1);
  const { data, error, isLoading } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "work-steps", stepId, "revisions", "pages", pages),
    () => fetchPagedRows(
      (page) => api(pageQuery, `/api/work-packages/${packageId}/work-steps/${stepId}/revisions?limit=${HISTORY_PAGE_SIZE}&offset=${page * HISTORY_PAGE_SIZE}`).then((b) => b.revisions),
      pages,
    ),
    { ttlMs: 10_000 },
  );
  if (isLoading) return <p className="mt-2 text-xs text-slate-500">Loading history…</p>;
  if (error) return <p className="mt-2 text-xs text-red-600">{error}</p>;
  const revisions = data || [];
  if (revisions.length === 0) return <p className="mt-2 text-xs text-slate-500">No history yet.</p>;
  return (
    <>
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
      {revisions.length === pages * HISTORY_PAGE_SIZE && (
        <button className={btnGhost} onClick={() => setPages((current) => current + 1)}>
          Show more history
        </button>
      )}
    </>
  );
}

function LinkHistory({ packageId, stepId, linkId }) {
  // Bounded reads, same shape as step history: fixed-size pages
  // with a growing offset, appended — never a cumulative limit.
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const [pages, setPages] = useState(1);
  const { data, error, isLoading } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "work-steps", stepId, "drawings", linkId, "revisions", "pages", pages),
    () => fetchPagedRows(
      (page) => api(pageQuery, `/api/work-packages/${packageId}/work-steps/${stepId}/drawings/${linkId}/revisions?limit=${HISTORY_PAGE_SIZE}&offset=${page * HISTORY_PAGE_SIZE}`).then((b) => b.revisions),
      pages,
    ),
    { ttlMs: 10_000 },
  );
  if (isLoading) return <p className="mt-2 text-xs text-slate-500">Loading history…</p>;
  if (error) return <p className="mt-2 text-xs text-red-600">{error}</p>;
  const revisions = data || [];
  if (revisions.length === 0) return <p className="mt-2 text-xs text-slate-500">No history yet.</p>;
  return (
    <>
      <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600">
        {revisions.map((revision) => (
          <li key={revision.id}>
            <span className="font-medium text-slate-900">{ACTION_LABELS[revision.action] || revision.action}</span>
            {` — version ${revision.version} · ${formatWhen(revision.recordedAt)}`}
            {revision.reason ? ` · “${revision.reason}”` : ""}
          </li>
        ))}
      </ul>
      {revisions.length === pages * HISTORY_PAGE_SIZE && (
        <button className={btnGhost} onClick={() => setPages((current) => current + 1)}>
          Show more history
        </button>
      )}
    </>
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
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const [linkDrawingId, setLinkDrawingId] = useState("");
  const [refinementNote, setRefinementNote] = useState("");
  const [linkError, setLinkError] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [retiringLinkId, setRetiringLinkId] = useState(null);
  const [retireReason, setRetireReason] = useState("");
  const [linkHistoryId, setLinkHistoryId] = useState(null);
  // Bounded reads: fixed-size pages with a growing offset,
  // appended — never a cumulative limit, which would break past
  // 200 rows because the service rejects any limit above 200.
  const [pages, setPages] = useState(1);

  const { data, error, isLoading, refresh } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "work-steps", step.id, "drawings", "pages", pages),
    () => fetchPagedRows(
      (page) => api(pageQuery, `/api/work-packages/${packageId}/work-steps/${step.id}/drawings?limit=${HISTORY_PAGE_SIZE}&offset=${page * HISTORY_PAGE_SIZE}`).then((b) => b.links),
      pages,
    ),
    { ttlMs: 10_000 },
  );
  const links = data || [];
  const activeDrawingIds = new Set(links.filter((l) => !l.retiredAt && l.drawingId).map((l) => l.drawingId));
  const linkableDrawings = (drawings || []).filter((d) => !activeDrawingIds.has(d.id));
  // Slice 7: the step's drawings carry their review badge from the
  // shared readiness snapshot (same cache key as the readiness panel,
  // so one fetch serves both). An IFA link is preliminary — it never
  // authorizes construction use; only an IFC release does.
  const { data: readinessData } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "drawing-readiness"),
    () => api(pageQuery, `/api/work-packages/${packageId}/drawings/readiness`),
    { ttlMs: 10_000 },
  );
  const readinessByDrawingId = new Map(
    (readinessData?.drawings || []).map((row) => [row.drawingId, row]),
  );

  async function onLink(event) {
    event.preventDefault();
    setLinkBusy(true); setLinkError("");
    try {
      await api(pageQuery, `/api/work-packages/${packageId}/work-steps/${step.id}/drawings`, {
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
      await api(pageQuery, `/api/work-packages/${packageId}/work-steps/${step.id}/drawings/${link.id}/retire`, {
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
              {link.drawingId && readinessByDrawingId.get(link.drawingId) && (
                <span className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${badgeClass(readinessByDrawingId.get(link.drawingId).badge)}`}>
                  Drawing: {readinessByDrawingId.get(link.drawingId).badge}
                </span>
              )}
              {link.drawingId && readinessByDrawingId.get(link.drawingId)?.constructionUsable === false
                && readinessByDrawingId.get(link.drawingId)?.preliminary === true && (
                <span className="ml-2 text-slate-500">— preliminary</span>
              )}
              {link.drawingId && readinessByDrawingId.get(link.drawingId)?.constructionUsable === true && (
                <span className="ml-2 text-slate-500">— construction issue</span>
              )}
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
      {links.length === pages * HISTORY_PAGE_SIZE && (
        <button className={btnGhost} onClick={() => setPages((current) => current + 1)}>
          Show more drawings
        </button>
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
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const { data, error } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "work-steps", "assignment-context"),
    () => api(pageQuery, `/api/work-packages/${packageId}/craft-assignments`).then((b) => b.dayTotals),
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
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
  const { data, error } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "work-steps", "progress-context"),
    () => api(pageQuery, `/api/work-packages/${packageId}/progress/summary`).then((b) => b.summary),
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
// The schedule is fetched exhaustively, in stable sequence order:
// active steps first (one page at a time), then retired steps
// separately. A single capped request can never stand for the whole
// schedule — past one page it would silently truncate the order a
// move depends on, and retired rows could crowd supersession
// candidates out of the page. Both loops stop on a short page, so a
// package with few steps still costs two requests and no more.
const LIST_PAGE_SIZE = 100;

async function fetchAllSteps(pageQuery, packageId) {
  const active = [];
  let offset = 0;
  let generation = 0;
  let packageStatus = "";
  for (;;) {
    const page = await api(pageQuery, 
      `/api/work-packages/${packageId}/work-steps?includeRetired=false&limit=${LIST_PAGE_SIZE}&offset=${offset}`,
    );
    if (offset === 0) {
      generation = page.generation ?? 0;
      packageStatus = page.packageStatus || "";
    }
    active.push(...(page.steps || []));
    if ((page.steps || []).length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }
  const retired = [];
  offset = 0;
  for (;;) {
    const page = await api(pageQuery, 
      `/api/work-packages/${packageId}/work-steps?retiredOnly=true&limit=${LIST_PAGE_SIZE}&offset=${offset}`,
    );
    retired.push(...(page.steps || []));
    if ((page.steps || []).length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }
  return { steps: [...active, ...retired], generation, packageStatus };
}

// One page of a history/drawing list. The "Show more" buttons below
// load the NEXT page at the same fixed size and append it — never a
// cumulative limit, which would break past 200 rows because the
// service rejects any limit above 200. Pages are appended and
// deduped by id, so a row is never shown twice if the list shifts
// between requests.
const HISTORY_PAGE_SIZE = 50;

async function fetchPagedRows(fetchPage, pageCount) {
  const rows = [];
  const seen = new Set();
  for (let page = 0; page < pageCount; page += 1) {
    const batch = await fetchPage(page);
    for (const row of batch || []) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        rows.push(row);
      }
    }
    if ((batch || []).length < HISTORY_PAGE_SIZE) break;
  }
  return rows;
}

export default function WorkPackageSteps({ packageId, onChanged = null }) {
  const pageQuery = usePageQuery();
  const pageContext = usePackagePageContext();
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
  // Blank add-rows: the grid always fills the page (minimum 10) when
  // the package is open, so the next step is typed in place. A blank
  // row's draft lives here until its title is present; only then does
  // it become a step (the server assigns its sequence number).
  const [drafts, setDrafts] = useState(() => Array.from({ length: BLANK_ROWS }, () => ({
    title: "", description: "", craftLabel: "", plannedDurationDays: "",
    plannedPersonHours: "", sourceNote: "", insertAt: "", supersedesStepId: "", reason: "",
  })));
  const [selectedId, setSelectedId] = useState(null);
  const [importOpen, setImportOpen] = useState(false);

  // Retired steps are fetched too (they are the only supersession
  // candidates), but hidden from the list unless asked for.
  const { data, error: loadError, isLoading, refresh } = useStaleWhileRevalidate(
    scopedSWRKey(pageContext, "work-packages", packageId, "work-steps", "all"),
    () => fetchAllSteps(pageQuery, packageId),
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
    scopedSWRKey(pageContext, "work-packages", packageId, "drawings"),
    () => api(pageQuery, `/api/work-packages/${packageId}/drawings`).then((b) => b.drawings),
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
      const created = await api(pageQuery, `/api/work-packages/${packageId}/work-steps`, {
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
      const updated = await api(pageQuery, `/api/work-packages/${packageId}/work-steps/${step.id}`, {
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
      const retired = await api(pageQuery, `/api/work-packages/${packageId}/work-steps/${step.id}/retire`, {
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
    // A single-step move, not a full permutation: the server computes
    // the new order from the live active set inside the transaction,
    // so the panel never has to enumerate a schedule longer than one
    // page to reorder it. The generation guard still applies.
    setBusy(true); setError(""); setConfirmation("");
    try {
      const moved = await api(pageQuery, `/api/work-packages/${packageId}/work-steps/${step.id}/move`, {
        method: "POST",
        body: JSON.stringify({
          targetSequenceNo: target + 1,
          expectedGeneration: generation,
        }),
      });
      await reload(`Schedule order updated — ${moved.steps.length} active steps.`);
    } catch (e) {
      setError(e.message);
      await refresh();
    } finally { setBusy(false); }
  }

  // A grid cell commit: one field through the existing PATCH, guarded
  // by the step's version. An emptied optional field is an explicit
  // clear (null); the cell's own validation already rejected a bad
  // number or an empty title, so a failure here is the server's word
  // (e.g. a version race) and the cell reverts with the message.
  async function onCommitCell(step, field, value) {
    const patch = { expectedVersion: step.version };
    if (field === "plannedDurationDays") {
      patch.plannedDurationDays = value === "" ? null : Number(value);
    } else if (field === "plannedPersonHours") {
      patch.plannedPersonHours = value === "" ? null : Number(value);
    } else if (field === "description" || field === "craftLabel") {
      patch[field] = value === "" ? null : value;
    } else {
      patch[field] = value;
    }
    const updated = await api(pageQuery, `/api/work-packages/${packageId}/work-steps/${step.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    await reload(`Work step updated — #${updated.step.sequenceNo} ${updated.step.title}.`);
  }

  function updateDraft(index, patch) {
    setDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
    return { ...drafts[index], ...patch };
  }

  // Typing into a blank row: the draft is kept even when the title is
  // missing (so a craft/days choice is not lost), and the row only
  // becomes a step once it has a title. The server assigns the
  // sequence number — never the client.
  async function commitBlank(index, field, value) {
    const draft = updateDraft(index, { [field]: value });
    if (!draft.title.trim()) {
      setError("Give the new step a title first — the row stays as a draft until it has one.");
      return;
    }
    setBusy(true); setError(""); setConfirmation("");
    try {
      const created = await api(pageQuery, `/api/work-packages/${packageId}/work-steps`, {
        method: "POST", body: JSON.stringify(createBody(draft)),
      });
      setDrafts((current) => current.map((d, i) => (i === index ? {
        title: "", description: "", craftLabel: "", plannedDurationDays: "",
        plannedPersonHours: "", sourceNote: "", insertAt: "", supersedesStepId: "", reason: "",
      } : d)));
      await reload(`Work step added — #${created.step.sequenceNo} ${created.step.title}.`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  function craftOptionsFor(currentLabel) {
    const options = [{ value: "", label: "—" }];
    for (const craft of COMMON_CRAFTS) options.push({ value: craft, label: craft });
    if (currentLabel && !COMMON_CRAFTS.includes(currentLabel)) {
      options.push({ value: currentLabel, label: currentLabel });
    }
    return options;
  }

  const validateDays = (next) => {
    if (next.trim() === "") return null;
    const n = Number(next);
    return Number.isInteger(n) && n >= 1 && n <= 366
      ? null : "Planned days must be a whole number from 1 to 366.";
  };

  const validateHours = (next) => {
    if (next.trim() === "") return null;
    const n = Number(next);
    return Number.isFinite(n) && n > 0 && n <= 1000000 && Math.round(n * 100) === n * 100
      ? null : "Planned hours must be more than 0 and at most 1,000,000, with at most two decimal places.";
  };

  // One schedule row plus its expandable detail rows (full edit form,
  // retire confirm, drawings, history). Retired rows are read-only:
  // their cells never edit and only Drawings / History are offered.
  function renderStepRow(step, activeIndex) {
    const retired = !!step.retiredAt;
    const cellError = (text) => setError(text);
    const isFirstActive = activeIndex === 0;
    const isLastActive = activeIndex === activeSteps.length - 1;
    return (
      <Fragment key={step.id}>
        <div role="row" data-step-id={step.id}
          onClick={() => setSelectedId(step.id)}
          className={`grid ${STEPS_GRID_COLS} items-center gap-x-2 border-b border-slate-200 px-3 py-2 text-sm ${selectedId === step.id ? "bg-blue-50" : "hover:bg-slate-50"} ${retired ? "opacity-70" : ""}`}>
          <div role="cell" className="min-w-0 truncate font-medium text-slate-900"
            title={`Step #${step.sequenceNo}, version ${step.version}`}>
            #{step.sequenceNo}
            {retired && <span className="ml-1 rounded bg-slate-100 px-1 text-xs text-slate-600">Retired</span>}
          </div>
          <EditableGridCell
            value={step.title}
            display={(
              <span>
                {step.title}
                {step.supersedesStepId && (
                  <span className="ml-2 text-slate-400">
                    · Replaces #{stepById.get(step.supersedesStepId)?.sequenceNo ?? "?"} {stepById.get(step.supersedesStepId)?.title ?? "a retired step"}
                  </span>
                )}
              </span>
            )}
            ariaLabel={`Title for step ${step.sequenceNo}`}
            readOnly={retired}
            validate={(next) => (next.trim() === "" ? "Title is required." : null)}
            onCommit={(next) => onCommitCell(step, "title", next)}
            onError={cellError}
            className="font-medium text-slate-900"
          />
          <EditableGridCell
            value={step.description || ""}
            display={step.description || "—"}
            ariaLabel={`Description for step ${step.sequenceNo}`}
            readOnly={retired}
            onCommit={(next) => onCommitCell(step, "description", next)}
            onError={cellError}
            className="text-slate-700"
          />
          <EditableGridCell
            value={step.craftLabel || ""}
            display={step.craftLabel || "—"}
            editor="select" options={craftOptionsFor(step.craftLabel)}
            ariaLabel={`Craft for step ${step.sequenceNo}`}
            readOnly={retired}
            onCommit={(next) => onCommitCell(step, "craftLabel", next)}
            onError={cellError}
            className="text-slate-700"
          />
          <EditableGridCell
            value={step.plannedDurationDays == null ? "" : String(step.plannedDurationDays)}
            display={step.plannedDurationDays == null ? "—" : String(step.plannedDurationDays)}
            editor="number" ariaLabel={`Planned days for step ${step.sequenceNo}`}
            readOnly={retired} validate={validateDays}
            onCommit={(next) => onCommitCell(step, "plannedDurationDays", next)}
            onError={cellError}
            className="text-slate-700"
          />
          <EditableGridCell
            value={step.plannedPersonHours == null ? "" : String(step.plannedPersonHours)}
            display={step.plannedPersonHours == null ? "—" : String(step.plannedPersonHours)}
            editor="number" ariaLabel={`Planned hours for step ${step.sequenceNo}`}
            readOnly={retired} validate={validateHours}
            onCommit={(next) => onCommitCell(step, "plannedPersonHours", next)}
            onError={cellError}
            className="text-slate-700"
          />
          <div role="cell" className="flex min-w-0 flex-wrap gap-1">
            {!retired && !isTerminal && (
              <>
                <button className={btnGhost} disabled={busy || isFirstActive}
                  onClick={() => onMove(step, -1)}
                  title={isFirstActive ? "Already the first step" : undefined}
                  aria-label={`Move ${step.title} up`}>
                  ↑
                </button>
                <button className={btnGhost} disabled={busy || isLastActive}
                  onClick={() => onMove(step, 1)}
                  title={isLastActive ? "Already the last step" : undefined}
                  aria-label={`Move ${step.title} down`}>
                  ↓
                </button>
              </>
            )}
            {!retired && (
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
        </div>
        {editingId === step.id && (
          <div role="row" className={`grid ${STEPS_GRID_COLS} border-b border-slate-200 bg-slate-50 px-3 py-3`}>
            <div role="cell" className="col-span-7">
              <form onSubmit={(e) => onSaveEdit(e, step)} className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input className={`${input} min-w-[14rem] flex-1`} aria-label="Step title" value={editForm.title}
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
                {step.sourceNote && (
                  <p className="text-xs text-slate-500">Source: {step.sourceNote}</p>
                )}
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
            </div>
          </div>
        )}
        {retiringId === step.id && (
          <div role="row" className={`grid ${STEPS_GRID_COLS} border-b border-slate-200 bg-slate-50 px-3 py-3`}>
            <div role="cell" className="col-span-7 space-y-2">
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
          </div>
        )}
        {drawingsId === step.id && (
          <div role="row" className={`grid ${STEPS_GRID_COLS} border-b border-slate-200 bg-slate-50 px-3 py-3`}>
            <div role="cell" className="col-span-7">
              <StepDrawings packageId={packageId} step={step} drawings={drawings} busy={busy}
                onChanged={() => reload()} />
            </div>
          </div>
        )}
        {historyId === step.id && (
          <div role="row" className={`grid ${STEPS_GRID_COLS} border-b border-slate-200 bg-slate-50 px-3 py-3`}>
            <div role="cell" className="col-span-7">
              <StepHistory packageId={packageId} stepId={step.id} />
            </div>
          </div>
        )}
      </Fragment>
    );
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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
          Show retired
        </label>
        {!isTerminal && (
          <button type="button" onClick={() => setImportOpen(true)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Import from file
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="mt-3 text-xs text-slate-500">Loading work steps…</p>
      ) : loadError ? null : (
        // The worklist IS the grid: double-click a cell to edit it,
        // blank rows fill the page so the next step is typed in place.
        // A closed package gets no blank rows and no add pointer — the
        // dead "add the first one above" text is gone.
        <div role="table" aria-label="Work steps" className="mt-4 border-t border-slate-300">
          <div role="row" className={`grid ${STEPS_GRID_COLS} items-center gap-x-2 border-b-2 border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500`}>
            <div role="columnheader">#</div>
            <div role="columnheader">Title</div>
            <div role="columnheader">Description</div>
            <div role="columnheader">Craft</div>
            <div role="columnheader">Planned days</div>
            <div role="columnheader">Planned hours</div>
            <div role="columnheader">Actions</div>
          </div>
          {isTerminal && steps.length === 0 && (
            <p className="px-3 py-3 text-xs text-slate-500">This package is closed — no work steps were added.</p>
          )}
          {activeSteps.map((step, index) => renderStepRow(step, index))}
          {!isTerminal && drafts.map((draft, index) => (
            <div key={`blank-${index}`} role="row" data-blank-row={index}
              className={`grid ${STEPS_GRID_COLS} items-center gap-x-2 border-b border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-sm`}>
              <div role="cell" className="min-w-0 truncate text-slate-300">—</div>
              <EditableGridCell
                value={draft.title} display={draft.title || "New step title…"}
                ariaLabel={`Title for new step row ${index + 1}`} placeholder="New step title"
                onCommit={(next) => commitBlank(index, "title", next)}
                onError={(text) => setError(text)}
                className="font-medium text-slate-400"
              />
              <EditableGridCell
                value={draft.description} display={draft.description || "—"}
                ariaLabel={`Description for new step row ${index + 1}`} placeholder="Description"
                onCommit={(next) => commitBlank(index, "description", next)}
                onError={(text) => setError(text)}
                className="text-slate-700"
              />
              <EditableGridCell
                value={draft.craftLabel} display={draft.craftLabel || "—"}
                editor="select" options={craftOptionsFor(draft.craftLabel)}
                ariaLabel={`Craft for new step row ${index + 1}`}
                onCommit={(next) => commitBlank(index, "craftLabel", next)}
                onError={(text) => setError(text)}
                className="text-slate-700"
              />
              <EditableGridCell
                value={draft.plannedDurationDays} display={draft.plannedDurationDays || "—"}
                editor="number" ariaLabel={`Planned days for new step row ${index + 1}`}
                validate={validateDays}
                onCommit={(next) => commitBlank(index, "plannedDurationDays", next)}
                onError={(text) => setError(text)}
                className="text-slate-700"
              />
              <EditableGridCell
                value={draft.plannedPersonHours} display={draft.plannedPersonHours || "—"}
                editor="number" ariaLabel={`Planned hours for new step row ${index + 1}`}
                validate={validateHours}
                onCommit={(next) => commitBlank(index, "plannedPersonHours", next)}
                onError={(text) => setError(text)}
                className="text-slate-700"
              />
              <div role="cell" className="min-w-0 truncate text-slate-300">—</div>
            </div>
          ))}
          {showRetired && retiredSteps.map((step) => renderStepRow(step))}
        </div>
      )}
      {importOpen && (
        <WorkPackageImportDialog
          kind="steps"
          packageId={packageId}
          onImported={(summary) => reload(summary?.message || "Import applied.")}
          onClose={() => setImportOpen(false)}
        />
      )}
    </section>
  );
}
