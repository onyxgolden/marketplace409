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

function typeLabel(type) {
  if (type === "depository") return "Bank account";
  if (type === "investment") return "Investment";
  if (type === "credit") return "Credit card";
  if (type === "loan") return "Loan";
  return type;
}

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

// A read-only leaf for Assets/Investments-registry items: those have their own dedicated
// create/edit forms on the Assets and Investments tabs, so this tree only displays them.
function ReadOnlyValueRow({ id, name, subtitle, amountCents, asOf }) {
  return (
    <div data-account-balance-row={id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div>
        <p className="font-bold text-slate-900 dark:text-slate-100">{name}</p>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      <div className="text-right">
        <p className="font-black tabular-nums text-slate-900 dark:text-slate-100">{money.format(amountCents / 100)}</p>
        {asOf ? <p className="text-xs font-bold text-slate-500 dark:text-slate-400">as of {asOf}</p> : null}
      </div>
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
    node: (
      <ReadOnlyValueRow
        key={account.id} id={account.id} name={account.name}
        subtitle={`${INVESTMENT_TYPE_LABELS[account.accountType] || account.accountType} · ${account.ownershipScope}`}
        amountCents={amountCents} asOf={account.latestValuation?.effectiveDate}
      />
    ),
  };
}
function assetRowDescriptor(asset) {
  const amountCents = asset.latestValuation ? Number(asset.latestValuation.amountCents) || 0 : 0;
  return {
    key: asset.id,
    amountCents,
    node: (
      <ReadOnlyValueRow
        key={asset.id} id={asset.id} name={asset.name}
        subtitle={`${ASSET_CLASS_LABELS[asset.assetClass] || asset.assetClass} · ${asset.ownershipScope}`}
        amountCents={amountCents} asOf={asset.latestValuation?.effectiveDate}
      />
    ),
  };
}

function subtotal(rows) {
  return rows.reduce((sum, row) => sum + row.amountCents, 0);
}

function buildTree({ accounts, investmentAccounts, assets }, onSaved) {
  const banking = accounts.filter((account) => account.type === "depository").map((account) => accountRowDescriptor(account, onSaved));
  const linkedInvestments = accounts.filter((account) => account.type === "investment").map((account) => accountRowDescriptor(account, onSaved));
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
    <div data-account-category={path} className="ml-3 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
      <button
        type="button" onClick={() => onToggle(path)} aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-3 bg-slate-50 px-3 py-2 text-left dark:bg-slate-800/40"
      >
        <span className="flex items-center gap-2">
          <ChevronDown size={14} className={`text-slate-500 transition-transform dark:text-slate-400 ${collapsed ? "-rotate-90" : ""}`} />
          <span className="text-sm font-black text-slate-800 dark:text-slate-200">{label}</span>
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">({rows.length})</span>
        </span>
        <span className="text-sm font-black tabular-nums text-slate-800 dark:text-slate-200">{money.format(subtotal(rows) / 100)}</span>
      </button>
      {!collapsed && <div className="space-y-2 p-2">{rows.map((row) => row.node)}</div>}
    </div>
  );
}

function Group({ group, isCollapsed, onToggle }) {
  const collapsed = isCollapsed(group.key);
  const groupSubtotal = group.rows ? subtotal(group.rows) : group.subgroups.reduce((sum, sub) => sum + subtotal(sub.rows), 0);
  const itemCount = group.rows ? group.rows.length : group.subgroups.reduce((sum, sub) => sum + sub.rows.length, 0);

  return (
    <div data-account-category={group.key} className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
      <button
        type="button" onClick={() => onToggle(group.key)} aria-expanded={!collapsed}
        className="flex w-full items-center justify-between gap-3 bg-slate-50 px-4 py-3 text-left dark:bg-slate-800/60"
      >
        <span className="flex items-center gap-2">
          <ChevronDown size={16} className={`text-slate-500 transition-transform dark:text-slate-400 ${collapsed ? "-rotate-90" : ""}`} />
          <span className="font-black text-slate-900 dark:text-slate-100">{group.label}</span>
          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">({itemCount})</span>
        </span>
        <span className={`font-black tabular-nums ${group.kind === "liability" ? "text-rose-700 dark:text-rose-400" : "text-slate-900 dark:text-slate-100"}`}>
          {money.format(groupSubtotal / 100)}
        </span>
      </button>
      {!collapsed && (
        <div className="space-y-2 p-3">
          {group.rows
            ? group.rows.map((row) => row.node)
            : group.subgroups.map((sub) => (
              <SubGroup key={sub.key} path={`${group.key}.${sub.key}`} label={sub.label} rows={sub.rows} isCollapsed={isCollapsed} onToggle={onToggle} />
            ))}
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

  useEffect(() => { load(); }, [load]);

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
    <section data-financial-account-balances className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-950 dark:text-white">Account balances</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Banking, Investments, Assets, and Liabilities — enter a balance to get started. Once a bank connection is
            linked, that account's balance stays synced automatically and can't be edited here. Assets and Investment
            accounts are managed on their own tabs; this view rolls them up alongside everything else.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Net worth</p>
          <p data-net-worth className="text-xl font-black tabular-nums text-slate-950 dark:text-white">{money.format(netWorthCents / 100)}</p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {groups.map((group) => (
          <Group key={group.key} group={group} isCollapsed={isCollapsed} onToggle={toggle} />
        ))}
      </div>
    </section>
  );
}
