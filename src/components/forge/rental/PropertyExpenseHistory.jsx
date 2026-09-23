"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import ManualFinancialEventForm from "./ManualFinancialEventForm";
import { useCardContextMenu, CardContextMenu } from "./CardContextMenu";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const label = (value) => String(value ?? "—").replaceAll("_", " ");
const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
};

export const PROPERTY_EXPENSES_OPEN_EVENT = "forge:open-property-expenses";

async function fetchPropertyExpenses(propertyId) {
  const response = await fetch(`/api/rental/property-expenses?propertyId=${encodeURIComponent(propertyId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load expense history.");
  return body;
}

// Shared expense entries table — the inline card and the expanded dialog render the
// same markup so columns never drift apart. `roomy` relaxes the column constraints
// for the wide overlay so every column is readable without horizontal scrolling.
export function ExpenseEntriesTable({ entries, roomy = false }) {
  return (
    <table className={roomy ? "w-full text-left text-sm" : "w-full min-w-[680px] text-left text-sm"}>
      <thead>
        <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <th className="py-2 pr-3 font-black">Date</th>
          <th className="py-2 pr-3 font-black">Vendor / description</th>
          <th className="py-2 pr-3 font-black">Category</th>
          <th className="py-2 pr-3 font-black">Source</th>
          <th className="py-2 pr-3 font-black">Method</th>
          <th className="py-2 pr-3 font-black">Reference</th>
          <th className="py-2 text-right font-black">Amount</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id} data-expense-entry={entry.source} className="border-b border-slate-100 dark:border-slate-800">
            <td className={`py-2 pr-3 font-bold text-slate-700 dark:text-slate-300${roomy ? " whitespace-nowrap" : ""}`}>{formatDate(entry.date)}</td>
            <td className="py-2 pr-3">
              <span className="font-bold text-slate-950 dark:text-white">{entry.vendor}</span>
              {entry.alsoRecordedAs?.length > 0 && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black uppercase text-slate-700 dark:bg-slate-700 dark:text-slate-200">Also recorded as {entry.alsoRecordedAs.join(", ")}</span>}
              {entry.possibleDuplicate && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Possible duplicate — review</span>}
            </td>
            <td className="py-2 pr-3 capitalize text-slate-600 dark:text-slate-400">{label(entry.category)}</td>
            <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">{entry.sourceLabel}</td>
            <td className={`py-2 pr-3 text-slate-600 dark:text-slate-400${roomy ? " whitespace-nowrap" : ""}`}>{label(entry.method)}</td>
            <td className="py-2 pr-3 text-xs text-slate-500 dark:text-slate-400">{entry.reference || "—"}</td>
            <td className={`py-2 text-right font-black text-slate-950 dark:text-white${roomy ? " whitespace-nowrap" : ""}`}>{money.format(entry.amountCents / 100)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Expanded expense history dialog: near-full-viewport width so every column is
// readable. Read-focused — the Add Expense form stays on the inline card.
export function ExpenseHistoryExpanded({ ledger, propertyLabel, onClose }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div data-expense-history-expanded className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-label={`Expanded expense history for ${propertyLabel || "property"}`}>
      <button type="button" aria-label="Close expanded expense history" tabIndex={-1}
        onClick={onClose} className="absolute inset-0 cursor-default bg-slate-950/60" />
      <div className="relative flex max-h-[90vh] w-[96vw] max-w-[1200px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-700">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Expenses history · expanded</p>
            <h3 className="mt-1 text-xl font-black text-slate-950 dark:text-white">
              {ledger ? <>{money.format(ledger.totalCents / 100)} <span className="text-sm font-bold text-slate-500 dark:text-slate-400">total · {ledger.entries.length} {ledger.entries.length === 1 ? "expense" : "expenses"}</span></> : "Property expenses"}
            </h3>
          </div>
          <button ref={closeRef} type="button" onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            Close
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-4">
          {!ledger && <p className="text-sm font-bold text-slate-500 dark:text-slate-400">Loading expense history…</p>}
          {ledger && ledger.entries.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No expenses recorded for this property yet.</p>}
          {ledger && ledger.entries.length > 0 && <ExpenseEntriesTable entries={ledger.entries} roomy />}
          {ledger?.suppressedDuplicateCount > 0 && (
            <p className="mt-3 text-xs font-bold text-slate-500 dark:text-slate-400">
              {ledger.suppressedDuplicateCount} manual {ledger.suppressedDuplicateCount === 1 ? "entry" : "entries"} explicitly linked to a contractor payment {ledger.suppressedDuplicateCount === 1 ? "was" : "were"} folded into that payment — no double count.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Property card expenses history: every expense for the selected property/unit — manual
// entries, contractor payments, and Rentec imports — with a running total. The Add Expense
// affordance reuses ManualFinancialEventForm pre-scoped to this property; the API it posts
// to is co-owner-safe (canonical owner resolution), so co-owners get the same visible,
// functional control. Right-clicking the card opens the expanded wide view so all columns
// are readable (Brandy's power-user shortcut pattern).
export default function PropertyExpenseHistory({ propertyId, propertyLabel }) {
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(propertyId));
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const { menu: contextMenu, onContextMenu, close: closeContextMenu } = useCardContextMenu();

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    setError("");
    try {
      const body = await fetchPropertyExpenses(propertyId);
      setLedger(body.ledger);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  // Mount fetch: promise-chain style (no synchronous setState in the effect body),
  // matching the panel components' established pattern.
  useEffect(() => {
    if (!propertyId) return undefined;
    let cancelled = false;
    fetchPropertyExpenses(propertyId)
      .then((body) => { if (!cancelled) { setLedger(body.ledger); setError(""); } })
      .catch((caught) => { if (!cancelled) setError(caught.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [propertyId]);

  // Right-click shortcut: a property card context menu dispatches this to open the full
  // expenses ledger for exactly this property without any re-selection step.
  useEffect(() => {
    const open = (event) => {
      if (event.detail?.propertyId === propertyId) {
        if (!ledger && !loading && !error) load();
        requestAnimationFrame(() => {
          document.getElementById(`property-expenses-${propertyId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    };
    window.addEventListener(PROPERTY_EXPENSES_OPEN_EVENT, open);
    return () => window.removeEventListener(PROPERTY_EXPENSES_OPEN_EVENT, open);
  }, [propertyId, ledger, loading, error, load]);

  return (
    <section id={`property-expenses-${propertyId}`} data-property-expense-history aria-label={`Expense history for ${propertyLabel || "property"}`}
      title="Right-click to expand the expense history"
      onContextMenu={(event) => onContextMenu(event, [{ label: "Expand expense history", onSelect: () => setExpanded(true) }])}
      className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <CardContextMenu menu={contextMenu} onClose={closeContextMenu} />
      {expanded && (
        <ExpenseHistoryExpanded ledger={ledger} propertyLabel={propertyLabel} onClose={() => setExpanded(false)} />
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Expenses history</p>
          <h3 className="mt-1 text-xl font-black text-slate-950 dark:text-white">
            {ledger ? <>{money.format(ledger.totalCents / 100)} <span className="text-sm font-bold text-slate-500 dark:text-slate-400">total · {ledger.entries.length} {ledger.entries.length === 1 ? "expense" : "expenses"}</span></> : "Property expenses"}
          </h3>
        </div>
        <button type="button" onClick={load} disabled={loading}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {loading && !ledger && <p className="mt-4 text-sm font-bold text-slate-500 dark:text-slate-400">Loading expense history…</p>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      {ledger && (
        <>
          {ledger.entries.length === 0
            ? <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No expenses recorded for this property yet.</p>
            : <div className="mt-4 overflow-x-auto">
              <ExpenseEntriesTable entries={ledger.entries} />
            </div>}
          {ledger.suppressedDuplicateCount > 0 && (
            <p className="mt-3 text-xs font-bold text-slate-500 dark:text-slate-400">
              {ledger.suppressedDuplicateCount} manual {ledger.suppressedDuplicateCount === 1 ? "entry" : "entries"} explicitly linked to a contractor payment {ledger.suppressedDuplicateCount === 1 ? "was" : "were"} folded into that payment — no double count.
            </p>
          )}
        </>
      )}

      <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-700" data-property-add-expense>
        <h4 className="text-sm font-black uppercase tracking-wide text-slate-700 dark:text-slate-300">Add expense</h4>
        <ManualFinancialEventForm
          availableProperties={propertyId ? [propertyId] : []}
          initialPropertyId={propertyId}
          onSaved={load}
        />
      </div>
    </section>
  );
}
