"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { ForgeLoadingState } from "@/components/forge/ForgeStates";
import { MANUAL_FINANCIAL_EVENT_CATEGORIES } from "@/application/financial/manualFinancialEventCategories";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fallbackAccounts = MANUAL_FINANCIAL_EVENT_CATEGORIES.map((entry) => ({
  id: `fallback-${entry.value}`,
  code: entry.value,
  label: entry.label,
  account_type: ["rental_income", "cam_income"].includes(entry.value) ? "income" : "expense",
  is_active: true,
  is_system: true,
  usage_count: 0,
}));

const inputClass = "mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100";
const labelClass = "block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400";

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

async function fetchChart() {
  const body = await readJson(await fetch("/api/rental/chart-of-accounts"));
  return body.accounts || [];
}

async function fetchBankAccounts() {
  const body = await readJson(await fetch("/api/rental/bank-accounts"));
  return body.accounts || [];
}

async function fetchAccountTransactions(code) {
  const body = await readJson(await fetch(`/api/rental/chart-of-accounts?transactionsFor=${encodeURIComponent(code)}`));
  return body.transactions || [];
}

function AccountRow({ account, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(account)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-left hover:border-amber-400 dark:hover:border-amber-500"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold text-slate-900 dark:text-slate-100">{account.label}</span>
        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
          {account.code}{account.is_system ? " · built-in" : ""}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {!account.is_active && (
          <span className="rounded-full bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-black uppercase text-slate-600 dark:text-slate-300">Inactive</span>
        )}
        <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
          {account.usage_count} {account.usage_count === 1 ? "posting" : "postings"}
        </span>
      </span>
    </button>
  );
}

// Chart of Accounts: every income/expense account grouped by type, plus the
// owner's bank accounts. Clicking an account shows its postings; accounts link
// back out to the bank ledger. Add / rename / deactivate (two-step) included;
// deactivation is blocked while postings exist.
export default function ChartOfAccountsPage({ onNavigate }) {
  const [accounts, setAccounts] = useState(null);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [error, setError] = useState("");
  const [openAccount, setOpenAccount] = useState(null);
  const [drawerRows, setDrawerRows] = useState(null);
  const [drawerError, setDrawerError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ code: "", label: "", account_type: "expense" });
  const [addError, setAddError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState("");
  const [confirmDeactivate, setConfirmDeactivate] = useState(null);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      setAccounts(await fetchChart());
    } catch (loadError) {
      // Fall back to the built-in list so the page still works offline-ish.
      setAccounts(fallbackAccounts);
      setError(loadError.message);
    }
    try {
      setBankAccounts(await fetchBankAccounts());
    } catch {
      setBankAccounts([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchChart()
      .then((chart) => { if (!cancelled) { setError(""); setAccounts(chart); } })
      .catch((loadError) => { if (!cancelled) { setAccounts(fallbackAccounts); setError(loadError.message); } });
    fetchBankAccounts()
      .then((banks) => { if (!cancelled) setBankAccounts(banks); })
      .catch(() => { if (!cancelled) setBankAccounts([]); });
    return () => { cancelled = true; };
  }, []);

  const groups = useMemo(() => {
    const list = accounts || [];
    return {
      income: list.filter((a) => a.account_type === "income"),
      expense: list.filter((a) => a.account_type === "expense"),
    };
  }, [accounts]);

  const openDrawer = async (account) => {
    setOpenAccount(account);
    setDrawerRows(null);
    setDrawerError("");
    if (String(account.id).startsWith("fallback-")) {
      setDrawerRows([]);
      return;
    }
    try {
      setDrawerRows(await fetchAccountTransactions(account.code));
    } catch (drawerLoadError) {
      setDrawerError(drawerLoadError.message);
    }
  };

  const refresh = async () => {
    await load();
    if (openAccount && !String(openAccount.id).startsWith("fallback-")) {
      try {
        setDrawerRows(await fetchAccountTransactions(openAccount.code));
      } catch { /* keep the old rows */ }
    }
  };

  const submitAdd = async (event) => {
    event.preventDefault();
    setAddError("");
    try {
      await readJson(await fetch("/api/rental/chart-of-accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(addForm),
      }));
      setAddForm({ code: "", label: "", account_type: "expense" });
      setShowAdd(false);
      await refresh();
    } catch (addAccountError) {
      setAddError(addAccountError.message);
    }
  };

  const submitRename = async (account) => {
    setActionError("");
    try {
      await readJson(await fetch("/api/rental/chart-of-accounts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: account.id, label: editLabel }),
      }));
      setEditingId(null);
      await refresh();
    } catch (renameError) {
      setActionError(renameError.message);
    }
  };

  const deactivate = async (account) => {
    setActionError("");
    try {
      const body = await readJson(await fetch("/api/rental/chart-of-accounts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: account.id, is_active: false }),
      }));
      setConfirmDeactivate(null);
      setOpenAccount(body.account);
      await refresh();
    } catch (deactivateError) {
      setActionError(deactivateError.message);
      setConfirmDeactivate(null);
    }
  };

  const reactivate = async (account) => {
    setActionError("");
    try {
      await readJson(await fetch("/api/rental/chart-of-accounts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: account.id, is_active: true }),
      }));
      await refresh();
    } catch (reactivateError) {
      setActionError(reactivateError.message);
    }
  };

  if (accounts === null) return <ForgeLoadingState label="Loading chart of accounts" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-100">Chart of Accounts</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Every category your ledgers post to. Click an account to see its postings.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => onNavigate && onNavigate("bank-ledger")} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm font-bold text-slate-700 dark:text-slate-200">
            Bank Ledger
          </button>
          <button type="button" onClick={() => setShowAdd((v) => !v)} className={goldControlClassName}>
            Add account
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">Showing built-in accounts — {error}</p>}
      {actionError && <p className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-4 py-2 text-sm text-red-700 dark:text-red-300">{actionError}</p>}

      {showAdd && (
        <form onSubmit={submitAdd} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <h2 className="text-sm font-black text-slate-900 dark:text-slate-100">Add account</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className={labelClass}>Code
              <input value={addForm.code} onChange={(e) => setAddForm({ ...addForm, code: e.target.value })} className={inputClass} placeholder="landscaping" />
            </label>
            <label className={labelClass}>Label
              <input value={addForm.label} onChange={(e) => setAddForm({ ...addForm, label: e.target.value })} className={inputClass} placeholder="Landscaping" />
            </label>
            <label className={labelClass}>Type
              <select value={addForm.account_type} onChange={(e) => setAddForm({ ...addForm, account_type: e.target.value })} className={inputClass}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </label>
          </div>
          {addError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{addError}</p>}
          <div className="mt-3 flex gap-2">
            <button type="submit" className={goldControlClassName}>Save account</button>
            <button type="button" onClick={() => setShowAdd(false)} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm font-bold">Cancel</button>
          </div>
        </form>
      )}

      {[["Income", groups.income], ["Expenses", groups.expense]].map(([title, list]) => (
        <section key={title}>
          <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{title} ({list.length})</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {list.map((account) => <AccountRow key={account.id} account={account} onOpen={openDrawer} />)}
          </div>
        </section>
      ))}

      {bankAccounts.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Bank accounts ({bankAccounts.length})</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {bankAccounts.map((bank) => (
              <button
                key={bank.id}
                type="button"
                onClick={() => onNavigate && onNavigate("bank-ledger")}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-left hover:border-amber-400 dark:hover:border-amber-500"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-slate-900 dark:text-slate-100">{bank.name}</span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{bank.official_name || bank.type}</span>
                </span>
                <span className="shrink-0 text-xs font-black text-amber-700 dark:text-amber-400 underline">Open ledger</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {openAccount && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6" onClick={() => setOpenAccount(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">{openAccount.label}</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">{openAccount.code} · {openAccount.account_type}{openAccount.is_system ? " · built-in" : ""}{!openAccount.is_active ? " · inactive" : ""}</p>
              </div>
              <button type="button" onClick={() => setOpenAccount(null)} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1 text-sm font-bold">Close</button>
            </div>

            {!String(openAccount.id).startsWith("fallback-") && (
              <div className="mt-3 flex flex-wrap gap-2">
                {editingId === openAccount.id ? (
                  <span className="flex gap-2">
                    <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1 text-sm" aria-label="Account label" />
                    <button type="button" onClick={() => submitRename(openAccount)} className={goldControlClassName}>Save</button>
                    <button type="button" onClick={() => setEditingId(null)} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1 text-sm font-bold">Cancel</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => { setEditingId(openAccount.id); setEditLabel(openAccount.label); }} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1 text-sm font-bold">Rename</button>
                )}
                {openAccount.is_active ? (
                  confirmDeactivate === openAccount.id ? (
                    <span className="flex items-center gap-2 text-sm">
                      <span className="font-bold text-red-700 dark:text-red-400">Deactivate this account?</span>
                      <button type="button" onClick={() => deactivate(openAccount)} className="rounded-lg bg-red-600 px-3 py-1 text-sm font-bold text-white">Yes, deactivate</button>
                      <button type="button" onClick={() => setConfirmDeactivate(null)} className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1 text-sm font-bold">Cancel</button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirmDeactivate(openAccount.id)} className="rounded-lg border border-red-300 dark:border-red-700 px-3 py-1 text-sm font-bold text-red-700 dark:text-red-400">Deactivate</button>
                  )
                ) : (
                  <button type="button" onClick={() => reactivate(openAccount)} className="rounded-lg border border-emerald-300 dark:border-emerald-700 px-3 py-1 text-sm font-bold text-emerald-700 dark:text-emerald-400">Reactivate</button>
                )}
              </div>
            )}

            <h3 className="mt-4 text-sm font-black text-slate-900 dark:text-slate-100">Postings ({drawerRows === null ? "…" : drawerRows.length})</h3>
            {drawerError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{drawerError}</p>}
            {drawerRows !== null && drawerRows.length === 0 && (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No transactions post to this account yet.</p>
            )}
            {drawerRows !== null && drawerRows.length > 0 && (
              <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-700">
                {drawerRows.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-slate-900 dark:text-slate-100">{row.description}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{row.event_date} · {row.transaction_kind}</span>
                    </span>
                    <span className="shrink-0 text-sm font-black text-slate-900 dark:text-slate-100">{money.format(Number(row.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
