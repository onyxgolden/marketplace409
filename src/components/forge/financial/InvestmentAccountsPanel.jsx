"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bitcoin, Landmark, Pencil, PiggyBank, Plus, TrendingUp, Trash2, Vault, Wallet } from "lucide-react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const TYPE_PRESENTATION = {
  taxable_brokerage: { label: "Taxable brokerage", icon: TrendingUp },
  ira: { label: "IRA", icon: Landmark },
  roth_ira: { label: "Roth IRA", icon: Landmark },
  "401k": { label: "401(k)", icon: PiggyBank },
  pension: { label: "Pension", icon: PiggyBank },
  crypto_exchange: { label: "Crypto exchange", icon: Bitcoin },
  crypto_wallet: { label: "Crypto wallet", icon: Bitcoin },
  metals_vault: { label: "Metals vault", icon: Vault },
  private_investment: { label: "Private investment", icon: Wallet },
  other: { label: "Other investments", icon: Wallet },
};
const TAX_TREATMENT_LABEL = { taxable: "Taxable", tax_deferred: "Tax-deferred", tax_exempt: "Tax-exempt", unknown: "Unknown tax treatment" };

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = () => ({ name: "", institutionName: "", accountType: "taxable_brokerage", taxTreatment: "taxable", ownershipScope: "business", value: "", valueDate: today(), notes: "" });

export default function InvestmentAccountsPanel() {
  const [accounts, setAccounts] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/financial/investment-accounts");
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error || "Unable to load investment accounts.");
    setAccounts(body.accounts);
  }, []);
  useEffect(() => { load().catch((thrown) => setError(thrown.message)); }, [load]);

  const totals = useMemo(() => {
    const rows = accounts || [];
    return {
      all: rows.reduce((sum, account) => sum + Number(account.latestValuation?.amountCents || 0), 0),
      business: rows.filter((account) => account.ownershipScope === "business").reduce((sum, account) => sum + Number(account.latestValuation?.amountCents || 0), 0),
      personal: rows.filter((account) => account.ownershipScope === "personal").reduce((sum, account) => sum + Number(account.latestValuation?.amountCents || 0), 0),
    };
  }, [accounts]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/financial/investment-accounts", {
        method: editingAccountId ? "PATCH" : "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, accountId: editingAccountId, valueCents: Math.round(Number(form.value) * 100) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Unable to save investment account.");
      setForm(emptyForm()); setEditingAccountId(null); setShowForm(false); await load();
    } catch (thrown) { setError(thrown.message); } finally { setSaving(false); }
  }

  function beginCreate() {
    setEditingAccountId(null);
    setForm(emptyForm());
    setShowForm(true);
  }

  function beginEdit(account) {
    setEditingAccountId(account.id);
    setForm({
      name: account.name,
      institutionName: account.institutionName || "",
      accountType: account.accountType,
      taxTreatment: account.taxTreatment,
      ownershipScope: account.ownershipScope,
      value: Number(account.latestValuation?.amountCents || 0) / 100,
      valueDate: today(),
      notes: account.notes || "",
    });
    setShowForm(true);
  }

  async function retire(account) {
    if (!window.confirm(`Retire ${account.name}? Its history will be preserved, but it will leave active Net Worth.`)) return;
    setError("");
    const response = await fetch("/api/financial/investment-accounts", {
      method: "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: account.id }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error || "Unable to retire investment account.");
    await load();
  }

  const grouped = Object.entries(TYPE_PRESENTATION).map(([key, presentation]) => ({
    key, ...presentation, accounts: (accounts || []).filter((account) => account.accountType === key),
  })).filter((group) => group.accounts.length > 0);

  return (
    <section data-investment-accounts className="space-y-5">
      <div className="rounded-3xl border border-slate-700 bg-[linear-gradient(135deg,#111b31_0%,#0b1325_55%,#17233c_100%)] p-6 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-400">FORGE Investments</p><h2 className="mt-2 text-3xl font-black">Brokerage, retirement &amp; crypto accounts</h2><p className="mt-2 max-w-2xl text-sm text-slate-300">Track brokerage, IRA, 401(k), pension, crypto, and other investment accounts separately from bank cash and physical assets. Manual account-level values today; per-holding detail is a future phase.</p></div>
          <button type="button" onClick={beginCreate} className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-black ${goldControlClassName}`}><Plus size={17} /> Add account</button>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[["Total investable assets", totals.all], ["Business", totals.business], ["Personal", totals.personal]].map(([label, cents]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-2xl font-black tabular-nums">{money.format(cents / 100)}</p></div>)}
        </div>
      </div>

      {showForm && <form onSubmit={submit} className="grid grid-cols-1 gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:grid-cols-2">
        <h3 className="md:col-span-2 text-xl font-black text-slate-950 dark:text-white">{editingAccountId ? "Update account and record a new valuation" : "Add an investment or retirement account"}</h3>
        <label className="text-sm font-bold">Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-slate-800" /></label>
        <label className="text-sm font-bold">Institution (optional)<input value={form.institutionName} onChange={(e) => setForm({ ...form, institutionName: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-slate-800" /></label>
        <label className="text-sm font-bold">Account type<select value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-slate-800">{Object.entries(TYPE_PRESENTATION).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
        <label className="text-sm font-bold">Tax treatment<select value={form.taxTreatment} onChange={(e) => setForm({ ...form, taxTreatment: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-slate-800">{Object.entries(TAX_TREATMENT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm font-bold">Ownership<select value={form.ownershipScope} onChange={(e) => setForm({ ...form, ownershipScope: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-slate-800"><option value="business">Business</option><option value="personal">Personal</option><option value="mixed">Mixed</option></select></label>
        <label className="text-sm font-bold">Current value<input required type="number" min="0" step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-slate-800" /></label>
        <label className="text-sm font-bold md:col-span-2">Value as of<input required type="date" value={form.valueDate} onChange={(e) => setForm({ ...form, valueDate: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-slate-800" /></label>
        <label className="text-sm font-bold md:col-span-2">Notes<textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 min-h-20 w-full rounded-xl border px-3 py-2 dark:bg-slate-800" /></label>
        <div className="md:col-span-2 flex gap-3"><button disabled={saving} className={`rounded-full px-5 py-2 text-sm font-black ${goldControlClassName}`}>{saving ? "Saving…" : editingAccountId ? "Save new valuation" : "Save account"}</button><button type="button" onClick={() => { setShowForm(false); setEditingAccountId(null); }} className="rounded-full bg-slate-100 px-5 py-2 text-sm font-black dark:bg-slate-800">Cancel</button></div>
      </form>}

      {error && <p role="alert" className="rounded-2xl bg-rose-50 p-4 font-bold text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
      {accounts && accounts.length === 0 && <div className="rounded-3xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700"><h3 className="text-xl font-black">Your investment registry is ready</h3><p className="mt-2 text-sm text-slate-500">Add brokerage, IRA, 401(k), pension, crypto, and other investment accounts to include their value in Net Worth.</p></div>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{grouped.map((group) => <section key={group.key} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"><div className="flex items-center gap-3"><span className="rounded-xl bg-slate-100 p-2 dark:bg-slate-800"><group.icon size={20} /></span><h3 className="text-lg font-black">{group.label}</h3><span className="ml-auto text-sm font-black text-slate-500">{money.format(group.accounts.reduce((sum, account) => sum + Number(account.latestValuation?.amountCents || 0), 0) / 100)}</span></div><div className="mt-4 divide-y divide-slate-200 dark:divide-slate-700">{group.accounts.map((account) => <div key={account.id} className="flex items-center justify-between gap-4 py-3"><div><p className="font-black">{account.name}</p><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{account.ownershipScope} · {TAX_TREATMENT_LABEL[account.taxTreatment]}{account.institutionName ? ` · ${account.institutionName}` : ""}</p></div><div className="flex items-center gap-3"><div className="text-right"><p className="font-black tabular-nums">{money.format(Number(account.latestValuation?.amountCents || 0) / 100)}</p><p className="text-xs text-slate-500">as of {account.latestValuation?.effectiveDate || "—"}</p></div><button type="button" onClick={() => beginEdit(account)} aria-label={`Edit ${account.name}`} className="rounded-xl bg-slate-100 p-2 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"><Pencil size={16} /></button><button type="button" onClick={() => retire(account).catch((thrown) => setError(thrown.message))} aria-label={`Retire ${account.name}`} className="rounded-xl bg-rose-50 p-2 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/30 dark:text-rose-300"><Trash2 size={16} /></button></div></div>)}</div></section>)}</div>
    </section>
  );
}
