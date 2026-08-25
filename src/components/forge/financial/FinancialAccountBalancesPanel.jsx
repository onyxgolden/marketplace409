"use client";
import { useCallback, useEffect, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function typeLabel(type) {
  if (type === "depository") return "Bank account";
  if (type === "investment") return "Investment";
  if (type === "credit") return "Credit card";
  if (type === "loan") return "Loan";
  return type;
}

function BalanceRow({ account, onSaved }) {
  const [editing, setEditing] = useState(!account.latestBalance);
  const [dollars, setDollars] = useState(
    account.latestBalance ? String(Math.abs(account.latestBalance.currentBalanceCents) / 100) : "",
  );
  const [asOf, setAsOf] = useState(account.latestBalance?.asOf?.slice(0, 10) || new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = useCallback(async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const cents = Math.round(Number(dollars) * 100);
      if (!Number.isFinite(cents)) throw new Error("Enter a valid balance.");
      const response = await fetch("/api/financial/account-balances", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ financialAccountId: account.id, currentBalanceCents: cents, asOf }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Unable to save (${response.status}).`);
      // Wait for the parent's refetch to land new props (a populated latestBalance) before
      // leaving edit mode — flipping editing off first renders this row's read-only branch
      // against the still-stale (null) latestBalance for one tick and crashes.
      await onSaved();
      setEditing(false);
    } catch (thrown) {
      setError(thrown.message);
    } finally {
      setSaving(false);
    }
  }, [account.id, asOf, dollars, onSaved]);

  const notEditable = account.latestBalance && !account.latestBalance.editable;

  return (
    <div data-account-balance-row={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div>
        <p className="font-bold text-slate-900 dark:text-slate-100">{account.name}</p>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {typeLabel(account.type)} · {account.kind === "asset" ? "Asset" : "Liability"}
        </p>
      </div>

      {notEditable ? (
        <div className="text-right">
          <p className="font-black tabular-nums text-slate-900 dark:text-slate-100">
            {money.format(Math.abs(account.latestBalance.currentBalanceCents) / 100)}
          </p>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
            Synced from {account.latestBalance.provider} · as of {account.latestBalance.asOf?.slice(0, 10)}
          </p>
        </div>
      ) : editing ? (
        <form onSubmit={save} className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-bold text-slate-600 dark:text-slate-400">
            <span className="sr-only">Balance</span>
            <input
              type="number" step="0.01" required value={dollars}
              onChange={(event) => setDollars(event.target.value)}
              placeholder="0.00"
              className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <label className="text-xs font-bold text-slate-600 dark:text-slate-400">
            <span className="sr-only">As of</span>
            <input
              type="date" required value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <button type="submit" disabled={saving} className={`rounded-full px-4 py-1.5 text-xs font-black disabled:opacity-60 ${goldControlClassName}`}>
            {saving ? "Saving…" : "Save"}
          </button>
          {error ? <span role="alert" className="w-full text-xs font-bold text-rose-700 dark:text-rose-400">{error}</span> : null}
        </form>
      ) : account.latestBalance ? (
        <div className="flex items-center gap-3">
          <p className="font-black tabular-nums text-slate-900 dark:text-slate-100">
            {money.format(Math.abs(account.latestBalance.currentBalanceCents) / 100)}
          </p>
          <button type="button" onClick={() => setEditing(true)} className="text-xs font-black text-sky-700 hover:underline dark:text-sky-400">
            Update
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function FinancialAccountBalancesPanel() {
  const [accounts, setAccounts] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/financial/account-balances");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setAccounts(body.accounts);
    } catch (thrown) {
      setError(thrown.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <p role="alert" className="rounded-2xl bg-red-50 p-4 text-red-800 dark:bg-red-950/30 dark:text-red-300">{error}</p>;
  if (!accounts) return null;
  if (accounts.length === 0) return null;

  return (
    <section data-financial-account-balances className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <h3 className="text-lg font-black text-slate-950 dark:text-white">Account balances</h3>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Net Worth and Cash above are built from these balances. Enter a balance to get started — once a bank connection is linked, that account's balance stays synced automatically and can't be edited here.
      </p>
      <div className="mt-4 space-y-2">
        {accounts.map((account) => (
          <BalanceRow key={account.id} account={account} onSaved={load} />
        ))}
      </div>
    </section>
  );
}
