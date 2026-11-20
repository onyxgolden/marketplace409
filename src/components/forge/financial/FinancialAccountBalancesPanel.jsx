"use client";
import { useCallback, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Raw provider values (e.g. "stripe_financial_connections") are long enough that "Synced from
// <raw value>" squeezes the account name's own truncated space down to almost nothing in this
// panel's narrow sidebar column. Short, human-readable labels fix that; any provider not listed
// here still degrades gracefully via humanizeProvider() rather than showing nothing.
const PROVIDER_LABELS = Object.freeze({
  stripe_financial_connections: "Stripe", plaid: "Plaid",
});
function humanizeProvider(provider) {
  if (PROVIDER_LABELS[provider]) return PROVIDER_LABELS[provider];
  return String(provider || "")
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ") || "sync";
}

const INVESTMENT_TYPE_LABELS = Object.freeze({
  taxable_brokerage: "Taxable brokerage", ira: "IRA", roth_ira: "Roth IRA", "401k": "401(k)", pension: "Pension",
  crypto_exchange: "Crypto exchange", crypto_wallet: "Crypto wallet", metals_vault: "Metals vault",
  private_investment: "Private investment", other: "Other",
});
const ASSET_CLASS_LABELS = Object.freeze({
  real_estate: "Real estate", vehicle: "Vehicle", equipment: "Equipment", trailer: "Trailer",
  collectible: "Collectible", crypto: "Crypto", other: "Other asset",
});
const OWNERSHIP_SCOPE_OPTIONS = Object.freeze([
  { value: "business", label: "Business" },
  { value: "personal", label: "Personal" },
  { value: "mixed", label: "Mixed" },
]);

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

function isLiabilityAccount(account) {
  // kind comes from the route; fall back to type so older payloads/fixtures
  // without kind still classify credit/loan rows as liabilities.
  return account.kind === "liability" || account.type === "credit" || account.type === "loan";
}

// The position model sums assets signed and liabilities absolute (see
// NetWorthService: a stored negative mortgage balance is still a debt owed).
// The panel must use the same rule or its totals drift from the KPI: a negative
// asset balance (e.g. a type-"other" row at -$802.35) stays negative, and a
// liability balance is always shown and summed as the debt owed.
function displayBalanceCents(account) {
  if (!account.latestBalance) return 0;
  return isLiabilityAccount(account)
    ? Math.abs(account.latestBalance.currentBalanceCents)
    : account.latestBalance.currentBalanceCents;
}

function accountBalanceCents(account) {
  return displayBalanceCents(account);
}

function BalanceRow({ account, onSaved, onSelectAccount, isSelected }) {
  const [editing, setEditing] = useState(!account.latestBalance);
  // A negative manual asset opens as a negative number so saving it back does
  // not flip its sign (the old Math.abs here turned -$802.35 into +$802.35 on
  // save). Liabilities open as the absolute debt owed.
  const [dollars, setDollars] = useState(
    account.latestBalance ? String(displayBalanceCents(account) / 100) : "",
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
    <div data-account-balance-row={account.id} data-account-selected={isSelected || undefined} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <button
        type="button"
        onClick={() => onSelectAccount?.(account.id, account.name)}
        title={`View activity for ${account.name}`}
        aria-label={`View activity for ${account.name}`}
        className={`inline-flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded px-1 text-left text-xs font-bold hover:underline ${
          isSelected ? "text-sky-700 dark:text-sky-400" : "text-slate-900 dark:text-slate-100"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{account.name}</span>
        <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 4l4 4-4 4" />
        </svg>
      </button>

      {notEditable ? (
        <div className="shrink-0 text-right">
          <p className="text-xs font-black tabular-nums text-slate-900 dark:text-slate-100">
            {money.format(displayBalanceCents(account) / 100)}
          </p>
          <p
            className="text-[10px] font-semibold text-slate-500 dark:text-slate-400"
            title={`Synced from ${account.latestBalance.provider}${account.latestBalance.asOf ? ` · as of ${account.latestBalance.asOf.slice(0, 10)}` : ""}`}
          >
            {account.sourceLabel === "last known / manual"
              ? "Last known / manual"
              : account.sourceLabel === "stale"
                ? `Stale · Synced from ${humanizeProvider(account.latestBalance.provider)}`
                : `Synced from ${humanizeProvider(account.latestBalance.provider)}`}
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
        <div className="shrink-0 text-right">
          <div className="flex items-center justify-end gap-2">
            <p className="text-xs font-black tabular-nums text-slate-900 dark:text-slate-100">
              {money.format(displayBalanceCents(account) / 100)}
            </p>
            <button type="button" onClick={() => setEditing(true)} className="text-[10px] font-black text-sky-700 hover:underline dark:text-sky-400">
              Edit
            </button>
          </div>
          {account.sourceLabel === "last known / manual" || account.sourceLabel === "stale" ? (
            <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              {account.sourceLabel === "last known / manual" ? "Last known / manual" : "Stale"}
            </p>
          ) : null}
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

// A read-only leaf for Investments-registry items: that table has its own dedicated create/edit
// form on the Investments tab, so this tree only displays it. Assets get EditableAssetRow instead
// (below) -- the same quick add/edit convenience Banking/Liabilities already have via AddAccountRow.
function ReadOnlyValueRow({ id, name, amountCents, onSelectAccount, isSelected }) {
  return (
    <button
      type="button"
      data-account-balance-row={id}
      data-account-selected={isSelected || undefined}
      onClick={() => onSelectAccount?.(id, name)}
      title={`View activity for ${name}`}
      aria-label={`View activity for ${name}`}
      className={`flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 rounded px-1 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
        isSelected ? "bg-sky-50 dark:bg-sky-950/30" : ""
      }`}
    >
      <p className={`inline-flex min-w-0 flex-1 items-center gap-1 truncate text-xs font-bold ${isSelected ? "text-sky-700 dark:text-sky-400" : "text-slate-900 dark:text-slate-100"}`} title={name}>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 4l4 4-4 4" />
        </svg>
      </p>
      <p className="text-xs font-black tabular-nums text-slate-900 dark:text-slate-100">{money.format(amountCents / 100)}</p>
    </button>
  );
}

// Quick value-only update for an existing asset. PATCH /api/financial/assets requires the full
// record (name/class/scope, not just the value), so those are resubmitted unchanged from `asset`
// -- the owner only edits the value and its as-of date here; a rename or class change still goes
// through the Assets tab's full edit form.
function EditableAssetRow({ asset, onSaved }) {
  const [editing, setEditing] = useState(false);
  const amountCents = asset.latestValuation ? Number(asset.latestValuation.amountCents) || 0 : 0;
  const [dollars, setDollars] = useState(String(amountCents / 100));
  const [valueDate, setValueDate] = useState(asset.latestValuation?.effectiveDate?.slice(0, 10) || new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const cents = Math.round(Number(dollars) * 100);
      if (!Number.isFinite(cents) || cents < 0) throw new Error("Enter a valid, non-negative value.");
      const response = await fetch("/api/financial/assets", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetId: asset.id, name: asset.name, assetClass: asset.assetClass, ownershipScope: asset.ownershipScope,
          valueCents: cents, valueDate,
          purchaseCostCents: asset.purchaseCostCents ?? null, purchaseDate: asset.purchaseDate ?? null,
          linkedPropertyId: asset.linkedPropertyId ?? null, notes: asset.notes ?? null,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Unable to save (${response.status}).`);
      await onSaved();
      setEditing(false);
    } catch (thrown) {
      setError(thrown.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-account-balance-row={asset.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <p className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900 dark:text-slate-100" title={asset.name}>
        {asset.name}
      </p>

      {editing ? (
        <form onSubmit={save} className="flex w-full flex-wrap items-center gap-1.5 pt-1">
          <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400">
            <span className="sr-only">Value</span>
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
              type="date" required value={valueDate}
              onChange={(event) => setValueDate(event.target.value)}
              className="w-[7.5rem] rounded-lg border border-slate-300 px-1.5 py-1 text-xs font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </label>
          <button type="submit" disabled={saving} className={`rounded-full px-3 py-1 text-[10px] font-black disabled:opacity-60 ${goldControlClassName}`}>
            {saving ? "Saving…" : "Save"}
          </button>
          {error ? <span role="alert" className="w-full text-[10px] font-bold text-rose-700 dark:text-rose-400">{error}</span> : null}
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <p className="text-xs font-black tabular-nums text-slate-900 dark:text-slate-100">{money.format(amountCents / 100)}</p>
          <button type="button" onClick={() => setEditing(true)} className="text-[10px] font-black text-sky-700 hover:underline dark:text-sky-400">
            Edit
          </button>
        </div>
      )}
    </div>
  );
}

// Create a new asset directly from the sidebar, same "+ Add" convenience as Banking/Liabilities.
function AddAssetRow({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState("vehicle");
  const [ownershipScope, setOwnershipScope] = useState("business");
  const [dollars, setDollars] = useState("");
  const [valueDate, setValueDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const cents = Math.round(Number(dollars) * 100);
      if (!Number.isFinite(cents) || cents < 0) throw new Error("Enter a valid, non-negative value.");
      const response = await fetch("/api/financial/assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, assetClass, ownershipScope, valueCents: cents, valueDate, purchaseCostCents: null }),
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
        + Add asset
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-1 space-y-1.5 rounded-lg border border-dashed border-slate-300 p-2 dark:border-slate-600">
      <input
        required value={name} onChange={(event) => setName(event.target.value)} placeholder="Asset name"
        className="w-full rounded-lg border border-slate-300 px-1.5 py-1 text-xs font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
      />
      <div className="flex gap-1.5">
        <select
          value={assetClass} onChange={(event) => setAssetClass(event.target.value)}
          className="flex-1 rounded-lg border border-slate-300 px-1.5 py-1 text-xs font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          {Object.entries(ASSET_CLASS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select
          value={ownershipScope} onChange={(event) => setOwnershipScope(event.target.value)}
          className="flex-1 rounded-lg border border-slate-300 px-1.5 py-1 text-xs font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        >
          {OWNERSHIP_SCOPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <div className="flex gap-1.5">
        <input
          type="number" step="0.01" required value={dollars} onChange={(event) => setDollars(event.target.value)} placeholder="0.00"
          className="w-20 rounded-lg border border-slate-300 px-1.5 py-1 text-xs font-bold text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        />
        <input
          type="date" required value={valueDate} onChange={(event) => setValueDate(event.target.value)}
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

const EXCLUDED_REASON_LABELS = Object.freeze({
  duplicate: "Duplicate — already counted once",
  missing: "Missing balance — not counted",
  "no-mirror": "No linked account — not counted",
});

// A row the position excludes from net worth, shown with its real value and a
// plain-words reason -- never silently dropped, never counted as zero.
function ExcludedRow({ reason, children }) {
  return (
    <div>
      <p className="px-1 pt-1 text-[10px] font-bold text-slate-500 dark:text-slate-400">
        {EXCLUDED_REASON_LABELS[reason] || "Not counted"}
      </p>
      {children}
    </div>
  );
}

function accountRowDescriptor(account, onSaved, onSelectAccount, selectedAccountId) {
  return {
    key: account.id,
    amountCents: accountBalanceCents(account),
    node: <BalanceRow key={account.id} account={account} onSaved={onSaved} onSelectAccount={onSelectAccount} isSelected={account.id === selectedAccountId} />,
  };
}
function investmentAccountRowDescriptor(account, contributionCents, displayCents, divergence, onSelectAccount, selectedAccountId) {
  const row = <ReadOnlyValueRow key={account.id} id={account.id} name={account.name} amountCents={displayCents} onSelectAccount={onSelectAccount} isSelected={account.id === selectedAccountId} />;
  return {
    key: account.id,
    amountCents: contributionCents,
    node: divergence ? (
      <div key={account.id}>
        {row}
        <p className="px-1 text-[10px] font-bold text-amber-700 dark:text-amber-400">
          Registry value {money.format(displayCents / 100)} differs from linked account balance {money.format(divergence.mirrorCents / 100)} — counting the linked balance.
        </p>
      </div>
    ) : row,
  };
}
// Deliberately NOT click-to-view-activity like the rows above: assets track valuation history
// (financial_asset_valuations), not transaction activity -- financial_events never carries an
// asset's mirrored financial_accounts id (that mirror exists only so Net Worth stays accurate, not
// because assets generate ledger activity), so filtering the Financial Activity surface by an
// asset's id would always and correctly show zero transactions. Not a useful click.
function assetRowDescriptor(asset, contributionCents, displayCents, divergence, onSaved) {
  const row = <EditableAssetRow key={asset.id} asset={asset} onSaved={onSaved} />;
  return {
    key: asset.id,
    amountCents: contributionCents,
    node: divergence ? (
      <div key={asset.id}>
        {row}
        <p className="px-1 text-[10px] font-bold text-amber-700 dark:text-amber-400">
          Registry value {money.format(displayCents / 100)} differs from linked account balance {money.format(divergence.mirrorCents / 100)} — counting the linked balance.
        </p>
      </div>
    ) : row,
  };
}

function subtotal(rows) {
  return rows.reduce((sum, row) => sum + row.amountCents, 0);
}

function buildTree({ accounts, investmentAccounts, assets, position }, onSaved, onSelectAccount, selectedAccountId) {
  // The investment-accounts registry's create/update RPCs mirror themselves into financial_accounts
  // (as type "investment") so Net Worth elsewhere in the app, which is computed from
  // financial_accounts alone, stays accurate. That mirrored row reuses the SAME id as the row
  // already showing under Investments below, so it must be excluded here or every investment
  // account would be counted -- and shown -- twice.
  const investmentAccountIds = new Set(investmentAccounts.map((account) => account.id));
  const assetIds = new Set(assets.map((asset) => asset.id));

  // The route always sends includedInPosition plus the position's superseded /
  // missing disclosures. Payloads without them (older fixtures) render exactly as
  // before: everything included, no excluded section, registry rows at valuation.
  const hasPosition = position != null;
  const supersededIds = new Set((position?.supersededBalances || []).map((entry) => entry.id));
  const missingIds = new Set((position?.missingBalances || []).map((entry) => entry.id));
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  // Only an explicit false excludes: the position drops an account exactly when
  // it is a superseded group member or has no balance row at all.
  function isIncluded(account) {
    return account.includedInPosition !== false;
  }

  function exclusionReason(account) {
    if (!account.latestBalance) return "missing";
    if (supersededIds.has(account.id)) return "duplicate";
    if (missingIds.has(account.id)) return "missing";
    return "missing";
  }

  // A registry row's contribution is its mirror account's position verdict, not
  // its valuation alone: a superseded mirror must not re-enter through the
  // registry endpoint, and a mirror with no balance contributes nothing.
  function registryMirrorStatus(registryId) {
    if (!hasPosition) return { state: "contributing", mirror: null };
    const mirror = accountById.get(registryId);
    if (!mirror) return { state: "no-mirror", mirror: null };
    if (!isIncluded(mirror)) {
      return { state: supersededIds.has(registryId) ? "duplicate" : "missing", mirror };
    }
    return { state: "contributing", mirror };
  }

  function registryContribution(registry, mirrorStatus) {
    const valuationCents = registry.latestValuation ? Number(registry.latestValuation.amountCents) || 0 : 0;
    if (mirrorStatus.state !== "contributing") return { contributionCents: 0, displayCents: valuationCents, divergence: null };
    const mirrorCents = mirrorStatus.mirror?.latestBalance ? mirrorStatus.mirror.latestBalance.currentBalanceCents : null;
    // The position counts the mirror balance; the registry valuation is what the
    // row displays. They agree on all current data -- when they don't, the
    // mismatch is disclosed, never silently papered over.
    const divergence = mirrorCents !== null && mirrorCents !== valuationCents ? { mirrorCents, valuationCents } : null;
    return { contributionCents: mirrorCents ?? valuationCents, displayCents: valuationCents, divergence };
  }

  function excludedAccountRow(account) {
    return {
      key: account.id,
      amountCents: 0,
      node: (
        <ExcludedRow key={account.id} reason={exclusionReason(account)}>
          <BalanceRow account={account} onSaved={onSaved} onSelectAccount={onSelectAccount} isSelected={account.id === selectedAccountId} />
        </ExcludedRow>
      ),
    };
  }

  function excludedRegistryRow(registry, kind, reason, displayCents) {
    const row = kind === "investment"
      ? <ReadOnlyValueRow key={registry.id} id={registry.id} name={registry.name} amountCents={displayCents} onSelectAccount={onSelectAccount} isSelected={registry.id === selectedAccountId} />
      : <EditableAssetRow key={registry.id} asset={registry} onSaved={onSaved} />;
    return {
      key: registry.id,
      amountCents: 0,
      node: (
        <ExcludedRow key={registry.id} reason={reason}>
          {row}
        </ExcludedRow>
      ),
    };
  }

  const excluded = [];
  const banking = [];
  const linkedInvestments = [];
  const liabilities = [];
  const otherAccounts = [];
  for (const account of accounts) {
    if (!isIncluded(account)) {
      // A registry mirror's exclusion is carried by its registry row, not by a
      // second row for the mirror itself -- the mirror never had its own row.
      if (!investmentAccountIds.has(account.id) && !assetIds.has(account.id)) {
        excluded.push(excludedAccountRow(account));
      }
      continue;
    }
    if (account.type === "depository") banking.push(accountRowDescriptor(account, onSaved, onSelectAccount, selectedAccountId));
    else if (account.type === "investment" && !investmentAccountIds.has(account.id)) linkedInvestments.push(accountRowDescriptor(account, onSaved, onSelectAccount, selectedAccountId));
    else if (account.type === "credit" || account.type === "loan") liabilities.push(accountRowDescriptor(account, onSaved, onSelectAccount, selectedAccountId));
    else if (account.type === "other" && !assetIds.has(account.id)) otherAccounts.push(accountRowDescriptor(account, onSaved, onSelectAccount, selectedAccountId));
    // An included type-"other" mirror of an active asset is counted once through
    // its registry row below, never as a second row here.
  }

  const investmentSubgroups = [];
  if (linkedInvestments.length > 0) investmentSubgroups.push({ key: "linked", label: "Linked Accounts", rows: linkedInvestments });
  for (const definition of INVESTMENT_SUBGROUPS) {
    const rows = [];
    for (const account of investmentAccounts.filter((candidate) => definition.types.includes(candidate.accountType))) {
      const mirrorStatus = registryMirrorStatus(account.id);
      const { contributionCents, displayCents, divergence } = registryContribution(account, mirrorStatus);
      if (mirrorStatus.state === "contributing") {
        rows.push(investmentAccountRowDescriptor(account, contributionCents, displayCents, divergence, onSelectAccount, selectedAccountId));
      } else {
        excluded.push(excludedRegistryRow(account, "investment", mirrorStatus.state, displayCents));
      }
    }
    if (rows.length > 0) investmentSubgroups.push({ key: definition.key, label: definition.label, rows });
  }

  const assetSubgroups = [];
  for (const definition of ASSET_SUBGROUPS) {
    const rows = [];
    for (const asset of assets.filter((candidate) => definition.classes.includes(candidate.assetClass))) {
      const mirrorStatus = registryMirrorStatus(asset.id);
      const { contributionCents, displayCents, divergence } = registryContribution(asset, mirrorStatus);
      if (mirrorStatus.state === "contributing") {
        rows.push(assetRowDescriptor(asset, contributionCents, displayCents, divergence, onSaved));
      } else {
        excluded.push(excludedRegistryRow(asset, "asset", mirrorStatus.state, displayCents));
      }
    }
    if (rows.length > 0) assetSubgroups.push({ key: definition.key, label: definition.label, rows });
  }

  const groups = [];
  if (banking.length > 0) groups.push({ key: "banking", label: "Banking", kind: "asset", rows: banking, subgroups: null });
  if (investmentSubgroups.length > 0) groups.push({ key: "investments", label: "Investments", kind: "asset", rows: null, subgroups: investmentSubgroups });
  if (assetSubgroups.length > 0) groups.push({ key: "assets", label: "Assets", kind: "asset", rows: null, subgroups: assetSubgroups });
  if (otherAccounts.length > 0) groups.push({ key: "other", label: "Other Accounts", kind: "asset", rows: otherAccounts, subgroups: null });
  if (liabilities.length > 0) groups.push({ key: "liabilities", label: "Liabilities", kind: "liability", rows: liabilities, subgroups: null });
  if (excluded.length > 0) groups.push({ key: "excluded", label: "Not counted in net worth", kind: "excluded", rows: excluded, subgroups: null });
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
          {group.key === "assets" ? <div className="pl-3"><AddAssetRow onCreated={onSaved} /></div> : null}
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

// All three backing reads in one cached payload: banking balances, physical assets, and
// investment accounts. One SWR key so the whole account tree refreshes atomically.
async function fetchAccountBalanceTree() {
  const [accountBalances, assets, investmentAccounts] = await Promise.all([
    fetchJson("/api/financial/account-balances"),
    fetchJson("/api/financial/assets"),
    fetchJson("/api/financial/investment-accounts"),
  ]);
  return {
    accounts: accountBalances.accounts || [],
    assets: assets.assets || [],
    investmentAccounts: investmentAccounts.accounts || [],
    // The position projection (superseded/missing disclosures + the inclusion
    // verdict per account) travels with the accounts payload so the tree and
    // the KPI compare identical captured inputs.
    position: accountBalances.position || null,
  };
}

export default function FinancialAccountBalancesPanel({ onSelectAccount, selectedAccountId = null } = {}) {
  // Stale-while-revalidate: the cached tree renders instantly on return visits; a refresh
  // keeps the old rows on screen with only the subtle indicator below flipping.
  const { data, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    "financial:account-balances",
    fetchAccountBalanceTree,
    { ttlMs: 60_000 },
  );
  // Groups default to expanded so the panel never reads empty on first load;
  // the user's collapse choices apply within the session from there.
  const [collapsedKeys, setCollapsedKeys] = useState(() => new Set());

  const groups = useMemo(
    () => (data ? buildTree(data, refresh, onSelectAccount, selectedAccountId) : []),
    [data, refresh, onSelectAccount, selectedAccountId],
  );

  const netWorthCents = useMemo(() => groups.reduce(
    // Excluded rows contribute $0 by construction (their descriptors carry
    // amountCents 0), and the kind guard below makes that explicit so a future
    // descriptor change cannot silently re-count them into net worth.
    (sum, group) => sum + (group.kind === "liability" ? -1 : group.kind === "excluded" ? 0 : 1) * (group.rows ? subtotal(group.rows) : group.subgroups.reduce((s, sub) => s + subtotal(sub.rows), 0)),
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

  if (!data && isLoading) return <ForgeLoadingState label="Loading accounts…" />;
  if (!data && loadError) {
    return (
      <section data-financial-account-balances className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="mt-2">
          <ForgeErrorState
            title="Could not load your accounts."
            detail={loadError}
            onRetry={refresh}
          />
        </div>
      </section>
    );
  }
  if (!data) return null;

  // Every real group is omitted entirely when it has no rows (see buildTree above), so a genuinely
  // new workspace would otherwise render this whole panel as nothing at all -- no "Accounts"
  // heading, no way in. A standalone "+ Add account" (banking's own row, reused as-is, no dedicated
  // create form duplicated here) keeps a manual-entry path visible even before anything exists.
  if (groups.length === 0) {
    return (
      <section data-financial-account-balances className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h3 className="px-1.5 text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Accounts</h3>
        <p className="px-1.5 py-2 text-xs text-slate-500 dark:text-slate-400">No accounts yet.</p>
        <div className="pl-1"><AddAccountRow groupKey="banking" onCreated={refresh} /></div>
      </section>
    );
  }

  return (
    <section data-financial-account-balances className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      <h3 className="px-1.5 text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Accounts</h3>
      {isRefreshing ? <p role="status" className="px-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500">Updating…</p> : null}
      {loadError ? <p role="status" className="px-1.5 text-[10px] font-bold text-slate-400 dark:text-slate-500">Could not refresh — showing the last saved balances.</p> : null}
      <div className="flex items-center justify-between px-1.5 py-2">
        <span className="text-sm font-black text-slate-900 dark:text-white">Net Worth</span>
        <span data-net-worth className="text-sm font-black tabular-nums text-slate-950 dark:text-white">{money.format(netWorthCents / 100)}</span>
      </div>

      <div>
        {groups.map((group) => (
          <Group key={group.key} group={group} isCollapsed={isCollapsed} onToggle={toggle} onSaved={refresh} />
        ))}
      </div>
    </section>
  );
}
