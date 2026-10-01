"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import PostIncomeForm from "./PostIncomeForm";
import AddTenantChargeForm from "./AddTenantChargeForm";
import TenantCreditSection from "./TenantCreditSection";
import TenantInvoiceEditor from "./TenantInvoiceEditor";
import StatementEmailDialog from "./StatementEmailDialog";
import CorrectPaymentDialog from "./CorrectPaymentDialog";
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
// Tenant convention: a positive balance is money the tenant still owes (red);
// zero or a credit balance is green.
const balanceClass = (cents) => cents > 0
  ? "text-red-700 dark:text-red-400"
  : "text-emerald-700 dark:text-emerald-400";

async function fetchTenantLedger(tenantId) {
  const response = await fetch(`/api/rental/tenant-ledger?tenantId=${encodeURIComponent(tenantId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load the tenant ledger.");
  return body;
}

// Full-page tenant ledger — the reference accounting layout: breadcrumb,
// Ledger heading, Post Income / Post Charge / On Deposit action row, filter +
// date-range selectors, and a Date / Description / Check # / Debit / Credit /
// Balance table with a cleared column and per-row edit. Charge rows open the
// invoice editor; payment rows open the read-only transaction detail.
// Security deposits are never in this table — the On Deposit pill up top and
// the deposits section below are their home.
//
// Data layer: stale-while-revalidate. Reopening a recently viewed tenant's
// ledger serves the cached payload instantly and refreshes in the background.
export default function TenantLedgerPage({ tenantId, tenantName, unitLabel, onClose, closeLabel = "Tenants", initialView = null, onOpenPropertyLedger, onOpenBankLedger }) {
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
  const heldCents = Number(deposits?.heldCents || 0);
  const [detailEntry, setDetailEntry] = useState(null);
  const [invoiceCharge, setInvoiceCharge] = useState(null);
  const [showPostIncome, setShowPostIncome] = useState(initialView === "post-income");
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [postedMessage, setPostedMessage] = useState("");
  const [kindFilter, setKindFilter] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [compactRows, setCompactRows] = useState(false);
  const [showSubLine, setShowSubLine] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [emailStatementOpen, setEmailStatementOpen] = useState(false);
  const depositsRef = useRef(null);
  const printFired = useRef(false);
  // The On Deposit pill scrolls to the inline deposits section and briefly
  // highlights it, so the click always has visible feedback even when the
  // section is already on screen.
  const [depositsFlash, setDepositsFlash] = useState(false);
  const depositsFlashTimer = useRef(null);
  useEffect(() => () => { if (depositsFlashTimer.current) clearTimeout(depositsFlashTimer.current); }, []);
  function revealDeposits() {
    // scrollIntoView is a no-op where the DOM doesn't implement it (tests) --
    // the highlight is the feedback that always applies.
    depositsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    setDepositsFlash(true);
    if (depositsFlashTimer.current) clearTimeout(depositsFlashTimer.current);
    depositsFlashTimer.current = setTimeout(() => setDepositsFlash(false), 1600);
  }

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

  const filteredEntries = useMemo(() => {
    if (!ledger) return [];
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    return ledger.entries.filter((entry) => {
      if (kindFilter === "charges" && entry.kind !== "charge") return false;
      if (kindFilter === "payments" && entry.kind !== "payment") return false;
      if (kindFilter === "credits" && entry.kind !== "credit" && entry.kind !== "credit_application") return false;
      if (dateRange !== "all" && entry.date) {
        const day = new Date(entry.date.length === 10 ? `${entry.date}T12:00:00` : entry.date);
        if (Number.isNaN(day.getTime())) return true;
        if (dateRange === "month" && day < startOfMonth) return false;
        if (dateRange === "lastMonth" && (day < startOfLastMonth || day >= startOfMonth)) return false;
        if (dateRange === "year" && day < startOfYear) return false;
        if (dateRange === "custom") {
          if (customStart && day < new Date(`${customStart}T12:00:00`)) return false;
          if (customEnd && day > new Date(`${customEnd}T23:59:59`)) return false;
        }
      }
      return true;
    });
  }, [ledger, kindFilter, dateRange, customStart, customEnd]);
  const filtersActive = kindFilter !== "all" || dateRange !== "all";

  const headerContext = ledger?.entries?.[0];
  const propertyKey = headerContext?.propertyLabel && !String(headerContext.propertyLabel).startsWith("Unknown")
    ? String(headerContext.propertyLabel) : null;
  const propertyLine = headerContext ? `${headerContext.unitLabel || ""}` : (unitLabel || "");

  const openInvoice = (entry) => {
    if (entry.kind !== "charge" || entry.status === "void") return;
    setInvoiceCharge({ chargeId: entry.sourceId || String(entry.id).replace(/^charge:/, ""), label: entry.label, tenantEmail: data?.tenant?.email || "" });
  };

  async function sendStatementEmail() {
    const response = await fetch("/api/rental/tenant-statement-email", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId, kind: "statement" }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "The statement email could not be sent.");
    setEmailStatementOpen(false);
    refresh();
    setPostedMessage(body.alreadySent
      ? `Statement already sent to ${body.recipient || data?.tenant?.email || "the tenant"}.`
      : `Statement emailed to ${body.recipient || data?.tenant?.email || "the tenant"}.`);
  }

  // The invoice editor is its own screen — the reference's Edit Invoice page.
  if (invoiceCharge) {
    return (
      <section data-tenant-ledger-page aria-label={`Edit invoice for ${tenantName || "tenant"}`}
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <button type="button" onClick={() => setInvoiceCharge(null)}
          className="text-sm font-black text-sky-700 underline hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300 print:hidden">
          ← Back to ledger
        </button>
        <div className="mt-4">
          <TenantInvoiceEditor chargeId={invoiceCharge.chargeId} tenantId={tenantId} tenantName={tenantName}
            tenantEmail={invoiceCharge.tenantEmail}
            onClose={() => setInvoiceCharge(null)}
            onSaved={() => { setPostedMessage("Invoice saved."); refresh(); }} />
        </div>
      </section>
    );
  }

  return (
    <section data-tenant-ledger-page aria-label={`Full ledger for ${tenantName || "tenant"}`}
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
            <button type="button" onClick={onClose} className="font-black text-sky-700 underline hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300">{closeLabel}</button>
            <span className="mx-1.5">/</span>
            <span className="font-black text-slate-700 dark:text-slate-200">{tenantName || "Tenant"}</span>
          </p>
          <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Ledger</h2>
          {propertyLine && (
            <p className="mt-1 text-sm font-bold text-slate-600 dark:text-slate-400">
              {propertyLine}
              {propertyKey && onOpenPropertyLedger && (
                <> · <button type="button" onClick={() => onOpenPropertyLedger(propertyKey, propertyLine || propertyKey)}
                  className="font-black text-sky-700 underline hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300">
                  Open property ledger
                </button></>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { setPostedMessage(""); setShowPostIncome((value) => !value); setShowAddCharge(false); }}
            className={`rounded-xl px-4 py-2.5 text-sm font-black transition ${goldControlClassName}`}>
            Post Income
          </button>
          <button type="button" onClick={() => { setPostedMessage(""); setShowAddCharge((value) => !value); setShowPostIncome(false); }}
            className="rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-black text-red-700 transition hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/60">
            Post Charge
          </button>
          <button type="button" onClick={revealDeposits}
            title="Security deposits held for this tenant — jump to the deposits section below"
            className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
            On Deposit: {money.format(heldCents / 100)}
          </button>
          <button type="button" onClick={() => { setPostedMessage(""); setEmailStatementOpen(true); }}
            title="Email this tenant their ledger statement"
            className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-2.5 text-sm font-black text-sky-700 transition hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/60 print:hidden">
            Email Statement
          </button>
          <div className="relative">
            <button type="button" onClick={() => setSettingsOpen((open) => !open)} aria-label="Ledger display settings"
              aria-expanded={settingsOpen}
              className="rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              ⚙
            </button>
            {settingsOpen && (
              <div className="absolute right-0 z-20 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Row density</p>
                <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Row density">
                  {[false, true].map((compact) => (
                    <button key={String(compact)} type="button" role="radio" aria-checked={compactRows === compact}
                      onClick={() => setCompactRows(compact)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-black ${compactRows === compact
                        ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                        : "border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300"}`}>
                      {compact ? "Compact" : "Comfortable"}
                    </button>
                  ))}
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-300">
                  <input type="checkbox" checked={showSubLine} onChange={(event) => setShowSubLine(event.target.checked)}
                    className="h-4 w-4 accent-emerald-600" />
                  Show detail line
                </label>
                <button type="button" onClick={() => { setSettingsOpen(false); if (typeof window.print === "function") window.print(); }}
                  className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
                  Print ledger
                </button>
              </div>
            )}
          </div>
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

          {showAddCharge && (
            <div className="mt-6 print:hidden">
              <AddTenantChargeForm tenantId={tenantId} tenantName={tenantName}
                onCancel={() => setShowAddCharge(false)}
                onSaved={(charge) => {
                  setShowAddCharge(false);
                  setPostedMessage(`Charge posted: ${money.format(Number(charge?.amount_cents || 0) / 100)} — ${charge?.notes || "tenant charge"}.`);
                  refresh();
                }} />
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-xl font-black text-slate-950 dark:text-white">Transactions</h3>
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <label className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <span className="sr-only">Filter transactions</span>
                <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)} aria-label="Filter transactions"
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                  <option value="all">All transactions</option>
                  <option value="charges">Charges</option>
                  <option value="payments">Payments</option>
                  <option value="credits">Credits</option>
                </select>
              </label>
              <label className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <span className="sr-only">Date range</span>
                <select value={dateRange} onChange={(event) => setDateRange(event.target.value)} aria-label="Date range"
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                  <option value="all">All dates</option>
                  <option value="month">This month</option>
                  <option value="lastMonth">Last month</option>
                  <option value="year">This year</option>
                  <option value="custom">Custom…</option>
                </select>
              </label>
              {dateRange === "custom" && (
                <span className="flex items-center gap-1 text-xs font-bold text-slate-600 dark:text-slate-300">
                  <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} aria-label="Start date"
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800" />
                  <span>–</span>
                  <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} aria-label="End date"
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800" />
                </span>
              )}
            </div>
          </div>
          <p className="mt-2 text-sm font-bold text-slate-600 dark:text-slate-400">
            Balance: <strong className={`text-lg font-black ${balanceClass(ledger.balanceCents)}`}>{money.format(ledger.balanceCents / 100)}</strong>
            <span className="ml-2 font-normal">{ledger.balanceCents > 0 ? "owed" : ledger.balanceCents < 0 ? "credit" : "paid in full"}</span>
            {availableCreditCents > 0 && (
              <span className="ml-3 font-normal text-sky-700 dark:text-sky-400">Available credit: <strong>{money.format(availableCreditCents / 100)}</strong></span>
            )}
          </p>
          {filtersActive && (
            <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
              Showing {filteredEntries.length} of {ledger.entries.length} entries.
            </p>
          )}

          {filteredEntries.length === 0
            ? <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No charges or payments on record for this tenant yet.</p>
            : <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm" data-ledger-table>
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    <th className="py-2 pr-3 font-black">Date</th>
                    <th className="py-2 pr-3 font-black">Description</th>
                    <th className="py-2 pr-3 font-black">Check #</th>
                    <th className="py-2 pr-3 text-right font-black">Debit</th>
                    <th className="py-2 pr-3 text-right font-black">Credit</th>
                    <th className="py-2 pr-3 text-right font-black">Balance</th>
                    <th className="py-2 pr-3 text-center font-black" title="Cleared / deposited">C</th>
                    <th className="py-2 text-center font-black"><span className="sr-only">Edit</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => {
                    const isCharge = entry.kind === "charge";
                    const isPayment = entry.kind === "payment";
                    const isCreditMemo = entry.kind === "credit" || entry.kind === "credit_application";
                    const deposited = isPayment && entry.depositState === DEPOSIT_STATE_DEPOSITED;
                    const editable = isCharge && entry.status !== "void";
                    const rowPad = compactRows ? "py-1" : "py-2.5";
                    return (
                      <tr key={entry.id} data-ledger-entry={entry.kind} className="border-b border-slate-100 dark:border-slate-800">
                        <td className={`${rowPad} pr-3 font-bold text-slate-700 dark:text-slate-300`}>{formatDate(entry.date)}</td>
                        <td className={`${rowPad} pr-3`}>
                          {isCharge ? (
                            <button type="button" onClick={() => openInvoice(entry)} disabled={!editable}
                              title={editable ? "Edit invoice" : "Voided charges cannot be edited"}
                              className={`text-left font-bold ${editable
                                ? "text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300"
                                : "text-slate-500 dark:text-slate-400"}`}>
                              <span aria-hidden="true" className="mr-1.5">🧾</span>{entry.label}
                            </button>
                          ) : (
                            <button type="button" onClick={() => setDetailEntry(entry)}
                              title="View transaction detail"
                              className="text-left font-bold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300">
                              {entry.label}
                            </button>
                          )}
                          {isCreditMemo && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black uppercase text-sky-800 dark:bg-sky-900 dark:text-sky-200">Credit memo</span>}
                          {entry.status === "void" && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black uppercase text-slate-600 dark:bg-slate-700 dark:text-slate-300">Void</span>}
                          {isPayment && (
                            deposited
                              ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Deposited</span>
                              : <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Awaiting deposit</span>
                          )}
                          {entry.rentecEvidence?.length > 0 && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black uppercase text-slate-700 dark:bg-slate-700 dark:text-slate-200">Rentec history</span>}
                          {showSubLine && (
                            <span className="block text-xs text-slate-500 dark:text-slate-400">
                              {[entry.period, entry.method ? label(entry.method) : null, isCharge ? label(entry.status) : null].filter(Boolean).join(" · ")}
                              {isCreditMemo && entry.remainingCents != null && ` · ${money.format(entry.remainingCents / 100)} remaining`}
                              {deposited && onOpenBankLedger && (
                                <> · <button type="button" onClick={() => onOpenBankLedger()}
                                  className="font-bold text-sky-700 underline hover:text-sky-900 dark:text-sky-400">View in bank ledger</button></>
                              )}
                            </span>
                          )}
                        </td>
                        <td className={`${rowPad} pr-3 font-bold text-slate-600 dark:text-slate-400`}>{entry.reference && isPayment ? entry.reference : "—"}</td>
                        <td className={`${rowPad} pr-3 text-right font-black text-slate-950 dark:text-white`}>
                          {isCharge && !isCreditMemo ? money.format(entry.amountCents / 100) : <span className="font-normal text-slate-300 dark:text-slate-700">—</span>}
                        </td>
                        <td className={`${rowPad} pr-3 text-right font-black text-emerald-700 dark:text-emerald-400`}>
                          {isPayment ? money.format(entry.amountCents / 100) : <span className="font-normal text-slate-300 dark:text-slate-700">—</span>}
                        </td>
                        <td className={`${rowPad} pr-3 text-right font-black ${balanceClass(entry.balanceAfterCents)}`}>
                          {money.format(entry.balanceAfterCents / 100)}
                        </td>
                        <td className={`${rowPad} pr-3 text-center font-black text-emerald-700 dark:text-emerald-400`}>
                          {deposited ? "✓" : <span className="font-normal text-slate-300 dark:text-slate-700">—</span>}
                        </td>
                        <td className={`${rowPad} text-center`}>
                          {editable ? (
                            <button type="button" onClick={() => openInvoice(entry)} title="Edit invoice" aria-label={`Edit invoice: ${entry.label}`}
                              className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100">
                              ✎
                            </button>
                          ) : <span className="text-slate-300 dark:text-slate-700">—</span>}
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

          <div ref={depositsRef} className={`mt-6 scroll-mt-6 rounded-2xl border bg-slate-50 p-5 transition-shadow dark:bg-slate-950/40 ${depositsFlash ? "border-sky-400 shadow-[0_0_0_4px_rgba(56,189,248,0.35)] dark:border-sky-500" : "border-slate-200 dark:border-slate-700"}`} data-ledger-deposits>
            <h4 className="text-lg font-black text-slate-950 dark:text-white">Deposits — held separately, never rent</h4>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Currently held: {money.format(heldCents / 100)}.</p>
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

      {detailEntry && <TransactionDetailModal entry={detailEntry} onClose={() => setDetailEntry(null)} onCorrected={refresh} />}
      {emailStatementOpen && (
        <StatementEmailDialog
          title={`Email statement — ${tenantName || "tenant"}`}
          recipientEmail={data?.tenant?.email || ""}
          summaryLines={[
            { label: "Ledger entries", value: String(filteredEntries.length) },
            { label: "Balance due", value: money.format(Number(ledger?.balanceCents || 0) / 100) },
          ]}
          confirmLabel="Send statement"
          onConfirm={sendStatementEmail}
          onClose={() => setEmailStatementOpen(false)}
        />
      )}
    </section>
  );
}

// Read-only transaction detail: date, amount, payment type, category, check/ref #,
// memo, and every ledger/record this entry posted to.
function TransactionDetailModal({ entry, onClose, onCorrected }) {
  const [showCorrect, setShowCorrect] = useState(false);
  const isPayment = entry.kind === "payment";
  // R18: correction is offered on completed payments. The dialog loads the
  // authoritative correctable state (offline vs provider, reconciled, …)
  // and the API enforces owner/co-owner — a 403 reads as plain English.
  const canOfferCorrection = isPayment && entry.status === "succeeded";
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
        {canOfferCorrection && (
          <div className="mt-4 flex justify-end print:hidden">
            <button type="button" onClick={() => setShowCorrect(true)}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700">
              Correct payment
            </button>
          </div>
        )}
      </div>
      {showCorrect && (
        <div onClick={(event) => event.stopPropagation()}>
          <CorrectPaymentDialog
            paymentId={entry.sourceId}
            onClose={() => setShowCorrect(false)}
            onDone={() => { setShowCorrect(false); onClose(); onCorrected?.(); }}
          />
        </div>
      )}
    </div>
  );
}
