"use client";

import { useState } from "react";
import { X } from "lucide-react";
import {
  addItem,
  bookLabel,
  inferItemKind,
  exportPriceCsv,
  importPriceCsv,
  parsePriceToCents,
  removeItem,
  setAsOf,
  updateItem,
} from "@/domains/roomDesigner/cabinetPriceBooks";
import { resetBookToSeed } from "@/domains/roomDesigner/priceBookStorage";

const input = "rounded bg-gray-800 px-1.5 py-0.5 text-xs text-white";
const dollars = (cents) => (cents == null ? "" : (cents / 100).toFixed(2));

/**
 * Edit a supplier price list when prices change: prices, item numbers,
 * discontinued items, new items, the "prices as of" date, a whole new sheet
 * pasted as CSV, export, and reset to the printed list. Every change goes
 * straight out through onChange (the screen persists it per user).
 */
export default function PriceBookEditor({ book, onChange, onClose, onDelete }) {
  const [filter, setFilter] = useState("");
  const [message, setMessage] = useState(null);
  const [csv, setCsv] = useState("");
  const [draft, setDraft] = useState({ code: "", name: "", sku: "", price: "" });
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const apply = (fn, ok) => {
    try {
      onChange(fn(book));
      setMessage(ok ? { kind: "ok", text: ok } : null);
      return true;
    } catch (e) {
      setMessage({ kind: "error", text: e.message });
      return false;
    }
  };
  const setPrice = (code, text) => {
    const cents = text.trim() === "" ? null : parsePriceToCents(text);
    if (text.trim() !== "" && cents === null) {
      setMessage({ kind: "error", text: `Can't read "${text}" as a price for ${code}.` });
      return;
    }
    apply((b) => updateItem(b, code, { priceCents: cents }));
  };
  const f = filter.trim().toLowerCase();
  const items = book.items.filter((i) => !f || `${i.code} ${i.name} ${i.sku}`.toLowerCase().includes(f));

  const download = () => {
    const blob = new Blob([exportPriceCsv(book)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${book.id}-price-list.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Edit price list" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-gray-700 bg-gray-900 text-gray-200 shadow-xl">
        <header className="flex items-center justify-between border-b border-gray-800 px-4 py-2">
          <div>
            <h2 className="text-sm font-semibold text-white">{bookLabel(book)}</h2>
            <label className="text-[11px] text-gray-400">
              Prices as of{" "}
              <input type="date" aria-label="Prices as of" value={book.asOf} onChange={(e) => apply((b) => setAsOf(b, e.target.value))} className={input} />
            </label>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 hover:bg-gray-800"><X size={16} /></button>
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b border-gray-800 px-4 py-2">
          <input type="search" placeholder="Find code, name, or item #" aria-label="Filter price list" value={filter} onChange={(e) => setFilter(e.target.value)} className={`${input} w-56`} />
          <button type="button" onClick={download} className="rounded bg-gray-800 px-2 py-1 text-xs hover:bg-gray-700">Export CSV</button>
          {confirmReset ? (
            <span className="text-xs">
              Discard all edits?{" "}
              <button type="button" className="rounded bg-red-700 px-2 py-0.5 text-white" onClick={() => { apply(() => resetBookToSeed(book.id), "Reset to the sample list."); setConfirmReset(false); }}>Reset</button>{" "}
              <button type="button" className="rounded bg-gray-800 px-2 py-0.5" onClick={() => setConfirmReset(false)}>Cancel</button>
            </span>
          ) : (
            resetBookToSeed(book.id) && <button type="button" onClick={() => setConfirmReset(true)} className="rounded bg-gray-800 px-2 py-1 text-xs hover:bg-gray-700">Reset to sample list</button>
          )}
          {onDelete && !resetBookToSeed(book.id) && (
            confirmDelete ? (
              <span className="text-xs">
                Delete this whole price list?{" "}
                <button type="button" className="rounded bg-red-700 px-2 py-0.5 text-white" onClick={onDelete}>Delete</button>{" "}
                <button type="button" className="rounded bg-gray-800 px-2 py-0.5" onClick={() => setConfirmDelete(false)}>Cancel</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="rounded bg-gray-800 px-2 py-1 text-xs text-red-300 hover:bg-gray-700">Delete price list</button>
            )
          )}
        </div>

        {message && (
          <p role={message.kind === "error" ? "alert" : "status"} className={`px-4 py-1 text-xs ${message.kind === "error" ? "text-red-300" : "text-emerald-300"}`}>{message.text}</p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-900 text-left text-[10px] uppercase tracking-wide text-gray-500">
              <tr><th className="py-1">Code</th><th>Description</th><th>Item #</th><th>Price ($)</th><th>Disc.</th><th /></tr>
            </thead>
            <tbody>
              {items.map((i) => (
                // Keyed on the stored values so an edit elsewhere (CSV, reset) refreshes the inputs.
                <tr key={`${i.code}|${i.sku}|${i.priceCents}`} className={i.discontinued ? "text-gray-500 line-through decoration-gray-600" : ""}>
                  <td className="py-0.5 pr-2 font-mono font-semibold text-amber-200 no-underline">{i.code}</td>
                  <td className="pr-2">{i.name}</td>
                  <td className="pr-2">
                    <input aria-label={`Item number for ${i.code}`} defaultValue={i.sku} onBlur={(e) => e.target.value !== i.sku && apply((b) => updateItem(b, i.code, { sku: e.target.value }))} className={`${input} w-24`} />
                  </td>
                  <td className="pr-2">
                    <input aria-label={`Price for ${i.code}`} inputMode="decimal" defaultValue={dollars(i.priceCents)} onBlur={(e) => e.target.value !== dollars(i.priceCents) && setPrice(i.code, e.target.value)} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className={`${input} w-20 text-right`} />
                  </td>
                  <td className="text-center">
                    <input type="checkbox" aria-label={`${i.code} discontinued`} checked={!!i.discontinued} onChange={(e) => apply((b) => updateItem(b, i.code, { discontinued: e.target.checked }))} />
                  </td>
                  <td>
                    <button type="button" aria-label={`Remove ${i.code}`} onClick={() => apply((b) => removeItem(b, i.code))} className="rounded px-1 text-gray-500 hover:bg-gray-800 hover:text-red-300">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 border-t border-gray-800 px-4 py-2 md:grid-cols-2">
          <form
            className="space-y-1"
            onSubmit={(e) => {
              e.preventDefault();
              const cents = draft.price.trim() ? parsePriceToCents(draft.price) : null;
              if (draft.price.trim() && cents === null) { setMessage({ kind: "error", text: `Can't read "${draft.price}" as a price.` }); return; }
              const added = apply(
                (b) => addItem(b, { code: draft.code, name: draft.name, sku: draft.sku, priceCents: cents, kind: inferItemKind(draft.code) }),
                `Added ${draft.code.trim().toUpperCase()}.`,
              );
              if (added) setDraft({ code: "", name: "", sku: "", price: "" });
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Add item</p>
            <div className="flex flex-wrap gap-1">
              <input aria-label="New item code" placeholder="Code (W3930)" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} className={`${input} w-24`} />
              <input aria-label="New item description" placeholder="Description" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={`${input} flex-1`} />
              <input aria-label="New item number" placeholder="Item #" value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} className={`${input} w-20`} />
              <input aria-label="New item price" placeholder="Price" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} className={`${input} w-16`} />
              <button type="submit" className="rounded bg-emerald-700 px-2 py-0.5 text-xs text-white hover:bg-emerald-600">Add</button>
            </div>
          </form>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Paste a new price sheet (CSV)</p>
            <textarea
              aria-label="Price sheet CSV"
              rows={3}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder={"code,name,item number,price,discontinued\nB24,B24 Base Cabinet,100123,199.00,\nW930,,,,yes"}
              className={`${input} w-full font-mono`}
            />
            <button
              type="button"
              onClick={() => {
                const r = importPriceCsv(book, csv);
                onChange(r.book);
                setMessage({ kind: r.errors.length ? "error" : "ok", text: `Updated ${r.updated}, added ${r.added}.${r.errors.length ? ` Skipped: ${r.errors.join(" ")}` : ""}` });
                if (!r.errors.length) setCsv("");
              }}
              className="rounded bg-blue-700 px-2 py-0.5 text-xs text-white hover:bg-blue-600"
            >
              Apply sheet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
