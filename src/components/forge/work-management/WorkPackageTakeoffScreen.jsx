"use client";
// FORGE Work Management — Work Package Planner, slice 1 UI: drawing-set
// intake and per-P&ID takeoff totals. Data loading goes through the same
// useStaleWhileRevalidate hook every other FORGE screen uses (never a
// hand-rolled useEffect+fetch, which this codebase's lint rule
// react-hooks/set-state-in-effect correctly refuses).
//
// Standing constraints this screen honors: everything shown here is
// editable, delete included, and every save/delete shows a visible
// success confirmation in plain words (names, not raw IDs).

import { useState } from "react";
import { ForgeLoadingState, ForgeErrorState, ForgeEmptyState } from "@/components/forge/ForgeStates";
import { forgeTheme } from "@/components/forge/theme";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { preIfcTag } from "@/domains/work-management/drawingReviews.js";
import WorkPackagePermitAnnotations from "@/components/work-management/WorkPackagePermitAnnotations";

const DRAWING_TYPE_LABELS = { p_id: "P&ID", cut_sheet: "Cut sheet", isometric: "Isometric" };
const CATEGORY_LABELS = { pipe: "Pipe", fitting: "Fitting", valve: "Valve", support: "Support", other: "Other" };

async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

function Confirmation({ message }) {
  if (!message) return null;
  return (
    <p role="status" className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
      {message}
    </p>
  );
}

function ErrorNote({ message }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-3 rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-bold text-red-800 dark:border-red-700 dark:bg-red-900/40 dark:text-red-300">
      {message}
    </p>
  );
}

function NewDrawingForm({ packageId, pIdDrawings, onCreated }) {
  const [drawingType, setDrawingType] = useState("p_id");
  const [drawingNumber, setDrawingNumber] = useState("");
  const [title, setTitle] = useState("");
  const [pIdDrawingId, setPIdDrawingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setConfirmation("");
    try {
      const body = { drawingNumber, drawingType, title: title || undefined };
      if (drawingType !== "p_id") body.pIdDrawingId = pIdDrawingId;
      const { drawing } = await api(`/api/work-packages/${packageId}/drawings`, {
        method: "POST", body: JSON.stringify(body),
      });
      setDrawingNumber(""); setTitle(""); setPIdDrawingId("");
      setConfirmation(`Saved — ${DRAWING_TYPE_LABELS[drawing.drawingType]} "${drawing.drawingNumber}" was added.`);
      onCreated(drawing);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={forgeTheme.panel}>
      <p className={forgeTheme.labelSmall}>Bring in a drawing</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className={forgeTheme.labelSmall}>Drawing type</span>
          <select value={drawingType} onChange={(e) => setDrawingType(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-bold text-slate-950">
            <option value="p_id">P&amp;ID</option>
            <option value="cut_sheet">Cut sheet</option>
            <option value="isometric">Isometric</option>
          </select>
        </label>
        <label className="text-sm">
          <span className={forgeTheme.labelSmall}>Drawing number</span>
          <input value={drawingNumber} onChange={(e) => setDrawingNumber(e.target.value)} required
            placeholder="P-101" className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-950" />
        </label>
        {drawingType !== "p_id" && (
          <label className="text-sm sm:col-span-2">
            <span className={forgeTheme.labelSmall}>Which P&amp;ID does this roll up to?</span>
            <select value={pIdDrawingId} onChange={(e) => setPIdDrawingId(e.target.value)} required
              className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-bold text-slate-950">
              <option value="">Select a P&amp;ID…</option>
              {pIdDrawings.map((d) => (
                <option key={d.id} value={d.id}>{d.drawingNumber}{d.title ? ` — ${d.title}` : ""}</option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm sm:col-span-2">
          <span className={forgeTheme.labelSmall}>Title (optional)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-950" />
        </label>
      </div>
      <button type="submit" disabled={busy}
        className="mt-4 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">
        {busy ? "Saving…" : "Add drawing"}
      </button>
      <Confirmation message={confirmation} />
      <ErrorNote message={error} />
    </form>
  );
}

function NewLineForm({ packageId, drawingId, onCreated }) {
  const [description, setDescription] = useState("");
  const [materialSpec, setMaterialSpec] = useState("");
  const [sizeLabel, setSizeLabel] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState("pipe");
  const [fabLocation, setFabLocation] = useState("shop");
  const [fieldWeldCount, setFieldWeldCount] = useState("0");
  const [requiresFieldFit, setRequiresFieldFit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setConfirmation("");
    try {
      const { line } = await api(`/api/work-packages/${packageId}/drawings/${drawingId}/takeoff-lines`, {
        method: "POST",
        body: JSON.stringify({
          description, materialSpec: materialSpec || undefined, sizeLabel: sizeLabel || undefined,
          quantity: Number(quantity), unit, category, fabLocation,
          fieldWeldCount: Number(fieldWeldCount) || 0, requiresFieldFit,
        }),
      });
      setDescription(""); setMaterialSpec(""); setSizeLabel(""); setQuantity(""); setUnit("");
      setFieldWeldCount("0"); setRequiresFieldFit(false);
      setConfirmation(`Saved — line ${line.lineNo}, "${line.description}" was added.`);
      onCreated(line);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className={forgeTheme.panelSoft}>
      <p className={forgeTheme.labelSmall}>Add a takeoff line</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input value={description} onChange={(e) => setDescription(e.target.value)} required
          placeholder="Description" className="col-span-2 rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-950 sm:col-span-1" />
        <input value={materialSpec} onChange={(e) => setMaterialSpec(e.target.value)}
          placeholder="Material spec" className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-950" />
        <input value={sizeLabel} onChange={(e) => setSizeLabel(e.target.value)}
          placeholder="Size" className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-950" />
        <input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" step="any" min="0" required
          placeholder="Qty" className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-950" />
        <input value={unit} onChange={(e) => setUnit(e.target.value)} required
          placeholder="Unit (ft, ea…)" className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-950" />
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-bold text-slate-950">
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={fabLocation} onChange={(e) => setFabLocation(e.target.value)}
          className="rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-bold text-slate-950">
          <option value="shop">Shop fab</option>
          <option value="field">Field install</option>
        </select>
        <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-bold text-slate-700">
          FW count
          <input value={fieldWeldCount} onChange={(e) => setFieldWeldCount(e.target.value)} type="number" step="1" min="0"
            className="w-14 rounded border border-slate-300 px-1 py-1 text-sm text-slate-950" />
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-2.5 py-2 text-xs font-bold text-slate-700">
          <input type="checkbox" checked={requiresFieldFit} onChange={(e) => setRequiresFieldFit(e.target.checked)} />
          FFW (random)
        </label>
      </div>
      <button type="submit" disabled={busy}
        className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
        {busy ? "Saving…" : "Add line"}
      </button>
      <Confirmation message={confirmation} />
      <ErrorNote message={error} />
    </form>
  );
}

function LineRow({ packageId, drawingId, line, onChanged, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function startEdit() {
    setDraft(line);
    setEditing(true);
    setError("");
  }

  async function onSave() {
    setBusy(true);
    setError("");
    try {
      const { line: updated } = await api(`/api/work-packages/${packageId}/drawings/${drawingId}/takeoff-lines/${line.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          description: draft.description, materialSpec: draft.materialSpec || undefined,
          sizeLabel: draft.sizeLabel || undefined, quantity: Number(draft.quantity), unit: draft.unit,
          category: draft.category, fabLocation: draft.fabLocation,
          fieldWeldCount: Number(draft.fieldWeldCount) || 0, requiresFieldFit: !!draft.requiresFieldFit,
        }),
      });
      setEditing(false);
      onChanged(updated, `Saved — line ${updated.lineNo} updated.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/work-packages/${packageId}/drawings/${drawingId}/takeoff-lines/${line.id}`, { method: "DELETE" });
      onDeleted(line.id, line.description);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <tr className="border-b border-slate-200 bg-amber-50 text-sm dark:border-slate-800 dark:bg-amber-900/20">
        <td className="py-2 pr-3">{line.lineNo}</td>
        <td className="py-2 pr-3"><input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="w-full rounded border border-slate-300 px-1.5 py-1 text-slate-950" /></td>
        <td className="py-2 pr-3">
          <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className="rounded border border-slate-300 px-1.5 py-1 text-slate-950">
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </td>
        <td className="py-2 pr-3">
          <input value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} type="number" step="any" min="0" className="w-16 rounded border border-slate-300 px-1.5 py-1 text-slate-950" />{" "}
          <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} className="w-14 rounded border border-slate-300 px-1.5 py-1 text-slate-950" />
        </td>
        <td className="py-2 pr-3">
          <select value={draft.fabLocation} onChange={(e) => setDraft({ ...draft, fabLocation: e.target.value })} className="rounded border border-slate-300 px-1.5 py-1 text-slate-950">
            <option value="shop">Shop</option>
            <option value="field">Field</option>
          </select>
        </td>
        <td className="py-2 pr-3"><input value={draft.fieldWeldCount} onChange={(e) => setDraft({ ...draft, fieldWeldCount: e.target.value })} type="number" step="1" min="0" className="w-14 rounded border border-slate-300 px-1.5 py-1 text-slate-950" /></td>
        <td className="py-2 pr-3"><input type="checkbox" checked={!!draft.requiresFieldFit} onChange={(e) => setDraft({ ...draft, requiresFieldFit: e.target.checked })} /></td>
        <td className="py-2">
          <button type="button" onClick={onSave} disabled={busy} className="rounded-lg bg-slate-950 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
          <button type="button" onClick={() => setEditing(false)} className="ml-2 text-xs font-bold text-slate-600">Cancel</button>
          {error && <div role="alert" className="mt-1 text-xs font-bold text-red-700">{error}</div>}
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-slate-200 text-sm dark:border-slate-800">
      <td className="py-2 pr-3">{line.lineNo}</td>
      <td className="py-2 pr-3">{line.description}</td>
      <td className="py-2 pr-3">{CATEGORY_LABELS[line.category] || line.category}</td>
      <td className="py-2 pr-3">{line.quantity} {line.unit}</td>
      <td className="py-2 pr-3">{line.fabLocation === "shop" ? "Shop" : "Field"}</td>
      <td className="py-2 pr-3">{line.fieldWeldCount || 0}</td>
      <td className="py-2 pr-3">{line.requiresFieldFit ? "Yes" : "—"}</td>
      <td className="py-2">
        <button type="button" onClick={startEdit} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-700">Edit</button>
        <button type="button" onClick={onDelete} disabled={busy}
          className="ml-2 rounded-lg border border-red-300 px-2.5 py-1 text-xs font-bold text-red-700 disabled:opacity-50">
          {busy ? "Deleting…" : "Delete"}
        </button>
        {error && <div role="alert" className="mt-1 text-xs font-bold text-red-700">{error}</div>}
      </td>
    </tr>
  );
}

function EstimateTable({ title, estimate }) {
  const units = Object.keys(estimate.totalQuantityByUnit);
  return (
    <div className={forgeTheme.panelSoft}>
      <p className={forgeTheme.labelSmall}>{title}</p>
      <p className="mt-1 text-sm font-bold">{estimate.lineCount} line{estimate.lineCount === 1 ? "" : "s"}</p>
      {units.length === 0 ? (
        <p className={`mt-1 ${forgeTheme.muted}`}>No quantity yet.</p>
      ) : (
        <ul className="mt-1 text-sm">
          {units.map((unit) => <li key={unit}>{estimate.totalQuantityByUnit[unit]} {unit}</li>)}
        </ul>
      )}
    </div>
  );
}

function PidSummaryPanel({ packageId, pIdDrawing, refreshToken }) {
  const { data: summary, error, isLoading, refresh } = useStaleWhileRevalidate(
    `work-packages:drawing:${pIdDrawing.id}:summary:${refreshToken}`,
    () => api(`/api/work-packages/${packageId}/drawings/${pIdDrawing.id}/summary`).then((b) => b.summary),
    { ttlMs: 10_000 },
  );

  if (isLoading) return <ForgeLoadingState label={`Loading the ${pIdDrawing.drawingNumber} takeoff summary…`} />;
  if (error) return <ForgeErrorState title="Unable to load the takeoff summary" detail={error} onRetry={refresh} />;
  if (!summary) return null;

  return (
    <div className={forgeTheme.panel}>
      <p className={forgeTheme.labelSmall}>Takeoff summary — {pIdDrawing.drawingNumber}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <EstimateTable title="Shop fabrication estimate" estimate={summary.shopFieldSplit.shop} />
        <EstimateTable title="Field install estimate" estimate={summary.shopFieldSplit.field} />
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <p><span className={forgeTheme.labelSmall}>Suggested field welds (FW):</span> <strong>{summary.fwFfw.suggestedFieldWelds}</strong></p>
        <p><span className={forgeTheme.labelSmall}>Suggested FFW (randoms):</span> <strong>{summary.fwFfw.suggestedFfwCount}</strong></p>
      </div>
      {summary.fwFfw.ffwLines.length > 0 && (
        <ul className="mt-2 text-xs text-slate-600 dark:text-slate-400">
          {summary.fwFfw.ffwLines.map((l) => <li key={`${l.drawingId}-${l.lineNo}`}>Line {l.lineNo}: {l.description}</li>)}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">Suggestions only — review and adjust before ordering. An FFW line is a random (field-cut, verified on site), never a fixed cut length.</p>
    </div>
  );
}

function LinesTable({ packageId, drawingId, lines, onChanged, onDeleted }) {
  if (lines.length === 0) {
    return <p className={`mt-3 ${forgeTheme.muted}`}>No takeoff lines on this drawing yet.</p>;
  }
  return (
    <table className="mt-3 w-full text-left">
      <thead>
        <tr className={forgeTheme.labelSmall}>
          <th className="pb-1 pr-3">#</th>
          <th className="pb-1 pr-3">Description</th>
          <th className="pb-1 pr-3">Category</th>
          <th className="pb-1 pr-3">Qty</th>
          <th className="pb-1 pr-3">Fab</th>
          <th className="pb-1 pr-3">FW</th>
          <th className="pb-1 pr-3">FFW</th>
          <th className="pb-1">Actions</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <LineRow key={line.id} packageId={packageId} drawingId={drawingId} line={line} onChanged={onChanged} onDeleted={onDeleted} />
        ))}
      </tbody>
    </table>
  );
}

function DrawingPanel({ packageId, drawing, onDrawingDeleted, onAnnotationsChanged }) {
  const [confirmation, setConfirmation] = useState("");
  const [drawingBusy, setDrawingBusy] = useState(false);
  const [drawingError, setDrawingError] = useState("");
  // Bumped only to re-key the leaf PidSummaryPanel below (a small,
  // self-contained refetch flash there is fine); the lines list itself
  // uses a stable key + refresh() so this panel's own form/confirmation
  // state is never wiped by a mutation's refetch — same reasoning as the
  // top-level drawings list above.
  const [summaryRefreshToken, setSummaryRefreshToken] = useState(0);
  const { data: lines, error, isLoading, refresh } = useStaleWhileRevalidate(
    `work-packages:drawing:${drawing.id}:lines`,
    () => api(`/api/work-packages/${packageId}/drawings/${drawing.id}/takeoff-lines`).then((b) => b.lines),
    { ttlMs: 10_000 },
  );

  function bump() {
    refresh();
    setSummaryRefreshToken((t) => t + 1);
  }

  function onLineCreated() {
    bump();
  }

  function onLineChanged(updatedLine, message) {
    setConfirmation(message);
    bump();
  }

  function onLineDeleted(lineId, description) {
    setConfirmation(`Deleted — "${description}" was removed.`);
    bump();
  }

  async function onDrawingDelete() {
    setDrawingBusy(true);
    setDrawingError("");
    try {
      await api(`/api/work-packages/${packageId}/drawings/${drawing.id}`, { method: "DELETE" });
      onDrawingDeleted(drawing);
    } catch (err) {
      setDrawingError(err.message);
      setDrawingBusy(false);
    }
  }

  return (
    <div className={forgeTheme.cardCompact}>
      <div className="flex items-center justify-between">
        <div>
          <p className={forgeTheme.labelSmall}>{DRAWING_TYPE_LABELS[drawing.drawingType]}</p>
          <p className="text-lg font-black">{drawing.drawingNumber}{drawing.title ? ` — ${drawing.title}` : ""}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onDrawingDelete} disabled={drawingBusy}
            className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-bold text-red-700 disabled:opacity-50">
            {drawingBusy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
      <ErrorNote message={drawingError} />

      <div className="mt-4">
        <NewLineForm packageId={packageId} drawingId={drawing.id} onCreated={onLineCreated} />
      </div>

      <div className="mt-4">
        <p className={forgeTheme.labelSmall}>Takeoff lines</p>
        {isLoading && <ForgeLoadingState label="Loading takeoff lines…" />}
        {error && <ForgeErrorState title="Unable to load takeoff lines" detail={error} onRetry={refresh} />}
        {!isLoading && !error && lines && (
          <LinesTable packageId={packageId} drawingId={drawing.id} lines={lines} onChanged={onLineChanged} onDeleted={onLineDeleted} />
        )}
        <Confirmation message={confirmation} />
      </div>

      <div className="mt-4">
        <WorkPackagePermitAnnotations
          packageId={packageId}
          scope="drawing"
          drawingId={drawing.id}
          onChanged={onAnnotationsChanged}
        />
      </div>

      {drawing.drawingType === "p_id" && (
        <div className="mt-4">
          <PidSummaryPanel packageId={packageId} pIdDrawing={drawing} refreshToken={summaryRefreshToken} />
        </div>
      )}
    </div>
  );
}

function EntryHistoryList({ packageId, entryId }) {
  const { data, error, isLoading, refresh } = useStaleWhileRevalidate(
    `work-packages:progress:${entryId}:revisions`,
    () => api(`/api/work-packages/${packageId}/progress/${entryId}/revisions`).then((b) => b.revisions),
    { ttlMs: 10_000 },
  );
  if (isLoading) return <ForgeLoadingState label="Loading entry history…" />;
  if (error) return <ForgeErrorState title="Unable to load entry history" detail={error} onRetry={refresh} />;
  if (!data || data.length === 0) return <p className={`mt-2 text-xs ${forgeTheme.muted}`}>No history yet.</p>;
  const actionLabel = { create: "Recorded", update: "Corrected", void: "Voided" };
  return (
    <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-400">
      {data.map((revision) => (
        <li key={revision.id}>
          Version {revision.version} — {actionLabel[revision.action] || revision.action}
          {revision.oldQuantity != null || revision.newQuantity != null
            ? `: ${revision.oldQuantity ?? "—"} → ${revision.newQuantity ?? "—"}`
            : ""}
          {revision.oldWorkDate !== revision.newWorkDate && revision.oldWorkDate != null
            ? `, date ${revision.oldWorkDate} → ${revision.newWorkDate}`
            : ""}
          {revision.reason ? ` — ${revision.reason}` : ""}
        </li>
      ))}
    </ul>
  );
}

function ProgressEntryRow({ packageId, entry, lineLabel, preIfc, onChanged }) {
  const [mode, setMode] = useState(null);
  const [quantity, setQuantity] = useState(String(entry.installedQuantity));
  const [workDate, setWorkDate] = useState(entry.workDate);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  async function onSaveCorrect() {
    setBusy(true);
    setError("");
    try {
      const { entry: updated } = await api(`/api/work-packages/${packageId}/progress/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: entry.version,
          installedQuantity: Number(quantity),
          workDate,
          reason: reason || undefined,
        }),
      });
      setMode(null);
      onChanged(`Saved — the ${updated.workDate} entry for "${lineLabel}" was corrected (version ${updated.version}).`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmVoid() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/work-packages/${packageId}/progress/${entry.id}/void`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: entry.version, reason: reason || undefined }),
      });
      setMode(null);
      onChanged(`Voided — the ${entry.workDate} entry for "${lineLabel}" no longer counts toward totals, and stays in history.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-slate-200 text-sm dark:border-slate-800">
      <td className="py-2 pr-3">{entry.workDate}</td>
      <td className="py-2 pr-3">{lineLabel}{preIfc && (
        <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
          title="Recorded against a preliminary (IFA) drawing — not yet issued for construction. Historic actuals are unchanged.">{preIfc}</span>
      )}</td>
      <td className="py-2 pr-3">{entry.installedQuantity}</td>
      <td className="py-2 pr-3">{entry.voidedAt ? "Voided" : `Version ${entry.version}`}</td>
      <td className="py-2">
        {mode === null && !entry.voidedAt && (
          <>
            <button type="button" onClick={() => { setMode("correct"); setError(""); }}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-700">Correct</button>
            <button type="button" onClick={() => { setMode("void"); setError(""); }}
              className="ml-2 rounded-lg border border-red-300 px-2.5 py-1 text-xs font-bold text-red-700">Void</button>
          </>
        )}
        {mode === "correct" && (
          <span className="flex flex-wrap items-center gap-2">
            <input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" step="any" min="0"
              className="w-20 rounded border border-slate-300 px-1.5 py-1 text-slate-950" />
            <input value={workDate} onChange={(e) => setWorkDate(e.target.value)} type="date"
              className="rounded border border-slate-300 px-1.5 py-1 text-slate-950" />
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)"
              className="rounded border border-slate-300 px-1.5 py-1 text-slate-950" />
            <button type="button" onClick={onSaveCorrect} disabled={busy}
              className="rounded-lg bg-slate-950 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
            <button type="button" onClick={() => setMode(null)} className="text-xs font-bold text-slate-600">Cancel</button>
          </span>
        )}
        {mode === "void" && (
          <span className="flex flex-wrap items-center gap-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)"
              className="rounded border border-slate-300 px-1.5 py-1 text-slate-950" />
            <button type="button" onClick={onConfirmVoid} disabled={busy}
              className="rounded-lg bg-red-700 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-50">{busy ? "Voiding…" : "Confirm void"}</button>
            <button type="button" onClick={() => setMode(null)} className="text-xs font-bold text-slate-600">Cancel</button>
          </span>
        )}
        <button type="button" onClick={() => setShowHistory((v) => !v)}
          className="ml-2 text-xs font-bold text-slate-600">{showHistory ? "Hide history" : "History"}</button>
        {error && <div role="alert" className="mt-1 text-xs font-bold text-red-700">{error}</div>}
        {showHistory && <EntryHistoryList packageId={packageId} entryId={entry.id} />}
      </td>
    </tr>
  );
}

function NewProgressForm({ packageId, lines, onCreated }) {
  const [lineId, setLineId] = useState(lines.length > 0 ? lines[0].lineId : "");
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setConfirmation("");
    try {
      const { entry } = await api(`/api/work-packages/${packageId}/progress`, {
        method: "POST",
        body: JSON.stringify({ lineId, workDate, installedQuantity: Number(quantity), note: note || undefined }),
      });
      const line = lines.find((l) => l.lineId === lineId);
      setQuantity("");
      setNote("");
      setConfirmation(`Saved — ${entry.installedQuantity} ${line ? line.baselineUnit : ""} installed on ${entry.workDate} for "${line ? line.description : lineId}".`);
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (lines.length === 0) {
    return <p className={`mt-3 ${forgeTheme.muted}`}>No takeoff lines yet — add lines above first.</p>;
  }

  return (
    <form onSubmit={onSubmit} className={forgeTheme.panelSoft}>
      <p className={forgeTheme.labelSmall}>Record daily progress</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="text-sm">
          <span className={forgeTheme.labelSmall}>Takeoff line</span>
          <select value={lineId} onChange={(e) => setLineId(e.target.value)} required
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm font-bold text-slate-950">
            {lines.map((line) => (
              <option key={line.lineId} value={line.lineId}>{line.description} ({line.baselineQuantity} {line.baselineUnit})</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className={forgeTheme.labelSmall}>Work date</span>
          <input value={workDate} onChange={(e) => setWorkDate(e.target.value)} type="date" required
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-950" />
        </label>
        <label className="text-sm">
          <span className={forgeTheme.labelSmall}>Installed quantity</span>
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} type="number" step="any" min="0" required
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-950" />
        </label>
        <label className="text-sm">
          <span className={forgeTheme.labelSmall}>Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-950" />
        </label>
      </div>
      <button type="submit" disabled={busy}
        className="mt-3 rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50">
        {busy ? "Saving…" : "Record progress"}
      </button>
      <Confirmation message={confirmation} />
      <ErrorNote message={error} />
    </form>
  );
}

function ProgressSectionBody({ packageId }) {
  const [confirmation, setConfirmation] = useState("");
  const { data: summary, error: summaryError, isLoading: summaryLoading, refresh: refreshSummary } = useStaleWhileRevalidate(
    `work-packages:${packageId}:progress-summary`,
    () => api(`/api/work-packages/${packageId}/progress/summary`).then((b) => b.summary),
    { ttlMs: 10_000 },
  );
  const { data: entries, error: entriesError, isLoading: entriesLoading, refresh: refreshEntries } = useStaleWhileRevalidate(
    `work-packages:${packageId}:progress-entries`,
    () => api(`/api/work-packages/${packageId}/progress`).then((b) => b.entries),
    { ttlMs: 10_000 },
  );
  // Slice 7: the same shared readiness snapshot the steps list and
  // the readiness panel read (same cache key, so one fetch serves
  // all three). The PRE-IFC flag is display only — a failed or
  // pre-migration readiness read simply shows no flag, and the
  // progress history keeps rendering.
  const { data: readinessData } = useStaleWhileRevalidate(
    `work-packages:${packageId}:drawing-readiness`,
    () => api(`/api/work-packages/${packageId}/drawings/readiness`),
    { ttlMs: 10_000 },
  );
  const readinessByDrawingId = new Map(
    (readinessData?.drawings || []).map((row) => [row.drawingId, row]),
  );

  function bump(message) {
    if (message) setConfirmation(message);
    refreshSummary();
    refreshEntries();
  }

  const linesById = new Map((summary?.lines || []).map((line) => [line.lineId, line]));

  return (
    <div className={forgeTheme.panel}>
      <p className={forgeTheme.labelSmall}>Daily progress — cumulative totals are computed from daily entries, never stored</p>
      {summaryLoading && <ForgeLoadingState label="Loading progress summary…" />}
      {summaryError && <ForgeErrorState title="Unable to load progress summary" detail={summaryError} onRetry={refreshSummary} />}
      {!summaryLoading && !summaryError && summary && (
        <>
          <div className="mt-3">
            <p className={forgeTheme.labelSmall}>Progress by takeoff line</p>
            {summary.lines.length === 0 ? (
              <p className={`mt-1 ${forgeTheme.muted}`}>No takeoff lines yet.</p>
            ) : (
              <table className="mt-2 w-full text-left text-sm">
                <thead>
                  <tr className={forgeTheme.labelSmall}>
                    <th className="pb-1 pr-3">Line</th>
                    <th className="pb-1 pr-3">Baseline</th>
                    <th className="pb-1 pr-3">Installed</th>
                    <th className="pb-1 pr-3">Remaining</th>
                    <th className="pb-1 pr-3">Complete</th>
                    <th className="pb-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.lines.map((line) => (
                    <tr key={line.lineId} className="border-b border-slate-200 dark:border-slate-800">
                      <td className="py-2 pr-3">{line.description}</td>
                      <td className="py-2 pr-3">{line.baselineQuantity} {line.baselineUnit}</td>
                      <td className="py-2 pr-3">{line.installed} {line.baselineUnit}</td>
                      <td className="py-2 pr-3">{line.remaining == null ? "—" : `${line.remaining} ${line.baselineUnit}`}</td>
                      <td className="py-2 pr-3">{line.percentComplete == null ? "N/A" : `${line.percentComplete}%`}</td>
                      <td className="py-2">{line.overrun ? <strong className="text-red-700">Overrun</strong> : line.percentComplete === 100 ? "Complete" : "In progress"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="mt-3 text-sm">
            <p>
              <span className={forgeTheme.labelSmall}>Package total:</span>{" "}
              {summary.package.aggregatePercent == null
                ? "N/A — mixed units or a zero baseline; see the per-unit breakdown below."
                : `${summary.package.aggregatePercent}% complete (capped: ${summary.package.cappedAggregateCompletion}%)`}
            </p>
            <ul className="mt-1 text-sm">
              {summary.package.unitGroups.map((group) => (
                <li key={group.unit}>{group.installed} of {group.baseline} {group.unit} across {group.lineCount} line{group.lineCount === 1 ? "" : "s"}</li>
              ))}
            </ul>
            {summary.package.overrunLineCount > 0 && (
              <p className="mt-1 font-bold text-red-700">{summary.package.overrunLineCount} line{summary.package.overrunLineCount === 1 ? "" : "s"} over baseline.</p>
            )}
          </div>
          <div className="mt-4">
            <NewProgressForm packageId={packageId} lines={summary.lines} onCreated={() => bump()} />
          </div>
        </>
      )}

      <div className="mt-4">
        <p className={forgeTheme.labelSmall}>Daily history (voided entries stay visible, but stop counting)</p>
        {entriesLoading && <ForgeLoadingState label="Loading daily history…" />}
        {entriesError && <ForgeErrorState title="Unable to load daily history" detail={entriesError} onRetry={refreshEntries} />}
        {!entriesLoading && !entriesError && entries && (
          entries.length === 0 ? (
            <p className={`mt-1 ${forgeTheme.muted}`}>No progress entries yet.</p>
          ) : (
            <table className="mt-2 w-full text-left">
              <thead>
                <tr className={forgeTheme.labelSmall}>
                  <th className="pb-1 pr-3">Work date</th>
                  <th className="pb-1 pr-3">Line</th>
                  <th className="pb-1 pr-3">Installed</th>
                  <th className="pb-1 pr-3">State</th>
                  <th className="pb-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const line = linesById.get(entry.takeoffLineId);
                  const readiness = line?.drawingId ? readinessByDrawingId.get(line.drawingId) : null;
                  return (
                    <ProgressEntryRow key={entry.id} packageId={packageId} entry={entry}
                      lineLabel={line ? line.description : entry.takeoffLineId}
                      preIfc={preIfcTag(readiness)}
                      onChanged={(message) => bump(message)} />
                  );
                })}
              </tbody>
            </table>
          )
        )}
        <Confirmation message={confirmation} />
      </div>
      <p className="mt-3 text-xs text-slate-500">Progress entries are never hard-deleted: a wrong entry is corrected or voided, and every change stays in its history.</p>
    </div>
  );
}

function ProgressSection({ packageId }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-5">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-800">
        {open ? "Hide daily progress" : "Daily progress"}
      </button>
      {open && (
        <div className="mt-3">
          <ProgressSectionBody packageId={packageId} />
        </div>
      )}
    </div>
  );
}

export default function WorkPackageTakeoffScreen({ packageId }) {
  const [activeDrawingId, setActiveDrawingId] = useState(null);
  const [drawingConfirmation, setDrawingConfirmation] = useState("");
  // Stable key, never rotated: a mutation calls refresh() (stale-while-
  // revalidate, old data stays on screen) rather than changing the key,
  // which would otherwise cold-start this fetch and show the full-page
  // loading state — wiping out sibling state like NewDrawingForm's own
  // just-set success confirmation.
  const { data: drawings, error, isLoading, refresh } = useStaleWhileRevalidate(
    `work-packages:${packageId}:drawings`,
    () => api(`/api/work-packages/${packageId}/drawings`).then((b) => b.drawings),
    { ttlMs: 10_000 },
  );
  // Per-drawing permit-link counts for the drawing list. One fetch for
  // the whole package; each drawing panel keeps its own list fresh and
  // reports changes back here so the counts follow.
  const { data: drawingAnnotations, refresh: refreshDrawingAnnotations } = useStaleWhileRevalidate(
    `work-packages:${packageId}:permit-annotations:drawing`,
    () => api(`/api/work-packages/${packageId}/permit-annotations?targetKind=drawing`).then((b) => b.annotations),
    { ttlMs: 10_000 },
  );
  const annotationCounts = new Map();
  for (const annotation of drawingAnnotations || []) {
    annotationCounts.set(annotation.drawingId, (annotationCounts.get(annotation.drawingId) || 0) + 1);
  }

  if (isLoading) return <ForgeLoadingState label="Loading drawings…" />;
  if (error) return <ForgeErrorState title="Unable to load drawings" detail={error} onRetry={refresh} />;

  const pIdDrawings = (drawings || []).filter((d) => d.drawingType === "p_id");
  const activeDrawing = (drawings || []).find((d) => d.id === activeDrawingId)
    || (drawings && drawings.length > 0 ? drawings[0] : null);

  function onDrawingDeleted(drawing) {
    setDrawingConfirmation(`Deleted — ${DRAWING_TYPE_LABELS[drawing.drawingType]} "${drawing.drawingNumber}" was removed.`);
    setActiveDrawingId(null);
    refresh();
    refreshDrawingAnnotations();
  }

  return (
    <section className={forgeTheme.card}>
      <p className={forgeTheme.labelSmall}>Work Package Planner</p>
      <h1 className={`mt-2 ${forgeTheme.title}`}>Takeoff — package {packageId}</h1>
      <p className={`mt-2 ${forgeTheme.textSmall}`}>
        Bring in P&amp;IDs, cut sheets, and isometrics; enter their takeoff lines; get one
        quantity summary per P&amp;ID with a shop/field estimate split and suggested
        FW/FFW counts. Record daily installed quantities per line to track cumulative
        progress.
      </p>

      <div className="mt-5">
        <NewDrawingForm packageId={packageId} pIdDrawings={pIdDrawings} onCreated={() => refresh()} />
      </div>
      <Confirmation message={drawingConfirmation} />

      {(drawings || []).length === 0 ? (
        <div className="mt-5">
          <ForgeEmptyState headline="No drawings yet" guidance="Add a P&ID above to start a takeoff." />
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
          <nav className="space-y-1">
            {drawings.map((d) => {
              const linkCount = annotationCounts.get(d.id) || 0;
              return (
                <button key={d.id} type="button" onClick={() => setActiveDrawingId(d.id)}
                  className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-bold ${d.id === activeDrawingId ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"}`}>
                  {DRAWING_TYPE_LABELS[d.drawingType]} — {d.drawingNumber}
                  {linkCount > 0 ? ` · ${linkCount} permit link${linkCount === 1 ? "" : "s"}` : ""}
                </button>
              );
            })}
          </nav>
          <div>
            {activeDrawing && (
              <DrawingPanel key={activeDrawing.id} packageId={packageId} drawing={activeDrawing}
                onDrawingDeleted={onDrawingDeleted} onAnnotationsChanged={refreshDrawingAnnotations} />
            )}
          </div>
        </div>
      )}
      <ProgressSection packageId={packageId} />
    </section>
  );
}
