"use client";
import { useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeLoadingState } from "@/components/forge/ForgeStates";
import BankReconciliationPanel from "./BankReconciliationPanel";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const label = (value) => String(value ?? "—").replaceAll("_", " ");
const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
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

// Full-page bank account ledger — the Rentec-style register: Date | Description |
// Check # | Debit | Credit | Balance | Cleared, with a running balance after every
// row. Expenses post to Debit, income to Credit. Each row carries a cleared
// toggle; Reconcile opens the full statement reconciliation
// (BankReconciliationPanel).
//
// Data layer: stale-while-revalidate per account. Switching back to a recently
// viewed account serves the cached register instantly and refreshes in the
// background.
export default function BankLedgerPage() {
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

  const { data, error, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    effectiveAccountId ? `bank-ledger:${effectiveAccountId}` : null,
    () => fetchBankLedger(effectiveAccountId),
    { ttlMs: 60_000 },
  );
  const ledger = data?.ledger || null;
  const account = data?.account || null;

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

  return (
    <section data-bank-ledger-page aria-label="Bank account ledger"
      className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Bank ledger</p>
          <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Account Register</h2>
          <p className="mt-2 max-w-xl text-sm text-slate-600 dark:text-slate-400">
            The Rentec-style register for one bank account: every cleared and uncleared transaction
            with a running balance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="bank-ledger-account" className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Account
          </label>
          <select id="bank-ledger-account" value={effectiveAccountId || ""}
            onChange={(event) => { setSelectedAccountId(event.target.value || null); setShowReconcile(false); }}
            disabled={accountsLoading || accounts.length === 0}
            className="max-w-[260px] rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>{item.official_name || item.name}</option>
            ))}
          </select>
          <button type="button" onClick={() => setShowReconcile((value) => !value)}
            disabled={!ledger}
            className={`rounded-xl px-4 py-2.5 text-sm font-black transition ${goldControlClassName} disabled:opacity-50`}>
            Reconcile
          </button>
        </div>
      </div>

      {accountsError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{accountsError}</p>}
      {accountsLoading && <ForgeLoadingState label="Loading accounts…" />}
      {!accountsLoading && !accountsError && accounts.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No active bank accounts yet. Connect an account or add one manually, then come back to the register.
        </p>
      )}

      {effectiveAccountId && (
        <>
          {toggleError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{toggleError}</p>}
          {isLoading && <ForgeLoadingState label="Loading register…" />}
          {isRefreshing && ledger && (
            <p className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p>
          )}
          {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

          {!isLoading && ledger && (
            <>
              <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-xl font-black text-slate-950 dark:text-white">
                  {account?.officialName || account?.name || ledger.accountName || "Register"}
                </h3>
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

              {ledger.entries.length === 0
                ? <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No transactions on this account yet.</p>
                : <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left text-sm" data-ledger-table>
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        <th className="py-2 pr-3 font-black">Date</th>
                        <th className="py-2 pr-3 font-black">Description</th>
                        <th className="py-2 pr-3 font-black">Check #</th>
                        <th className="py-2 pr-3 text-right font-black">Debit</th>
                        <th className="py-2 pr-3 text-right font-black">Credit</th>
                        <th className="py-2 pr-3 text-right font-black">Balance</th>
                        <th className="py-2 text-center font-black">Cleared</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.entries.map((entry) => (
                        <tr key={entry.id} data-ledger-entry={entry.status} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="py-2.5 pr-3 font-bold text-slate-700 dark:text-slate-300">{formatDate(entry.date)}</td>
                          <td className="py-2.5 pr-3">
                            <span className="font-bold text-slate-950 dark:text-white">{entry.description}</span>
                            <span className="block text-xs text-slate-500 dark:text-slate-400">
                              {[entry.payee ? `Payee: ${entry.payee}` : null, entry.category !== "—" ? label(entry.category) : null, entry.sourceSystem ? label(entry.sourceSystem) : null].filter(Boolean).join(" · ") || "—"}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 font-bold text-slate-700 dark:text-slate-300">{entry.checkNumber || "—"}</td>
                          <td className="py-2.5 pr-3 text-right font-black text-slate-950 dark:text-white">
                            {entry.debitCents > 0 ? money.format(entry.debitCents / 100) : <span className="font-normal text-slate-300 dark:text-slate-700">—</span>}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-black text-emerald-700 dark:text-emerald-400">
                            {entry.creditCents > 0 ? money.format(entry.creditCents / 100) : <span className="font-normal text-slate-300 dark:text-slate-700">—</span>}
                          </td>
                          <td className={`py-2.5 pr-3 text-right font-black ${balanceClass(entry.balanceAfterCents)}`}>
                            {money.format(entry.balanceAfterCents / 100)}
                          </td>
                          <td className="py-2.5 text-center">
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
            </>
          )}
        </>
      )}
    </section>
  );
}
