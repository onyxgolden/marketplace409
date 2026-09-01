"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const INVESTMENT_TYPE_LABELS = Object.freeze({
  taxable_brokerage: "Taxable brokerage", ira: "IRA", roth_ira: "Roth IRA", "401k": "401(k)", pension: "Pension",
  crypto_exchange: "Crypto exchange", crypto_wallet: "Crypto wallet", metals_vault: "Metals vault",
  private_investment: "Private investment", other: "Other",
});
const ASSET_CLASS_LABELS = Object.freeze({
  real_estate: "Real estate", vehicle: "Vehicle", equipment: "Equipment", trailer: "Trailer",
  collectible: "Collectible", crypto: "Crypto", other: "Other asset",
});

// Sub-groups within "Investments" and "Assets", modeled on Quicken Simplifi's account tree.
// Order controls both display order and which sub-group an account_type/asset_class falls into.
const INVESTMENT_SUBGROUPS = Object.freeze([
  Object.freeze({ key: "brokerage", label: "Brokerage", types: Object.freeze(["taxable_brokerage"]) }),
  Object.freeze({ key: "retirement", label: "Retirement", types: Object.freeze(["ira", "roth_ira", "401k", "pension"]) }),
  Object.freeze({ key: "other_investments", label: "Other Investments", types: Object.freeze(["crypto_exchange", "crypto_wallet", "metals_vault", "private_investment", "other"]) }),
]);
const ASSET_SUBGROUPS = Object.freeze([
  Object.freeze({ key: "real_estate", label: "Real Estate", classes: Object.freeze(["real_estate"]) }),
  Object.freeze({ key: "vehicles", label: "Vehicles", classes: Object.freeze(["vehicle"]) }),
  Object.freeze({ key: "other_assets", label: "Other Assets", classes: Object.freeze(["equipment", "trailer", "collectible", "crypto", "other"]) }),
]);

function accountBalanceCents(account) {
  return account.latestBalance ? Math.abs(account.latestBalance.currentBalanceCents) : 0;
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
    <div data-account-balance-row={account.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <p className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900 dark:text-slate-100" title={account.name}>
        {account.name}
      </p>

      {notEditable ? (
        <div className="text-right">
          <p className="text-xs font-black tabular-nums text-slate-900 dark:text-slate-100">
            {money.format(Math.abs(account.latestBalance.currentBalanceCents) / 100)}
          </p>
          <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
            Synced from {account.latestBalance.provider}
          </p>
        </div>
      ) : editing ? (
        <form onSubmit={save} className="flex w-full flex-wrap items-center gap-1.5 pt-1">
          <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400">
            <span className="sr-only">Balance</span>
            <input
              type="number" step="0.01" required value={dollars}
              onChange={(event) => setDollars(event.target.value)}
              placeholder="0.00"
              className="w-20 rounded-lg border border-slate-300 px-1.5 py-1 text-xs font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400">
            <span className="sr-only">As of</span>
            <input
              type="date" required value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
              className="w-[7.5rem] rounded-lg border border-slate-300 px-1.5 py-1 text-xs font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <button type="submit" disabled={saving} className={`rounded-full px-3 py-1 text-[10px] font-black disabled:opacity-60 ${goldControlClassName}`}>
            {saving ? "Saving…" : "Save"}
          </button>
          {error ? <span role="alert" className="w-full text-[10px] font-bold text-rose-700 dark:text-rose-400">{error}</span> : null}
        </form>
      ) : account.latestBalance ? (
        <div className="flex items-center gap-2">
          <p className="text-xs font-black tabular-nums text-slate-900 dark:text-slate-100">
            {money.format(Math.abs(account.latestBalance.currentBalanceCents) / 100)}
          </p>
          <button type="button" onClick={() => setEditing(true)} className="text-[10px] font-black text-sky-700 hover:underline dark:text-sky-400">
            Edit
          </button>
        </div>
      ) : null}
    </div>
  );
}

const ADD_ACCOUNT_TYPE_OPTIONS = Object.freeze({
  banking: Object.freeze([{ value: "depository", label: "Bank account" }]),
  liabilities: Object.freeze([{ value: "credit", label: "Credit card" }, { value: "loan", label: "Loan" }]),
});

// Plain bank/credit/loan accounts (Banking, Liabilities) can be created directly here; Assets and
// Investments keep using their own tabs' dedicated create forms.
function AddAccountRow({ groupKey, onCreated }) {
  const typeOptions = ADD_ACCOUNT_TYPE_OPTIONS[groupKey];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState(typeOptions[0].value);
  const [dollars, setDollars] = useState("");
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const cents = Math.round(Number(dollars) * 100);
      if (!Number.isFinite(cents) || cents < 0) throw new Error("Enter a valid, non-negative balance.");
      const response = await fetch("/api/financial/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, type, currentBalanceCents: cents, asOf }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Unable to save (${response.status}).`);
      await onCreated();
      setName(""); setDollars(""); setOpen(false);
    } catch (thrown) {
      setError(thrown.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button" onClick={() => setOpen(true)}
        className="mt-1 w-full rounded-lg px-1.5 py-1.5 text-left text-[11px] font-black text-sky-700 hover:bg-slate-50 dark:text-sky-400 dark:hover:bg-slate-800/40"
      >
        + Add account
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-1 space-y-1.5 rounded-lg border border-dashed border-slate-300 p-2 dark:border-slate-600">
      <input
        required value={name} onChange={(event) => setName(event.target.value)} placeholder="Account name"
        className="w-full rounded-lg border border-slate-300 px-1.5 py-1 text-xs font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
      />
      {typeOptions.length > 1 && (
        <select
          value={type} onChange={(event) => setType(event.target.value)}
          className="w-full rounded-lg border border-slate-300 px-1.5 py-1 text-xs font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          {typeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
      <div className="flex gap-1.5">
        <input
          type="number" step="0.01" required value={dollars} onChange={(event) => setDollars(event.target.value)} placeholder="0.00"
          className="w-20 rounded-lg border border-slate-300 px-1.5 py-1 text-xs font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        />
        <input
          type="date" required value={asOf} onChange={(event) => setAsOf(event.target.value)}
          className="w-[7.5rem] rounded-lg border border-slate-300 px-1.5 py-1 text-xs font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        />
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={`rounded-full px-3 py-1 text-[10px] font-black disabled:opacity-60 ${goldControlClassName}`}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-[10px] font-black text-slate-500 hover:underline dark:text-slate-400">
          Cancel
        </button>
      </div>
      {error ? <p role="alert" className="text-[10px] font-bold text-rose-700 dark:text-rose-400">{error}</p> : null}
    </form>
  );
}

// A read-only leaf for Assets/Investments-registry items: those have their own dedicated
// create/edit forms on the Assets and Investments tabs, so this tree only displays them.
function ReadOnlyValueRow({ id, name, amountCents }) {
  return (
    <div data-account-balance-row={id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <p className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900 dark:text-slate-100" title={name}>
        {name}
      </p>
      <p className="text-xs font-black tabular-nums text-slate-900 dark:text-slate-100">{money.format(amountCents / 100)}</p>
    </div>
  );
}

function accountRowDescriptor(account, onSaved) {
  return {
    key: account.id,
    amountCents: accountBalanceCents(account),
    node: <BalanceRow key={account.id} account={account} onSaved={onSaved} />,
  };
}
function investmentAccountRowDescriptor(account) {
  const amountCents = account.latestValuation ? Number(account.latestValuation.amountCents) || 0 : 0;
  return {
    key: account.id,
    amountCents,
    node: <ReadOnlyValueRow key={account.id} id={account.id} name={account.name} amountCents={amountCents} />,
  };
}
function assetRowDescriptor(asset) {
  const amountCents = asset.latestValuation ? Number(asset.latestValuation.amountCents) || 0 : 0;
  return {
    key: asset.id,
    amountCents,
    node: <ReadOnlyValueRow key={asset.id} id={asset.id} name={asset.name} amountCents={amountCents} />,
  };
}

function subtotal(rows) {
  return rows.reduce((sum, row) => sum + row.amountCents, 0);
}

function buildTree({ accounts, investmentAccounts, assets }, onSaved) {
  // The investment-accounts registry's create/update RPCs mirror themselves into financial_accounts
  // (as type "investment") so Net Worth elsewhere in the app, which is computed from
  // financial_accounts alone, stays accurate. That mirrored row reuses the SAME id as the row
  // already showing under Investments below, so it must be excluded here or every investment
  // account would be counted -- and shown -- twice.
  const investmentAccountIds = new Set(investmentAccounts.map((account) => account.id));

  const banking = accounts.filter((account) => account.type === "depository").map((account) => accountRowDescriptor(account, onSaved));
  const linkedInvestments = accounts
    .filter((account) => account.type === "investment" && !investmentAccountIds.has(account.id))
    .map((account) => accountRowDescriptor(account, onSaved));
  const liabilities = accounts.filter((account) => account.type === "credit" || account.type === "loan").map((account) => accountRowDescriptor(account, onSaved));

  const investmentSubgroups = [];
  if (linkedInvestments.length > 0) investmentSubgroups.push({ key: "linked", label: "Linked Accounts", rows: linkedInvestments });
  for (const definition of INVESTMENT_SUBGROUPS) {
    const rows = investmentAccounts.filter((account) => definition.types.includes(account.accountType)).map(investmentAccountRowDescriptor);
    if (rows.length > 0) investmentSubgroups.push({ key: definition.key, label: definition.label, rows });
  }

  const assetSubgroups = [];
  for (const definition of ASSET_SUBGROUPS) {
    const rows = assets.filter((asset) => definition.classes.includes(asset.assetClass)).map(assetRowDescriptor);
    if (rows.length > 0) assetSubgroups.push({ key: definition.key, label: definition.label, rows });
  }

  const groups = [];
  if (banking.length > 0) groups.push({ key: "banking", label: "Banking", kind: "asset", rows: banking, subgroups: null });
  if (investmentSubgroups.length > 0) groups.push({ key: "investments", label: "Investments", kind: "asset", rows: null, subgroups: investmentSubgroups });
  if (assetSubgroups.length > 0) groups.push({ key: "assets", label: "Assets", kind: "asset", rows: null, subgroups: assetSubgroups });
  if (liabilities.length > 0) groups.push({ key: "liabilities", label: "Liabilities", kind: "liability", rows: liabilities, subgroups: null });
  return groups;
}

function SubGroup({ path, label, rows, isCollapsed, onToggle }) {
  const collapsed = isCollapsed(path);
  return (
    <div data-account-category={path} className="ml-2">
      <button
        type="button" onClick={() => onToggle(path)} aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronDown size={12} className={`shrink-0 text-slate-400 transition-transform dark:text-slate-500 ${collapsed ? "-rotate-90" : ""}`} />
          <span className="truncate text-[11px] font-black uppercase tracking-wide text-slate-600 dark:text-slate-300">{label}</span>
          <span className="shrink-0 text-[10px] font-bold text-slate-400 dark:text-slate-500">({rows.length})</span>
        </span>
        <span className="shrink-0 text-xs font-black tabular-nums text-slate-700 dark:text-slate-300">{money.format(subtotal(rows) / 100)}</span>
      </button>
      {!collapsed && <div className="divide-y divide-slate-100 pl-3 dark:divide-slate-800">{rows.map((row) => row.node)}</div>}
    </div>
  );
}

function Group({ group, isCollapsed, onToggle, onSaved }) {
  const collapsed = isCollapsed(group.key);
  const groupSubtotal = group.rows ? subtotal(group.rows) : group.subgroups.reduce((sum, sub) => sum + subtotal(sub.rows), 0);
  const itemCount = group.rows ? group.rows.length : group.subgroups.reduce((sum, sub) => sum + sub.rows.length, 0);

  return (
    <div data-account-category={group.key} className="border-b border-slate-100 py-1 last:border-b-0 dark:border-slate-800">
      <button
        type="button" onClick={() => onToggle(group.key)} aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-1.5 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <ChevronDown size={14} className={`shrink-0 text-slate-500 transition-transform dark:text-slate-400 ${collapsed ? "-rotate-90" : ""}`} />
          <span className="truncate text-sm font-black text-slate-900 dark:text-slate-100">{group.label}</span>
          <span className="shrink-0 text-[10px] font-bold text-slate-400 dark:text-slate-500">({itemCount})</span>
        </span>
        <span className={`shrink-0 text-sm font-black tabular-nums ${group.kind === "liability" ? "text-rose-700 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"}`}>
          {money.format(groupSubtotal / 100)}
        </span>
      </button>
      {!collapsed && (
        <div className="space-y-1 pl-1">
          {group.rows
            ? <div className="divide-y divide-slate-100 pl-3 dark:divide-slate-800">{group.rows.map((row) => row.node)}</div>
            : group.subgroups.map((sub) => (
              <SubGroup key={sub.key} path={`${group.key}.${sub.key}`} label={sub.label} rows={sub.rows} isCollapsed={isCollapsed} onToggle={onToggle} />
            ))}
          {ADD_ACCOUNT_TYPE_OPTIONS[group.key] ? <div className="pl-3"><AddAccountRow groupKey={group.key} onCreated={onSaved} /></div> : null}
        </div>
      )}
    </div>
  );
}

async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error || `Unable to load ${url}.`);
  return body;
}

export default function FinancialAccountBalancesPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [collapsedKeys, setCollapsedKeys] = useState(() => new Set());

  const load = useCallback(async () => {
    try {
      const [accountBalances, assets, investmentAccounts] = await Promise.all([
        fetchJson("/api/financial/account-balances"),
        fetchJson("/api/financial/assets"),
        fetchJson("/api/financial/investment-accounts"),
      ]);
      setData({
        accounts: accountBalances.accounts || [],
        assets: assets.assets || [],
        investmentAccounts: investmentAccounts.accounts || [],
      });
    } catch (thrown) {
      setError(thrown.message);
    }
  }, []);

  useEffect(() => {
    // The initial request intentionally drives this panel's local loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const groups = useMemo(() => (data ? buildTree(data, load) : []), [data, load]);

  const netWorthCents = useMemo(() => groups.reduce(
    (sum, group) => sum + (group.kind === "liability" ? -1 : 1) * (group.rows ? subtotal(group.rows) : group.subgroups.reduce((s, sub) => s + subtotal(sub.rows), 0)),
    0,
  ), [groups]);

  function isCollapsed(path) { return collapsedKeys.has(path); }
  function toggle(path) {
    setCollapsedKeys((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  if (error) return <p role="alert" className="rounded-2xl bg-red-50 p-4 text-red-800 dark:bg-red-950/30 dark:text-red-300">{error}</p>;
  if (!data) return null;
  if (groups.length === 0) return null;

  return (
    <section data-financial-account-balances className="max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <h3 className="px-1.5 text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Accounts</h3>
      <div className="flex items-center justify-between px-1.5 py-2">
        <span className="text-sm font-black text-slate-900 dark:text-white">Net Worth</span>
        <span data-net-worth className="text-sm font-black tabular-nums text-slate-950 dark:text-white">{money.format(netWorthCents / 100)}</span>
      </div>

      <div>
        {groups.map((group) => (
          <Group key={group.key} group={group} isCollapsed={isCollapsed} onToggle={toggle} onSaved={load} />
        ))}
      </div>
    </section>
  );
}
