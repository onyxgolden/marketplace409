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

function DrawingPanel({ packageId, drawing, onDrawingDeleted }) {
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

      {drawing.drawingType === "p_id" && (
        <div className="mt-4">
          <PidSummaryPanel packageId={packageId} pIdDrawing={drawing} refreshToken={summaryRefreshToken} />
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

  if (isLoading) return <ForgeLoadingState label="Loading drawings…" />;
  if (error) return <ForgeErrorState title="Unable to load drawings" detail={error} onRetry={refresh} />;

  const pIdDrawings = (drawings || []).filter((d) => d.drawingType === "p_id");
  const activeDrawing = (drawings || []).find((d) => d.id === activeDrawingId)
    || (drawings && drawings.length > 0 ? drawings[0] : null);

  function onDrawingDeleted(drawing) {
    setDrawingConfirmation(`Deleted — ${DRAWING_TYPE_LABELS[drawing.drawingType]} "${drawing.drawingNumber}" was removed.`);
    setActiveDrawingId(null);
    refresh();
  }

  return (
    <section className={forgeTheme.card}>
      <p className={forgeTheme.labelSmall}>Work Package Planner</p>
      <h1 className={`mt-2 ${forgeTheme.title}`}>Takeoff — package {packageId}</h1>
      <p className={`mt-2 ${forgeTheme.textSmall}`}>
        Bring in P&amp;IDs, cut sheets, and isometrics; enter their takeoff lines; get one
        quantity summary per P&amp;ID with a shop/field estimate split and suggested
        FW/FFW counts.
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
            {drawings.map((d) => (
              <button key={d.id} type="button" onClick={() => setActiveDrawingId(d.id)}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-bold ${d.id === activeDrawingId ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"}`}>
                {DRAWING_TYPE_LABELS[d.drawingType]} — {d.drawingNumber}
              </button>
            ))}
          </nav>
          <div>
            {activeDrawing && (
              <DrawingPanel key={activeDrawing.id} packageId={packageId} drawing={activeDrawing}
                onDrawingDeleted={onDrawingDeleted} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
