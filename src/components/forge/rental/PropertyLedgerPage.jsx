"use client";
import { useEffect, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeLoadingState } from "@/components/forge/ForgeStates";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const label = (value) => String(value ?? "—").replaceAll("_", " ");
const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
};
// Rentec convention: positive balance = net income for the property (green);
// negative = net loss (red).
const balanceClass = (cents) => cents < 0
  ? "text-red-700 dark:text-red-400"
  : "text-emerald-700 dark:text-emerald-400";

async function fetchPropertyLedger(propertyId) {
  const response = await fetch(`/api/rental/property-ledger?propertyId=${encodeURIComponent(propertyId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load the property ledger.");
  return body;
}

// Full-page property ledger — the Rentec-style running transaction table:
// Date | Description | Debit | Credit | Balance, with a rolling balance after every row.
// Income posts to Credit, expenses to Debit. Succeeded rent payments on the property's
// leases appear as rental income; contractor payouts and manual/imported expense events
// appear as debits.
//
// Data layer: stale-while-revalidate, same as the tenant ledger — reopening a recently
// viewed property serves the cached payload instantly and refreshes in the background.
export default function PropertyLedgerPage({ propertyId, propertyLabel, onClose, onPostIncome, onPostExpense }) {
  const { data, error, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    propertyId ? `property-ledger:${propertyId}` : null,
    () => fetchPropertyLedger(propertyId),
    { ttlMs: 60_000 },
  );
  const ledger = data?.ledger || null;
  const [detailEntry, setDetailEntry] = useState(null);

  useEffect(() => {
    if (!detailEntry) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setDetailEntry(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailEntry]);

  const title = ledger?.propertyLabel || propertyLabel || "Property";

  return (
    <section data-property-ledger-page aria-label={`Property ledger for ${title}`}
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          {onClose && (
            <button type="button" onClick={onClose}
              className="text-sm font-black text-sky-700 underline hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300">
              ← Back to properties
            </button>
          )}
          <p className="mt-2 text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Property ledger</p>
          <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">{title}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onPostIncome}
            className={`rounded-xl px-4 py-2.5 text-sm font-black transition ${goldControlClassName}`}>
            Post Income
          </button>
          <button type="button" onClick={onPostExpense}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            Post Expense
          </button>
          <button type="button" onClick={() => { if (typeof window.print === "function") window.print(); }}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            Print
          </button>
        </div>
      </div>

      {isLoading && <ForgeLoadingState label="Loading ledger…" />}
      {isRefreshing && ledger && (
        <p className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p>
      )}
      {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      {!isLoading && ledger && (
        <>
          <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xl font-black text-slate-950 dark:text-white">Transactions</h3>
            <p className="text-sm font-bold text-slate-600 dark:text-slate-400">
              Balance: <strong className={`text-lg font-black ${balanceClass(ledger.balanceCents)}`}>{money.format(ledger.balanceCents / 100)}</strong>
              <span className="ml-2 font-normal">
                {ledger.balanceCents > 0 ? "net income" : ledger.balanceCents < 0 ? "net loss" : "break-even"}
              </span>
              <span className="ml-3 font-normal">
                In: <strong className="text-emerald-700 dark:text-emerald-400">{money.format(ledger.totalCreditCents / 100)}</strong>
                {" · "}Out: <strong className="text-slate-700 dark:text-slate-300">{money.format(ledger.totalDebitCents / 100)}</strong>
              </span>
            </p>
          </div>

          {ledger.entries.length === 0
            ? <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No income or expenses on record for this property yet.</p>
            : <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm" data-ledger-table>
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    <th className="py-2 pr-3 font-black">Date</th>
                    <th className="py-2 pr-3 font-black">Description</th>
                    <th className="py-2 pr-3 text-right font-black">Debit</th>
                    <th className="py-2 pr-3 text-right font-black">Credit</th>
                    <th className="py-2 text-right font-black">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.entries.map((entry) => (
                    <tr key={entry.id} data-ledger-entry={entry.source} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2.5 pr-3 font-bold text-slate-700 dark:text-slate-300">{formatDate(entry.date)}</td>
                      <td className="py-2.5 pr-3">
                        <button type="button" onClick={() => setDetailEntry(entry)}
                          title="View transaction detail"
                          className="text-left font-bold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300">
                          {entry.description}
                        </button>
                        <span className="ml-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{entry.sourceLabel}</span>
                        {entry.possibleDuplicate && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Possible duplicate</span>
                        )}
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {[entry.category, entry.method ? label(entry.method) : null, entry.reference].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-black text-slate-950 dark:text-white">
                        {entry.debitCents > 0 ? money.format(entry.debitCents / 100) : <span className="font-normal text-slate-300 dark:text-slate-700">—</span>}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-black text-emerald-700 dark:text-emerald-400">
                        {entry.creditCents > 0 ? money.format(entry.creditCents / 100) : <span className="font-normal text-slate-300 dark:text-slate-700">—</span>}
                      </td>
                      <td className={`py-2.5 text-right font-black ${balanceClass(entry.balanceAfterCents)}`}>
                        {money.format(entry.balanceAfterCents / 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}

          {ledger.possibleDuplicateCount > 0 && (
            <p className="mt-3 text-xs font-bold text-amber-700 dark:text-amber-400">
              {ledger.possibleDuplicateCount} entr{ledger.possibleDuplicateCount === 1 ? "y" : "ies"} flagged as possible duplicates — same amount and date from different sources. Review and delete one source if they are the same transaction.
            </p>
          )}
        </>
      )}

      {detailEntry && <PropertyTransactionDetailModal entry={detailEntry} onClose={() => setDetailEntry(null)} />}
    </section>
  );
}

// Read-only transaction detail for slice 1. Edit/delete arrive in slice 3 —
// this modal becomes the edit surface then.
function PropertyTransactionDetailModal({ entry, onClose }) {
  const rows = [
    ["Date", formatDate(entry.date)],
    ["Description", entry.description],
    ["Debit", entry.debitCents > 0 ? money.format(entry.debitCents / 100) : "—"],
    ["Credit", entry.creditCents > 0 ? money.format(entry.creditCents / 100) : "—"],
    ["Category", entry.category || "—"],
    ["Source", entry.sourceLabel || "—"],
    ["Status", label(entry.status)],
    ["Method", entry.method ? label(entry.method) : "—"],
    ["Reference", entry.reference || "—"],
    ["Notes", entry.notes || "—"],
    ["Balance after", money.format((entry.balanceAfterCents || 0) / 100)],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 print:hidden"
      onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={`Transaction detail: ${entry.description}`}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-xl font-black text-slate-950 dark:text-white">Transaction detail</h3>
          <button type="button" onClick={onClose} aria-label="Close transaction detail"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-black text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">✕</button>
        </div>
        <dl className="mt-4 space-y-2.5 text-sm">
          {rows.map(([term, value]) => (
            <div key={term} className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-2 dark:border-slate-800">
              <dt className="shrink-0 font-black uppercase tracking-wide text-slate-500 dark:text-slate-400 text-xs">{term}</dt>
              <dd className="text-right font-bold text-slate-950 dark:text-white">{value}</dd>
            </div>
          ))}
        </dl>
        {entry.possibleDuplicate && (
          <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Flagged as a possible duplicate — another source recorded the same amount on the same date.
          </p>
        )}
      </div>
    </div>
  );
}
