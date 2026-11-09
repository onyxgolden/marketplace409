"use client";

import { useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { withWorkspaceQuery } from "./workspaceQuery.js";

const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const label = "block text-xs font-medium text-slate-600 mb-1";
const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;

async function api(path, options) {
  const response = await fetch(withWorkspaceQuery(path), {
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
  retire: "Retired",
  parent_drawing_deleted: "Retired — parent drawing deleted",
};

function formatWhen(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function snapshotSummary(values) {
  if (!values) return "—";
  const parts = [];
  if (values.label != null) parts.push(`label “${values.label}”`);
  if (values.url != null) parts.push(`link ${values.url}`);
  if (values.permit_reference != null) parts.push(`reference ${values.permit_reference}`);
  if (values.retired_at != null) parts.push("retired");
  return parts.length > 0 ? parts.join(", ") : "—";
}

function AnnotationHistory({ packageId, annotationId }) {
  const { data, error, isLoading } = useStaleWhileRevalidate(
    `work-packages:${packageId}:permit-annotations:${annotationId}:revisions`,
    () => api(`/api/work-packages/${packageId}/permit-annotations/${annotationId}/revisions`).then((b) => b.revisions),
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
          {revision.action === "update" && (
            <span className="block text-slate-500">
              {snapshotSummary(revision.oldValues)} → {snapshotSummary(revision.newValues)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

// Permit LINK annotations on a package (scope "package") or one drawing
// (scope "drawing" + drawingId). Links, not records: a label plus an
// HTTPS web address, with an optional permit reference and note. There
// is no permit lifecycle here — a link is added, edited, or retired,
// and every change stays in its history. Controlled drawings are never
// edited by annotating; this panel only ever writes annotations.
export default function WorkPackagePermitAnnotations({ packageId, scope, drawingId = null, onChanged = null }) {
  const [showRetired, setShowRetired] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [form, setForm] = useState({ label: "", url: "", permitReference: "", note: "" });
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ label: "", url: "", permitReference: "", note: "", reason: "" });
  const [retiringId, setRetiringId] = useState(null);
  const [retireReason, setRetireReason] = useState("");
  const [historyId, setHistoryId] = useState(null);

  const query = `targetKind=${scope}${drawingId ? `&drawingId=${encodeURIComponent(drawingId)}` : ""}${showRetired ? "&includeRetired=true" : ""}`;
  const { data, error: loadError, isLoading, refresh } = useStaleWhileRevalidate(
    `work-packages:${packageId}:permit-annotations:${scope}${drawingId ? `:${drawingId}` : ""}:${showRetired ? "retired" : "active"}`,
    () => api(`/api/work-packages/${packageId}/permit-annotations?${query}`).then((b) => b.annotations),
    { ttlMs: 10_000 },
  );
  const annotations = data || [];
  const heading = scope === "drawing" ? "Permit links — this drawing" : "Permit links";

  async function reload(message) {
    if (message) setConfirmation(message);
    await refresh();
    if (onChanged) onChanged();
  }

  async function onCreate(event) {
    event.preventDefault();
    setBusy(true); setError(""); setConfirmation("");
    try {
      const body = {
        targetKind: scope,
        ...(drawingId ? { drawingId } : {}),
        label: form.label,
        url: form.url,
        ...(form.permitReference.trim() ? { permitReference: form.permitReference } : {}),
        ...(form.note.trim() ? { note: form.note } : {}),
      };
      const created = await api(`/api/work-packages/${packageId}/permit-annotations`, {
        method: "POST", body: JSON.stringify(body),
      });
      setForm({ label: "", url: "", permitReference: "", note: "" });
      await reload(`Permit link added — “${created.annotation.label}”.`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  function startEdit(annotation) {
    setEditingId(annotation.id);
    setRetiringId(null);
    setEditForm({
      label: annotation.label,
      url: annotation.url,
      permitReference: annotation.permitReference || "",
      note: annotation.note || "",
      reason: "",
    });
    setError(""); setConfirmation("");
  }

  async function onSaveEdit(event, annotation) {
    event.preventDefault();
    setBusy(true); setError(""); setConfirmation("");
    try {
      const updated = await api(`/api/work-packages/${packageId}/permit-annotations/${annotation.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: annotation.version,
          label: editForm.label,
          url: editForm.url,
          permitReference: editForm.permitReference,
          note: editForm.note,
          ...(editForm.reason.trim() ? { reason: editForm.reason } : {}),
        }),
      });
      setEditingId(null);
      await reload(`Permit link updated — “${updated.annotation.label}”.`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function onConfirmRetire(annotation) {
    setBusy(true); setError(""); setConfirmation("");
    try {
      const retired = await api(`/api/work-packages/${packageId}/permit-annotations/${annotation.id}/retire`, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: annotation.version,
          ...(retireReason.trim() ? { reason: retireReason } : {}),
        }),
      });
      setRetiringId(null);
      setRetireReason("");
      await reload(`Permit link retired — “${retired.annotation.label}”.`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">{heading}</h2>
      <p className="mt-1 text-xs text-slate-500">
        Links to the permit authority’s pages — the permit itself lives on their site, not here.
        A link is added, edited, or retired; every change stays in its history.
      </p>
      {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {confirmation && <p className="mt-2 text-sm text-emerald-700">{confirmation}</p>}

      <form onSubmit={onCreate} className="mt-3 space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <label className={label} htmlFor={`permit-label-${scope}-${drawingId || "package"}`}>Label</label>
            <input id={`permit-label-${scope}-${drawingId || "package"}`} className={input}
              placeholder="e.g. City permit portal" value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} required maxLength={160} />
          </div>
          <div className="flex-[2]">
            <label className={label} htmlFor={`permit-url-${scope}-${drawingId || "package"}`}>Web address (https)</label>
            <input id={`permit-url-${scope}-${drawingId || "package"}`} className={input} type="url"
              placeholder="https://…" value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} required maxLength={2048} />
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <label className={label} htmlFor={`permit-ref-${scope}-${drawingId || "package"}`}>Permit reference (optional)</label>
            <input id={`permit-ref-${scope}-${drawingId || "package"}`} className={input}
              placeholder="e.g. PERMIT-2026-0142" value={form.permitReference}
              onChange={(e) => setForm((f) => ({ ...f, permitReference: e.target.value }))} maxLength={120} />
          </div>
          <div className="flex-[2]">
            <label className={label} htmlFor={`permit-note-${scope}-${drawingId || "package"}`}>Note (optional)</label>
            <input id={`permit-note-${scope}-${drawingId || "package"}`} className={input}
              placeholder="What this link is for" value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} maxLength={1000} />
          </div>
          <div className="flex items-end">
            <button type="submit" className={btnPrimary} disabled={busy}>Add link</button>
          </div>
        </div>
      </form>

      <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
        Show retired links
      </label>

      {isLoading ? (
        <p className="mt-3 text-xs text-slate-500">Loading permit links…</p>
      ) : annotations.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">No permit links yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {annotations.map((annotation) => (
            <li key={annotation.id} className="rounded border border-slate-100 p-3 text-xs">
              {editingId === annotation.id ? (
                <form onSubmit={(e) => onSaveEdit(e, annotation)} className="space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input className={input} aria-label="Label" value={editForm.label}
                      onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))} required maxLength={160} />
                    <input className={`${input} flex-[2]`} aria-label="Web address" type="url" value={editForm.url}
                      onChange={(e) => setEditForm((f) => ({ ...f, url: e.target.value }))} required maxLength={2048} />
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input className={input} aria-label="Permit reference" placeholder="Permit reference (optional)"
                      value={editForm.permitReference}
                      onChange={(e) => setEditForm((f) => ({ ...f, permitReference: e.target.value }))} maxLength={120} />
                    <input className={`${input} flex-[2]`} aria-label="Note" placeholder="Note (optional)"
                      value={editForm.note}
                      onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))} maxLength={1000} />
                  </div>
                  <input className={input} aria-label="Reason for this change" placeholder="Reason for this change (optional)"
                    value={editForm.reason}
                    onChange={(e) => setEditForm((f) => ({ ...f, reason: e.target.value }))} maxLength={2000} />
                  <div className="flex gap-2">
                    <button type="submit" className={btnPrimary} disabled={busy}>Save changes</button>
                    <button type="button" className={btnGhost} disabled={busy} onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <a href={annotation.url} target="_blank" rel="noopener noreferrer"
                        className="font-medium text-slate-900 underline">
                        {annotation.label}
                      </a>
                      {annotation.permitReference && (
                        <span className="ml-2 text-slate-500">Ref: {annotation.permitReference}</span>
                      )}
                      {annotation.retiredAt && (
                        <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-slate-600">Retired</span>
                      )}
                    </div>
                    <span className="text-slate-400">v{annotation.version}</span>
                  </div>
                  <p className="mt-1 break-all text-slate-500">{annotation.url}</p>
                  {annotation.note && <p className="mt-1 text-slate-600">{annotation.note}</p>}
                  {retiringId === annotation.id ? (
                    <div className="mt-2 space-y-2">
                      <input className={input} aria-label="Reason for retiring" placeholder="Reason for retiring (optional)"
                        value={retireReason} onChange={(e) => setRetireReason(e.target.value)} maxLength={2000} />
                      <div className="flex gap-2">
                        <button className={btnPrimary} disabled={busy} onClick={() => onConfirmRetire(annotation)}>
                          Retire this link
                        </button>
                        <button className={btnGhost} disabled={busy}
                          onClick={() => { setRetiringId(null); setRetireReason(""); }}>
                          Keep it
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {!annotation.retiredAt && (
                        <>
                          <button className={btnGhost} disabled={busy} onClick={() => startEdit(annotation)}>Edit</button>
                          <button className={btnGhost} disabled={busy}
                            onClick={() => { setRetiringId(annotation.id); setRetireReason(""); setEditingId(null); }}>
                            Retire
                          </button>
                        </>
                      )}
                      <button className={btnGhost} disabled={busy}
                        onClick={() => setHistoryId((current) => (current === annotation.id ? null : annotation.id))}>
                        {historyId === annotation.id ? "Hide history" : "History"}
                      </button>
                    </div>
                  )}
                  {historyId === annotation.id && (
                    <AnnotationHistory packageId={packageId} annotationId={annotation.id} />
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
