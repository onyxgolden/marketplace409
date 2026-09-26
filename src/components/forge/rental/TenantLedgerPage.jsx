"use client";
import { useEffect, useRef, useState } from "react";
import PostIncomeForm from "./PostIncomeForm";
import TenantCreditSection from "./TenantCreditSection";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeLoadingState } from "@/components/forge/ForgeStates";
import { DEPOSIT_STATE_DEPOSITED } from "@/application/rental/paymentDepositState";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const label = (value) => String(value ?? "—").replaceAll("_", " ");
const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
};
// Rentec convention carried through the app: a positive balance is money the tenant
// still owes (red); zero or a credit balance is green.
const balanceClass = (cents) => cents > 0
  ? "text-red-700 dark:text-red-400"
  : "text-emerald-700 dark:text-emerald-400";

async function fetchTenantLedger(tenantId) {
  const response = await fetch(`/api/rental/tenant-ledger?tenantId=${encodeURIComponent(tenantId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load the tenant ledger.");
  return body;
}

// Full-page tenant ledger — the Rentec-style running transaction table:
// Date | Description | Charge (Debit) | Payment (Credit) | Balance, with a rolling
// balance after every row. Charges and refunds land in the Charge column, payments in
// the Payment column. Security deposits are never in this table; they keep their own
// section below. Clicking a row's description opens the read-only transaction detail.
//
// Data layer: stale-while-revalidate. Reopening a recently viewed tenant's ledger
// serves the cached payload instantly and refreshes in the background — the last
// good ledger never blanks out while the new tenant's data loads.
export default function TenantLedgerPage({ tenantId, tenantName, unitLabel, onClose, onPostCharge, initialView = null }) {
  const { data, error, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    tenantId ? `tenant-ledger:${tenantId}` : null,
    () => fetchTenantLedger(tenantId),
    { ttlMs: 60_000 },
  );
  const ledger = data?.ledger || null;
  const deposits = data?.deposits || null;
  const importedHistory = data?.importedHistory || null;
  const openCharges = data?.openCharges || [];
  const credits = data?.credits || [];
  const creditApplications = data?.creditApplications || [];
  const availableCreditCents = credits
    .filter((credit) => credit.status === "open")
    .reduce((sum, credit) => sum + Number(credit.remaining_cents || 0), 0);
  const [detailEntry, setDetailEntry] = useState(null);
  const [showPostIncome, setShowPostIncome] = useState(initialView === "post-income");
  const [postedMessage, setPostedMessage] = useState("");
  const printFired = useRef(false);

  // "Print Statement" from the card menu lands here and fires the print dialog once
  // the ledger has loaded — one click from card to paper.
  useEffect(() => {
    if (initialView === "print" && !isLoading && !error && ledger && !printFired.current) {
      printFired.current = true;
      if (typeof window.print === "function") window.print();
    }
  }, [initialView, isLoading, error, ledger]);

  useEffect(() => {
    if (!detailEntry) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setDetailEntry(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailEntry]);

  const headerContext = ledger?.entries?.[0];
  const propertyLine = headerContext ? `${headerContext.unitLabel} · ${headerContext.propertyLabel}` : (unitLabel || "");

  return (
    <section data-tenant-ledger-page aria-label={`Full ledger for ${tenantName || "tenant"}`}
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <button type="button" onClick={onClose}
            className="text-sm font-black text-sky-700 underline hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300">
            ← Back to tenants
          </button>
          <p className="mt-2 text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Tenant ledger</p>
          <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">{tenantName || "Tenant"}</h2>
          {propertyLine && <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-400">{propertyLine}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setPostedMessage(""); setShowPostIncome((value) => !value); }}
            className={`rounded-xl px-4 py-2.5 text-sm font-black transition ${goldControlClassName}`}>
            Post Income
          </button>
          {onPostCharge && (
            <button type="button" onClick={onPostCharge}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              Post Charge
            </button>
          )}
          <button type="button" onClick={() => { if (typeof window.print === "function") window.print(); }}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            Print Statement
          </button>
        </div>
      </div>

      {postedMessage && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 print:hidden">{postedMessage}</p>}
      {isLoading && <ForgeLoadingState label="Loading ledger…" />}
      {isRefreshing && ledger && (
        <p className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p>
      )}
      {error && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      {!isLoading && ledger && (
        <>
          {showPostIncome && (
            <div className="mt-6 print:hidden">
              <PostIncomeForm tenantId={tenantId} tenantName={tenantName} openCharges={openCharges}
                onCancel={() => setShowPostIncome(false)}
                onStaleBalance={refresh}
                onSaved={(payment) => {
                  setShowPostIncome(false);
                  setPostedMessage(`Income posted: ${money.format(Number(payment?.amountCents || 0) / 100)} on ${formatDate(payment?.receivedAt)}.`);
                  refresh();
                }} />
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xl font-black text-slate-950 dark:text-white">Transactions</h3>
            <p className="text-sm font-bold text-slate-600 dark:text-slate-400">
              Balance: <strong className={`text-lg font-black ${balanceClass(ledger.balanceCents)}`}>{money.format(ledger.balanceCents / 100)}</strong>
              <span className="ml-2 font-normal">{ledger.balanceCents > 0 ? "owed" : ledger.balanceCents < 0 ? "credit" : "paid in full"}</span>
              {availableCreditCents > 0 && (
                <span className="ml-3 font-normal text-sky-700 dark:text-sky-400">Available credit: <strong>{money.format(availableCreditCents / 100)}</strong></span>
              )}
            </p>
          </div>

          {ledger.entries.length === 0
            ? <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No charges or payments on record for this tenant yet.</p>
            : <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm" data-ledger-table>
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    <th className="py-2 pr-3 font-black">Date</th>
                    <th className="py-2 pr-3 font-black">Description</th>
                    <th className="py-2 pr-3 text-right font-black">Charge (Debit)</th>
                    <th className="py-2 pr-3 text-right font-black">Payment (Credit)</th>
                    <th className="py-2 text-right font-black">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.entries.map((entry) => {
                    const isChargeSide = entry.kind !== "payment";
                    const isCreditMemo = entry.kind === "credit" || entry.kind === "credit_application";
                    return (
                      <tr key={entry.id} data-ledger-entry={entry.kind} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2.5 pr-3 font-bold text-slate-700 dark:text-slate-300">{formatDate(entry.date)}</td>
                        <td className="py-2.5 pr-3">
                          <button type="button" onClick={() => setDetailEntry(entry)}
                            title="View transaction detail"
                            className="text-left font-bold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300">
                            {entry.label}
                          </button>
                          {isCreditMemo && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black uppercase text-sky-800 dark:bg-sky-900 dark:text-sky-200">Credit memo</span>}
                          <span className="ml-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label(entry.status)}</span>
                          {entry.kind === "payment" && (
                            entry.depositState === DEPOSIT_STATE_DEPOSITED
                              ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Deposited</span>
                              : <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Awaiting deposit</span>
                          )}
                          {entry.rentecEvidence?.length > 0 && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black uppercase text-slate-700 dark:bg-slate-700 dark:text-slate-200">Rentec history</span>}
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            {[entry.period, entry.method ? label(entry.method) : null, entry.reference].filter(Boolean).join(" · ")}
                            {isCreditMemo && entry.remainingCents != null && ` · ${money.format(entry.remainingCents / 100)} remaining`}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-black text-slate-950 dark:text-white">
                          {isCreditMemo
                            ? <span className="font-bold text-slate-500 dark:text-slate-400">{money.format(entry.amountCents / 100)} <span className="text-[10px] font-black uppercase">memo</span></span>
                            : isChargeSide ? money.format(entry.amountCents / 100) : <span className="font-normal text-slate-300 dark:text-slate-700">—</span>}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-black text-emerald-700 dark:text-emerald-400">
                          {!isChargeSide ? money.format(entry.amountCents / 100) : <span className="font-normal text-slate-300 dark:text-slate-700">—</span>}
                        </td>
                        <td className={`py-2.5 text-right font-black ${balanceClass(entry.balanceAfterCents)}`}>
                          {money.format(entry.balanceAfterCents / 100)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>}

          {ledger.unassigned?.length > 0 && (
            <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30 print:hidden">
              <h4 className="font-black text-amber-900 dark:text-amber-200">Needs review — not assigned to a charge or payment</h4>
              <ul className="mt-2 space-y-1 text-sm font-bold text-amber-900 dark:text-amber-200">
                {ledger.unassigned.map((item) => (
                  <li key={item.id}>{formatDate(item.transactionDate)} · {money.format(item.amountCents / 100)} · {item.category || "Rentec import"} · {item.rentecTransactionId}</li>
                ))}
              </ul>
            </div>
          )}

          {(importedHistory?.rows?.length || 0) > 0 && (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40" data-imported-rentec-transactions>
              <h4 className="text-lg font-black text-slate-950 dark:text-white">Imported Rentec Transactions</h4>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Rentec-imported records linked to this tenant — accounting history only. They do not affect the balance above.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      <th className="py-2 pr-3 font-black">Date</th>
                      <th className="py-2 pr-3 font-black">Description</th>
                      <th className="py-2 pr-3 font-black">Category</th>
                      <th className="py-2 text-right font-black">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importedHistory.rows.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2 pr-3 font-bold text-slate-700 dark:text-slate-300">{formatDate(row.eventDate)}</td>
                        <td className="py-2 pr-3 font-bold text-slate-950 dark:text-white">{row.description || "—"}</td>
                        <td className="py-2 pr-3 text-slate-600 dark:text-slate-400">{label(row.category) || "—"}</td>
                        <td className="py-2 text-right font-black text-slate-950 dark:text-white">{money.format(row.amountCents / 100)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                {importedHistory.rows.length} transaction{importedHistory.rows.length === 1 ? "" : "s"} · total {money.format(importedHistory.totalCents / 100)} · source: Rentec import
              </p>
            </div>
          )}

          <TenantCreditSection credits={credits} creditApplications={creditApplications} openCharges={openCharges} onChanged={refresh} />

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40" data-ledger-deposits>
            <h4 className="text-lg font-black text-slate-950 dark:text-white">Deposits — held separately, never rent</h4>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Currently held: {money.format((deposits?.heldCents || 0) / 100)}.</p>
            {(deposits?.entries?.length || 0) === 0
              ? <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No deposit activity recorded.</p>
              : <ul className="mt-3 space-y-2 text-sm">
                {deposits.entries.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                    <span className="font-bold text-slate-950 dark:text-white">{entry.label} · {formatDate(entry.date)}</span>
                    <span className="font-black text-slate-950 dark:text-white">{money.format(entry.amountCents / 100)} <span className="font-bold text-slate-500">· held {money.format(entry.balanceAfterCents / 100)}</span></span>
                  </li>
                ))}
              </ul>}
          </div>
        </>
      )}

      {detailEntry && <TransactionDetailModal entry={detailEntry} onClose={() => setDetailEntry(null)} />}
    </section>
  );
}

// Read-only transaction detail: date, amount, payment type, category, check/ref #,
// memo, and every ledger/record this entry posted to.
function TransactionDetailModal({ entry, onClose }) {
  const isPayment = entry.kind === "payment";
  const postedTo = ["Tenant payment ledger"];
  if (entry.kind === "charge") postedTo.push("Rent charge record");
  if (entry.chargeId) postedTo.push("Applied to rent charge");
  if (entry.settlement) postedTo.push(`Payment settlement (${label(entry.settlement.status)})`);
  if (entry.rentecEvidence?.length > 0) postedTo.push("Rentec import evidence");
  if (entry.kind === "refund") postedTo.push("Linked refund of payment");
  const rows = [
    ["Date", formatDate(entry.date)],
    ["Description", entry.label],
    ["Amount", money.format(entry.amountCents / 100)],
    ["Type", isPayment ? `Payment${entry.method ? ` · ${label(entry.method)}` : ""}` : `Charge${entry.method ? ` · ${label(entry.method)}` : ""}`],
    ["Category", isPayment ? "Payment" : label(entry.label)],
    ["Status", label(entry.status)],
    ["Check / ref #", entry.reference || "—"],
    ["Period", entry.period || "—"],
    ["Property / unit", `${entry.unitLabel || "—"} · ${entry.propertyLabel || "—"}`],
    ["Memo", entry.notes || "—"],
    ["Balance after", money.format(entry.balanceAfterCents / 100)],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 print:hidden"
      onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label={`Transaction detail: ${entry.label}`}
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
        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Posted to</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {postedTo.map((place) => (
              <li key={place} className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-black text-sky-900 dark:bg-sky-950 dark:text-sky-200">{place}</li>
            ))}
          </ul>
        </div>
        {entry.refundedAmountCents > 0 && (
          <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Refunded {money.format(entry.refundedAmountCents / 100)} — the refund posts as its own compensating entry.
          </p>
        )}
      </div>
    </div>
  );
}
