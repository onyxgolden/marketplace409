"use client";
import { useMemo, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeLoadingState } from "@/components/forge/ForgeStates";
import { validateFundTransferInput } from "@/application/rental/fundTransfers";
import BankReconciliationPanel from "./BankReconciliationPanel";
import TransactionForm from "./TransactionForm";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const label = (value) => String(value ?? "—").replaceAll("_", " ");
const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
};
const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
// Register convention: a positive balance is money in the account (green); a
// negative balance is red.
const balanceClass = (cents) => cents < 0
  ? "text-red-700 dark:text-red-400"
  : "text-emerald-700 dark:text-emerald-400";

async function fetchBankAccounts() {
  const response = await fetch("/api/rental/bank-accounts");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load bank accounts.");
  return body.accounts || [];
}

async function fetchBankLedger(bankAccountId) {
  const response = await fetch(`/api/rental/bank-ledger?bankAccountId=${encodeURIComponent(bankAccountId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load the bank ledger.");
  return body;
}

async function setCleared(eventId, cleared) {
  const response = await fetch("/api/rental/financial-event", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: eventId, cleared }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to update the transaction.");
  return body;
}

async function fetchTransaction(eventId) {
  const response = await fetch(`/api/rental/transactions?eventId=${encodeURIComponent(eventId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load the transaction.");
  return body.event;
}

async function deleteTransaction(eventId) {
  const response = await fetch(`/api/rental/transactions?eventId=${encodeURIComponent(eventId)}`, { method: "DELETE" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to delete the transaction.");
  return body;
}

async function postTransfer(payload) {
  const response = await fetch("/api/rental/transfers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to save the transfer.");
  return body;
}

// Fund transfer form: move money between two of the owner's bank accounts.
// The write is one atomic RPC call — an expense leg out of the source and an
// income leg into the destination — so a one-sided transfer is impossible.
function FundTransferForm({ accounts, fromAccountId, onSaved, onCancel }) {
  const [form, setForm] = useState({
    fromAccountId: fromAccountId || "",
    toAccountId: "",
    eventDate: todayIso(),
    amount: "",
    memo: "",
    checkNumber: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const update = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  };

  async function onSubmit(event) {
    event.preventDefault();
    setError("");
    const { valid, errors, value } = validateFundTransferInput({
      ...form,
      amount: form.amount === "" ? Number.NaN : Number(form.amount),
    });
    if (!valid) {
      setError(errors.join(" "));
      return;
    }
    setSubmitting(true);
    try {
      const result = await postTransfer(value);
      onSaved(result);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label="Transfer funds">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
          From account
          <select value={form.fromAccountId} onChange={update("fromAccountId")} className={`${inputClass} mt-1`} required>
            <option value="">Choose…</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.official_name || account.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
          To account
          <select value={form.toAccountId} onChange={update("toAccountId")} className={`${inputClass} mt-1`} required>
            <option value="">Choose…</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.official_name || account.name}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
          Date
          <input type="date" value={form.eventDate} onChange={update("eventDate")} className={`${inputClass} mt-1`} required />
        </label>
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
          Amount
          <input type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount}
            onChange={update("amount")} placeholder="0.00" className={`${inputClass} mt-1`} required />
        </label>
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
          Memo <span className="font-normal text-slate-400">(optional)</span>
          <input type="text" value={form.memo} onChange={update("memo")} placeholder="What was this for?"
            className={`${inputClass} mt-1`} />
        </label>
        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">
          Check # <span className="font-normal text-slate-400">(optional)</span>
          <input type="text" value={form.checkNumber} onChange={update("checkNumber")} placeholder="—"
            className={`${inputClass} mt-1`} />
        </label>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Posts two linked entries at once: a debit on the source account and a credit on the destination account.
      </p>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={submitting}
          className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
          Cancel
        </button>
        <button type="submit" disabled={submitting}
          className={`rounded-xl px-5 py-2.5 text-sm font-black transition ${goldControlClassName} disabled:opacity-50`}>
          {submitting ? "Saving…" : "Save transfer"}
        </button>
      </div>
    </form>
  );
}

function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 shadow-xl dark:bg-slate-900 sm:rounded-3xl ${wide ? "sm:max-w-3xl" : "sm:max-w-xl"}`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-xl font-black text-slate-950 dark:text-white">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-black text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Full-page bank account ledger — the bank register: Date | Description |
// Check # | Debit | Credit | Balance | Cleared, with a running balance after
// every row. Expenses post to Debit, income to Credit. Each row carries a
// cleared toggle; Reconcile opens the full statement reconciliation
// (BankReconciliationPanel). Post Income / Post Expense record manual
// transactions on the selected account; Transfer Funds moves money between
// two accounts as one atomic, two-legged entry.
//
// Data layer: stale-while-revalidate per account. Switching back to a recently
// viewed account serves the cached register instantly and refreshes in the
// background.
export default function BankLedgerPage({ onNavigate = null }) {
  const { data: accountsData, error: accountsError, isLoading: accountsLoading } = useStaleWhileRevalidate(
    "bank-ledger:accounts",
    fetchBankAccounts,
    { ttlMs: 300_000 },
  );
  const accounts = accountsData || [];
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  // Default to the first account until the user picks one — derived during
  // render, not synced in an effect.
  const effectiveAccountId = selectedAccountId || (accounts.length > 0 ? accounts[0].id : null);
  const [togglingId, setTogglingId] = useState(null);
  const [toggleError, setToggleError] = useState("");
  const [showReconcile, setShowReconcile] = useState(false);
  // Ledger view controls: transaction filter, date range, display settings.
  const [kindFilter, setKindFilter] = useState("all");
  const [dateRange, setDateRange] = useState("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [compactRows, setCompactRows] = useState(false);
  const [showSubLine, setShowSubLine] = useState(true);
  // Posting / editing flows.
  const [postKind, setPostKind] = useState(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editError, setEditError] = useState("");
  const [notice, setNotice] = useState("");

  const { data, error, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    effectiveAccountId ? `bank-ledger:${effectiveAccountId}` : null,
    () => fetchBankLedger(effectiveAccountId),
    { ttlMs: 60_000 },
  );
  const ledger = data?.ledger || null;
  const account = data?.account || null;
  const accountName = account?.officialName || account?.name || ledger?.accountName || "Bank account";

  async function onToggleCleared(entry) {
    setTogglingId(entry.sourceId);
    setToggleError("");
    try {
      await setCleared(entry.sourceId, !entry.cleared);
      await refresh();
    } catch (caught) {
      setToggleError(caught.message);
    } finally {
      setTogglingId(null);
    }
  }

  async function startEdit(entry) {
    setEditError("");
    try {
      const event = await fetchTransaction(entry.sourceId);
      setEditingEvent(event);
    } catch (caught) {
      setEditError(caught.message);
    }
  }

  async function confirmDelete(entry) {
    setEditError("");
    const isTransfer = Boolean(entry.transferGroupId);
    const labelText = isTransfer
      ? `Delete this fund transfer? Both legs (debit and credit) will be removed.`
      : `Delete "${entry.description}"?`;
    if (!window.confirm(labelText)) return;
    try {
      const result = await deleteTransaction(entry.sourceId);
      setNotice(result.deletedTransfer
        ? "Transfer deleted — both legs were removed."
        : "Transaction deleted.");
      await refresh();
    } catch (caught) {
      setEditError(caught.message);
    }
  }

  function openPropertyLedger(entry) {
    if (!onNavigate || !entry.propertyId) return;
    onNavigate("setup", {
      recordType: "property",
      recordId: entry.propertyId,
      recordLabel: entry.propertyLabel || "Property",
    });
  }

  // Client-side filtering over the loaded entries: kind filter + date range.
  // "This month"/"Last month"/"This year" use the device's local calendar.
  const filteredEntries = useMemo(() => {
    const rows = ledger?.entries || [];
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);
    return rows.filter((entry) => {
      if (kindFilter === "income" && entry.creditCents <= 0) return false;
      if (kindFilter === "expense" && entry.debitCents <= 0) return false;
      if (kindFilter === "transfer" && !entry.transferGroupId) return false;
      if (kindFilter === "cleared" && !entry.cleared) return false;
      if (kindFilter === "uncleared" && entry.cleared) return false;
      if (!entry.date) return dateRange === "all";
      const entryDate = new Date(`${entry.date}T12:00:00`);
      if (dateRange === "month" && entryDate < monthStart) return false;
      if (dateRange === "lastMonth" && (entryDate < lastMonthStart || entryDate >= monthStart)) return false;
      if (dateRange === "year" && entryDate < yearStart) return false;
      if (dateRange === "custom") {
        if (customStart && entry.date < customStart) return false;
        if (customEnd && entry.date > customEnd) return false;
      }
      return true;
    });
  }, [ledger, kindFilter, dateRange, customStart, customEnd]);

  const actionButtonClass = "rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-50";

  return (
    <section data-bank-ledger-page aria-label="Bank account ledger"
      className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-6">
      <p className="text-xs font-bold text-slate-400 dark:text-slate-500">
        <span>Banking</span>
        <span aria-hidden="true" className="mx-1.5">/</span>
        <span className="text-slate-600 dark:text-slate-300">{accountName}</span>
      </p>
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-3xl font-black tracking-tight text-slate-950 dark:text-white sm:text-4xl">Ledger</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="bank-ledger-account" className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Account
          </label>
          <select id="bank-ledger-account" value={effectiveAccountId || ""}
            onChange={(event) => { setSelectedAccountId(event.target.value || null); setShowReconcile(false); setNotice(""); }}
            disabled={accountsLoading || accounts.length === 0}
            className="max-w-[220px] rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>{item.official_name || item.name}</option>
            ))}
          </select>
        </div>
      </div>

      {ledger && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setPostKind("income")}
            className={`rounded-xl px-4 py-2.5 text-sm font-black transition ${goldControlClassName}`}>
            Post Income
          </button>
          <button type="button" onClick={() => setPostKind("expense")}
            className={actionButtonClass}>
            Post Expense
          </button>
          <button type="button" onClick={() => setTransferOpen(true)}
            disabled={accounts.length < 2}
            title={accounts.length < 2 ? "A transfer needs at least two bank accounts." : "Move money between two bank accounts"}
            className={actionButtonClass}>
            Transfer Funds
          </button>
          <button type="button" onClick={() => setShowReconcile((value) => !value)}
            className={actionButtonClass}>
            Reconcile
          </button>
          <button type="button" disabled
            title="Bank feed not connected"
            aria-disabled="true"
            className={actionButtonClass}>
            Sync w/ Bank
          </button>
          <button type="button" onClick={() => setSettingsOpen((value) => !value)}
            aria-expanded={settingsOpen} aria-label="Ledger display settings" title="Display settings"
            className={actionButtonClass}>
            <span aria-hidden="true">⚙</span>
          </button>
        </div>
      )}
      {ledger && (
        <p className="mt-2 text-xs font-bold text-slate-400 dark:text-slate-500">Bank feed not connected.</p>
      )}
      {settingsOpen && (
        <div className="mt-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <label className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={compactRows} onChange={(event) => setCompactRows(event.target.checked)}
              className="h-4 w-4 accent-emerald-600" />
            Compact rows
          </label>
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

      {accountsError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{accountsError}</p>}
      {accountsLoading && <ForgeLoadingState label="Loading accounts…" />}
      {!accountsLoading && !accountsError && accounts.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No active bank accounts yet. Add an account first, then come back to the register.
        </p>
      )}

      {effectiveAccountId && (
        <>
          {toggleError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{toggleError}</p>}
          {editError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{editError}</p>}
          {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</p>}
          {isLoading && <ForgeLoadingState label="Loading register…" />}
          {isRefreshing && ledger && (
            <p className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p>
          )}
          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

          {!isLoading && ledger && (
            <>
              <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xl font-black text-slate-950 dark:text-white">{accountName}</h3>
                <p className="text-sm font-bold text-slate-600 dark:text-slate-400">
                  Balance: <strong className={`text-lg font-black ${balanceClass(ledger.balanceCents)}`}>{money.format(ledger.balanceCents / 100)}</strong>
                  {ledger.unclearedCount > 0 && (
                    <span className="ml-3 font-normal text-amber-700 dark:text-amber-400">
                      {ledger.unclearedCount} uncleared
                    </span>
                  )}
                </p>
              </div>

              {showReconcile && (
                <BankReconciliationPanel
                  key={effectiveAccountId}
                  bankAccountId={effectiveAccountId}
                  entries={ledger.entries}
                  onChanged={refresh}
                />
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <label className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <span className="sr-only">Filter transactions</span>
                  <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)} aria-label="Filter transactions"
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                    <option value="all">All transactions</option>
                    <option value="income">Income</option>
                    <option value="expense">Expenses</option>
                    <option value="transfer">Transfers</option>
                    <option value="cleared">Cleared</option>
                    <option value="uncleared">Uncleared</option>
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

              {filteredEntries.length === 0
                ? <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {ledger.entries.length === 0 ? "No transactions on this account yet." : "No transactions match this filter."}
                </p>
                : <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left text-sm" data-ledger-table>
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        <th className="py-2 pr-3 font-black">Date</th>
                        <th className="py-2 pr-3 font-black">Description</th>
                        <th className="py-2 pr-3 font-black">Check #</th>
                        <th className="py-2 pr-3 text-right font-black">Debit</th>
                        <th className="py-2 pr-3 text-right font-black">Credit</th>
                        <th className="py-2 pr-3 text-right font-black">Balance</th>
                        <th className="py-2 pr-3 text-center font-black">C</th>
                        <th className="py-2 text-center font-black"><span className="sr-only">Edit</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.map((entry) => {
                        const counterpartAccount = entry.counterpartAccountId
                          ? accounts.find((item) => item.id === entry.counterpartAccountId)
                          : null;
                        const canEdit = entry.sourceSystem === "manual";
                        const cellPad = compactRows ? "py-1.5" : "py-2.5";
                        return (
                          <tr key={entry.id} data-ledger-entry={entry.status} className="border-b border-slate-100 dark:border-slate-800">
                            <td className={`${cellPad} pr-3 font-bold text-slate-700 dark:text-slate-300`}>{formatDate(entry.date)}</td>
                            <td className={`${cellPad} pr-3`}>
                              <span className="font-bold text-slate-950 dark:text-white">{entry.description}</span>
                              {showSubLine && (
                                <span className="block text-xs text-slate-500 dark:text-slate-400">
                                  {[entry.payee ? `Payee: ${entry.payee}` : null,
                                    entry.category !== "—" ? label(entry.category) : null,
                                    entry.tenantLabel ? `Tenant: ${entry.tenantLabel}` : null,
                                    entry.memo ? `Memo: ${entry.memo}` : null,
                                    entry.sourceSystem ? label(entry.sourceSystem) : null,
                                  ].filter(Boolean).join(" · ") || "—"}
                                </span>
                              )}
                              {entry.transferGroupId && (
                                <span className="mt-0.5 block text-xs font-bold text-sky-700 dark:text-sky-400">
                                  ⇄ Transfer {entry.transferDirection === "out" ? "to" : "from"}{" "}
                                  {counterpartAccount ? (
                                    <button type="button" onClick={() => setSelectedAccountId(counterpartAccount.id)}
                                      className="underline underline-offset-2 hover:text-sky-900 dark:hover:text-sky-300"
                                      title={`Open the ${counterpartAccount.official_name || counterpartAccount.name} register`}>
                                      {entry.counterpartAccountName || counterpartAccount.official_name || counterpartAccount.name}
                                    </button>
                                  ) : (
                                    entry.counterpartAccountName || "another account"
                                  )}
                                </span>
                              )}
                              {entry.propertyId && (
                                <span className="mt-0.5 block text-xs">
                                  {onNavigate ? (
                                    <button type="button" onClick={() => openPropertyLedger(entry)}
                                      className="font-bold text-sky-700 underline underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300"
                                      title="Open this property's ledger">
                                      {entry.propertyLabel || "Property ledger"} →
                                    </button>
                                  ) : (
                                    <span className="font-bold text-slate-500 dark:text-slate-400">
                                      {entry.propertyLabel || "Property"}
                                    </span>
                                  )}
                                </span>
                              )}
                            </td>
                            <td className={`${cellPad} pr-3 font-bold text-slate-700 dark:text-slate-300`}>{entry.checkNumber || "—"}</td>
                            <td className={`${cellPad} pr-3 text-right font-black text-slate-950 dark:text-white`}>
                              {entry.debitCents > 0 ? money.format(entry.debitCents / 100) : <span className="font-normal text-slate-300 dark:text-slate-700">—</span>}
                            </td>
                            <td className={`${cellPad} pr-3 text-right font-black text-emerald-700 dark:text-emerald-400`}>
                              {entry.creditCents > 0 ? money.format(entry.creditCents / 100) : <span className="font-normal text-slate-300 dark:text-slate-700">—</span>}
                            </td>
                            <td className={`${cellPad} pr-3 text-right font-black ${balanceClass(entry.balanceAfterCents)}`}>
                              {money.format(entry.balanceAfterCents / 100)}
                            </td>
                            <td className={`${cellPad} pr-3 text-center`}>
                              <button type="button"
                                onClick={() => onToggleCleared(entry)}
                                disabled={togglingId === entry.sourceId}
                                title={entry.cleared ? `Unclear this transaction${entry.clearedAt ? ` (cleared ${formatDate(entry.clearedAt)})` : ""}` : "Mark this transaction cleared"}
                                aria-label={`${entry.cleared ? "Unclear" : "Mark cleared"}: ${entry.description}`}
                                aria-pressed={entry.cleared}
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-md border text-sm font-black transition disabled:opacity-50 ${entry.cleared
                                  ? "border-emerald-500 bg-emerald-500 text-white"
                                  : "border-slate-300 bg-white text-transparent hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800"}`}>
                                ✓
                              </button>
                            </td>
                            <td className={`${cellPad} text-center`}>
                              {canEdit ? (
                                <span className="inline-flex items-center gap-1">
                                  <button type="button" onClick={() => startEdit(entry)}
                                    title={`Edit ${entry.description}`}
                                    aria-label={`Edit: ${entry.description}`}
                                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-black text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
                                    ✎
                                  </button>
                                  <button type="button" onClick={() => confirmDelete(entry)}
                                    title={`Delete ${entry.description}`}
                                    aria-label={`Delete: ${entry.description}`}
                                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-black text-red-700 hover:bg-red-50 dark:border-slate-600 dark:text-red-400 dark:hover:bg-red-950/40">
                                    🗑
                                  </button>
                                </span>
                              ) : (
                                <span className="text-xs text-slate-300 dark:text-slate-700" title="Imported transactions are read-only here">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>}
            </>
          )}
        </>
      )}

      {postKind && (
        <Modal title={postKind === "income" ? "Post Income" : "Post Expense"} onClose={() => setPostKind(null)} wide>
          <TransactionForm
            defaultKind={postKind}
            initialEvent={{ bankAccountId: effectiveAccountId }}
            submitLabel={postKind === "income" ? "Post income" : "Post expense"}
            onSaved={() => { setPostKind(null); refresh(); }}
            onCancel={() => setPostKind(null)}
          />
        </Modal>
      )}

      {transferOpen && (
        <Modal title="Transfer Funds" onClose={() => setTransferOpen(false)}>
          <FundTransferForm
            accounts={accounts}
            fromAccountId={effectiveAccountId}
            onSaved={() => { setTransferOpen(false); setNotice("Transfer saved — both legs posted."); refresh(); }}
            onCancel={() => setTransferOpen(false)}
          />
        </Modal>
      )}

      {editingEvent && (
        <Modal title="Edit transaction" onClose={() => setEditingEvent(null)} wide>
          {editingEvent.transfer_group_id && (
            <p className="mb-3 rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
              This is one leg of a fund transfer. The amount, direction, and account are locked —
              delete the transfer and re-create it to change them.
            </p>
          )}
          <TransactionForm
            initialEvent={editingEvent}
            submitLabel="Save changes"
            onSaved={() => { setEditingEvent(null); refresh(); }}
            onCancel={() => setEditingEvent(null)}
          />
        </Modal>
      )}
    </section>
  );
}
