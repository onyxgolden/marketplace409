"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Car, Coins, Gem, Plus, Tractor, Truck } from "lucide-react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const CLASS_PRESENTATION = {
  real_estate: { label: "Real estate", icon: Building2 },
  vehicle: { label: "Vehicles", icon: Car },
  equipment: { label: "Equipment", icon: Tractor },
  trailer: { label: "Trailers", icon: Truck },
  collectible: { label: "Collectibles", icon: Gem },
  crypto: { label: "Crypto", icon: Coins },
  other: { label: "Other assets", icon: Gem },
};

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = () => ({ name: "", assetClass: "vehicle", ownershipScope: "business", value: "", valueDate: today(), purchaseCost: "", purchaseDate: "", linkedPropertyId: "", notes: "" });

export default function FinancialAssetsPanel() {
  const [assets, setAssets] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/financial/assets");
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error || "Unable to load assets.");
    setAssets(body.assets);
  }, []);
  useEffect(() => { load().catch((thrown) => setError(thrown.message)); }, [load]);

  const totals = useMemo(() => {
    const rows = assets || [];
    return {
      all: rows.reduce((sum, asset) => sum + Number(asset.latestValuation?.amountCents || 0), 0),
      business: rows.filter((asset) => asset.ownershipScope === "business").reduce((sum, asset) => sum + Number(asset.latestValuation?.amountCents || 0), 0),
      personal: rows.filter((asset) => asset.ownershipScope === "personal").reduce((sum, asset) => sum + Number(asset.latestValuation?.amountCents || 0), 0),
    };
  }, [assets]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/financial/assets", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, valueCents: Math.round(Number(form.value) * 100), purchaseCostCents: form.purchaseCost === "" ? null : Math.round(Number(form.purchaseCost) * 100) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Unable to create asset.");
      setForm(emptyForm()); setShowForm(false); await load();
    } catch (thrown) { setError(thrown.message); } finally { setSaving(false); }
  }

  const grouped = Object.entries(CLASS_PRESENTATION).map(([key, presentation]) => ({
    key, ...presentation, assets: (assets || []).filter((asset) => asset.assetClass === key),
  })).filter((group) => group.assets.length > 0);

  return (
    <section data-financial-assets className="space-y-5">
      <div className="rounded-3xl border border-slate-700 bg-[linear-gradient(135deg,#111b31_0%,#0b1325_55%,#17233c_100%)] p-6 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-400">FORGE Assets</p><h2 className="mt-2 text-3xl font-black">Net worth building blocks</h2><p className="mt-2 max-w-2xl text-sm text-slate-300">Track property, vehicles, equipment, trailers, collectibles, and crypto separately from income and expenses.</p></div>
          <button type="button" onClick={() => setShowForm((value) => !value)} className={`inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-black ${goldControlClassName}`}><Plus size={17} /> Add asset</button>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[["Total assets", totals.all], ["Business", totals.business], ["Personal", totals.personal]].map(([label, cents]) => <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-2xl font-black tabular-nums">{money.format(cents / 100)}</p></div>)}
        </div>
      </div>

      {showForm && <form onSubmit={submit} className="grid grid-cols-1 gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:grid-cols-2">
        <h3 className="md:col-span-2 text-xl font-black text-slate-950 dark:text-white">Add a physical or digital asset</h3>
        <label className="text-sm font-bold">Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-slate-800" /></label>
        <label className="text-sm font-bold">Class<select value={form.assetClass} onChange={(e) => setForm({ ...form, assetClass: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-slate-800">{Object.entries(CLASS_PRESENTATION).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
        <label className="text-sm font-bold">Ownership<select value={form.ownershipScope} onChange={(e) => setForm({ ...form, ownershipScope: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-slate-800"><option value="business">Business</option><option value="personal">Personal</option><option value="mixed">Mixed</option></select></label>
        <label className="text-sm font-bold">Current value<input required type="number" min="0" step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-slate-800" /></label>
        <label className="text-sm font-bold">Value as of<input required type="date" value={form.valueDate} onChange={(e) => setForm({ ...form, valueDate: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-slate-800" /></label>
        <label className="text-sm font-bold">Purchase cost (optional)<input type="number" min="0" step="0.01" value={form.purchaseCost} onChange={(e) => setForm({ ...form, purchaseCost: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-slate-800" /></label>
        <label className="text-sm font-bold">Purchase date (optional)<input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-2 dark:bg-slate-800" /></label>
        <label className="text-sm font-bold md:col-span-2">Notes<textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 min-h-20 w-full rounded-xl border px-3 py-2 dark:bg-slate-800" /></label>
        <div className="md:col-span-2 flex gap-3"><button disabled={saving} className={`rounded-full px-5 py-2 text-sm font-black ${goldControlClassName}`}>{saving ? "Saving…" : "Save asset"}</button><button type="button" onClick={() => setShowForm(false)} className="rounded-full bg-slate-100 px-5 py-2 text-sm font-black dark:bg-slate-800">Cancel</button></div>
      </form>}

      {error && <p role="alert" className="rounded-2xl bg-rose-50 p-4 font-bold text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}
      {assets && assets.length === 0 && <div className="rounded-3xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700"><h3 className="text-xl font-black">Your asset registry is ready</h3><p className="mt-2 text-sm text-slate-500">Add the vehicles, equipment, trailers, collectibles, crypto, and property values that belong in Net Worth.</p></div>}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{grouped.map((group) => <section key={group.key} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"><div className="flex items-center gap-3"><span className="rounded-xl bg-slate-100 p-2 dark:bg-slate-800"><group.icon size={20} /></span><h3 className="text-lg font-black">{group.label}</h3><span className="ml-auto text-sm font-black text-slate-500">{money.format(group.assets.reduce((sum, asset) => sum + Number(asset.latestValuation?.amountCents || 0), 0) / 100)}</span></div><div className="mt-4 divide-y divide-slate-200 dark:divide-slate-700">{group.assets.map((asset) => <div key={asset.id} className="flex items-center justify-between gap-4 py-3"><div><p className="font-black">{asset.name}</p><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{asset.ownershipScope} · {asset.latestValuation?.source || "no valuation"}</p></div><div className="text-right"><p className="font-black tabular-nums">{money.format(Number(asset.latestValuation?.amountCents || 0) / 100)}</p><p className="text-xs text-slate-500">as of {asset.latestValuation?.effectiveDate || "—"}</p></div></div>)}</div></section>)}</div>
    </section>
  );
}
