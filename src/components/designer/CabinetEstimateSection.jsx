"use client";

import { useState } from "react";
import { Download, Pencil } from "lucide-react";
import {
  bookLabel,
  cabinetEstimate,
  cabinetEstimateCsv,
  createBook,
  snapshotEstimate,
} from "@/domains/roomDesigner/cabinetPriceBooks";
import { formatUSD } from "@/domains/roomDesigner/homeEstimate";
import PriceBookEditor from "./PriceBookEditor";

const STATUS_TEXT = {
  "not-in-list": "not on this supplier's list",
  discontinued: "discontinued",
  "no-price": "no price entered",
};

/**
 * Kitchen cabinet estimate: pick a supplier price list, and every cabinet in
 * the plan is priced by its code (B24, W2430, SB36, ...). Cabinets the list
 * can't price are called out, never counted as $0. Accessories are priced
 * from the quantities entered here. The supplier choice and accessory
 * quantities are saved with the design; prices live in the user's private
 * price lists (saved to their account, editable via "Edit prices").
 * "Save estimate" freezes the current numbers onto the design, so later
 * price changes never alter an estimate already given out.
 */
const SYNC_TEXT = {
  loading: "Loading your price lists…",
  saving: "Saving…",
  synced: "Saved to your account",
  local: "Saved on this device only — couldn't reach your account; will retry",
};

function downloadText(text, filename) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CabinetEstimateSection({ design, dispatch, books, status = "synced", onSaveBook, onDeleteBook }) {
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(null); // { supplier, line, asOf, error }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const hasCabinets = (design.furniture || []).some((f) => f.catalogId?.startsWith("cabinet-"));
  const bookId = design.settings?.cabinetPriceBookId || "";
  const book = books.find((b) => b.id === bookId) || null;
  const qty = design.settings?.cabinetAccessoryQty || {};
  if (!hasCabinets && !book && !(design.cabinetEstimates || []).length) return null;

  const estimate = book ? cabinetEstimate(design, book, qty) : null;
  const saved = design.cabinetEstimates || [];
  const setSettings = (settings) => dispatch({ type: "UPDATE_SETTINGS", settings });
  const fileBase = (design.name || "design").replace(/[^\w.-]+/g, "_");
  const downloadCsv = () => downloadText(cabinetEstimateCsv(estimate, book), `${fileBase}-cabinet-estimate.csv`);
  const pickSupplier = (value) => {
    if (value === "__new__") {
      setCreating({ supplier: "", line: "", asOf: "", error: null });
      return;
    }
    setSettings({ cabinetPriceBookId: value || null });
  };
  const createList = (e) => {
    e.preventDefault();
    try {
      const next = createBook(creating);
      onSaveBook(next);
      setSettings({ cabinetPriceBookId: next.id });
      setCreating(null);
      setEditing(true);
    } catch (err) {
      setCreating({ ...creating, error: err.message });
    }
  };

  return (
    <section className="mt-4" aria-label="Cabinet estimate">
      <h3 className="mb-1 text-sm font-semibold text-white">Cabinet estimate</h3>
      <label className="mb-2 block text-xs text-gray-400">
        Supplier
        <select
          aria-label="Cabinet supplier"
          value={bookId}
          onChange={(e) => pickSupplier(e.target.value)}
          className="mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white"
        >
          <option value="">— Choose a supplier —</option>
          {books.map((b) => (
            <option key={b.id} value={b.id}>{bookLabel(b)}</option>
          ))}
          <option value="__new__">+ New supplier price list…</option>
        </select>
      </label>
      <p className={`mb-2 text-[10px] ${status === "local" ? "text-amber-300" : "text-gray-500"}`} role="status">
        {SYNC_TEXT[status] || ""}
      </p>

      {creating && (
        <form onSubmit={createList} className="mb-2 space-y-1 rounded border border-gray-700 p-2" aria-label="New supplier price list">
          <input aria-label="Supplier name" placeholder="Supplier (e.g. your cabinet store)" value={creating.supplier} onChange={(e) => setCreating({ ...creating, supplier: e.target.value })} className="block w-full rounded bg-gray-800 px-2 py-1 text-xs text-white" />
          <input aria-label="Product line" placeholder="Line (e.g. Unfinished Oak Cabinets)" value={creating.line} onChange={(e) => setCreating({ ...creating, line: e.target.value })} className="block w-full rounded bg-gray-800 px-2 py-1 text-xs text-white" />
          <label className="block text-[11px] text-gray-400">
            Prices as of <input type="date" aria-label="New list prices as of" value={creating.asOf} onChange={(e) => setCreating({ ...creating, asOf: e.target.value })} className="rounded bg-gray-800 px-1 py-0.5 text-xs text-white" />
          </label>
          {creating.error && <p role="alert" className="text-[11px] text-red-300">{creating.error}</p>}
          <div className="flex gap-1">
            <button type="submit" className="rounded bg-emerald-700 px-2 py-0.5 text-xs text-white hover:bg-emerald-600">Create, then paste prices</button>
            <button type="button" onClick={() => setCreating(null)} className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-300">Cancel</button>
          </div>
        </form>
      )}

      {book && (
        <>
          <div className="mb-1 flex items-center justify-between text-[11px] text-gray-500">
            <span>Prices as of {book.asOf || "—"}</span>
            <span className="flex gap-1">
              <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1 rounded bg-gray-800 px-2 py-0.5 text-gray-300 hover:bg-gray-700">
                <Pencil size={11} aria-hidden="true" /> Edit prices
              </button>
              <button type="button" onClick={downloadCsv} className="flex items-center gap-1 rounded bg-gray-800 px-2 py-0.5 text-gray-300 hover:bg-gray-700">
                <Download size={11} aria-hidden="true" /> CSV
              </button>
            </span>
          </div>

          {estimate.lines.length > 0 && (
            <table className="w-full text-xs" aria-label="Priced cabinets">
              <tbody>
                {estimate.lines.map((l) => (
                  <tr key={l.code} className="text-gray-300" title={`${l.name} · item #${l.sku || "—"}`}>
                    <td className="py-0.5 pr-1 font-mono font-semibold text-amber-200">{l.code}</td>
                    <td className="py-0.5 pr-1 text-right">{l.qty} × {formatUSD(l.unitCents)}</td>
                    <td className="py-0.5 text-right text-white">{formatUSD(l.extCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {estimate.issues.length > 0 && (
            <ul className="mt-1 space-y-0.5 rounded bg-amber-900/30 px-2 py-1 text-[11px] text-amber-200" aria-label="Cabinets not priced">
              {estimate.issues.map((i) => (
                <li key={`${i.code}|${i.status}`}>
                  <span className="font-mono font-semibold">{i.code}</span> ×{i.qty} — {STATUS_TEXT[i.status] || i.status}
                </li>
              ))}
            </ul>
          )}

          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-gray-400">Accessories ({estimate.accessories.filter((a) => a.qty > 0).length})</summary>
            <div className="mt-1 space-y-1">
              {estimate.accessories.map((a) => (
                <label key={a.code} className="flex items-center justify-between gap-2 text-[11px] text-gray-300">
                  <span className="truncate" title={`item #${a.sku || "—"}`}>
                    {a.name}{a.discontinued ? " (discontinued)" : ""} · {a.unitCents == null ? "—" : formatUSD(a.unitCents)}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    aria-label={`Quantity of ${a.name}`}
                    value={qty[a.code] ?? 0}
                    disabled={a.discontinued}
                    onChange={(e) => setSettings({ cabinetAccessoryQty: { ...qty, [a.code]: Math.max(0, Math.floor(Number(e.target.value) || 0)) } })}
                    className="w-14 rounded bg-gray-800 px-1 py-0.5 text-right text-white"
                  />
                </label>
              ))}
            </div>
          </details>

          <dl className="mt-2 space-y-0.5 border-t border-gray-800 pt-1 text-xs">
            <div className="flex justify-between text-gray-400"><dt>Cabinets</dt><dd>{formatUSD(estimate.cabinetsCents)}</dd></div>
            <div className="flex justify-between text-gray-400"><dt>Accessories</dt><dd>{formatUSD(estimate.accessoriesCents)}</dd></div>
            <div className="flex justify-between font-semibold text-white"><dt>Total (before tax)</dt><dd>{formatUSD(estimate.totalCents)}</dd></div>
          </dl>
          {estimate.issues.length > 0 && (
            <p className="mt-1 text-[11px] text-amber-300">Total leaves out the cabinets listed above.</p>
          )}
          <button
            type="button"
            onClick={() => dispatch({ type: "SAVE_CABINET_ESTIMATE", snapshot: snapshotEstimate(estimate, book) })}
            className="mt-2 w-full rounded bg-blue-700 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-600"
            title="Freeze these prices and totals on the design; later price changes won't alter it"
          >
            Save estimate (locks these prices)
          </button>
        </>
      )}

      {saved.length > 0 && (
        <div className="mt-3" aria-label="Saved estimates">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Saved estimates</p>
          <ul className="space-y-1">
            {[...saved].reverse().map((snap) => (
              <li key={snap.id} className="flex items-center justify-between gap-1 text-[11px] text-gray-300">
                <span className="truncate" title={`${snap.supplier}${snap.line ? ` — ${snap.line}` : ""} · prices as of ${snap.asOf || "—"}`}>
                  {new Date(snap.savedAt).toLocaleDateString()} · {snap.supplier} · <strong className="text-white">{formatUSD(snap.totalCents)}</strong>
                </span>
                <span className="flex shrink-0 gap-1">
                  <button type="button" aria-label="Download saved estimate" onClick={() => downloadText(cabinetEstimateCsv(snap, snap), `${fileBase}-estimate-${snap.savedAt.slice(0, 10)}.csv`)} className="rounded bg-gray-800 px-1.5 py-0.5 hover:bg-gray-700">
                    <Download size={11} aria-hidden="true" />
                  </button>
                  {confirmDelete === snap.id ? (
                    <button type="button" onClick={() => { dispatch({ type: "DELETE_CABINET_ESTIMATE", snapshotId: snap.id }); setConfirmDelete(null); }} className="rounded bg-red-700 px-1.5 py-0.5 text-white">Delete?</button>
                  ) : (
                    <button type="button" aria-label="Delete saved estimate" onClick={() => setConfirmDelete(snap.id)} className="rounded bg-gray-800 px-1.5 py-0.5 hover:bg-gray-700">✕</button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && book && (
        <PriceBookEditor
          book={book}
          onChange={onSaveBook}
          onDelete={() => {
            onDeleteBook(book.id);
            setSettings({ cabinetPriceBookId: null });
            setEditing(false);
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  );
}
