"use client";
import { useEffect, useMemo, useState } from "react";
import ReservationInventoryBulkImport from "./ReservationInventoryBulkImport";

const TYPE_LABELS = Object.freeze({ rv_site: "RV site", cabin: "Cabin", furnished_home: "Furnished home", vacation_unit: "Vacation unit", glamping_site: "Glamping site", tent_site: "Tent site", parking_space: "Parking space", storage_space: "Storage space", other: "Other" });
const INITIAL = Object.freeze({ unitId: "", inventoryType: "rv_site", publicName: "", maximumGuests: "4", minimumNights: "1", maximumNights: "", turnoverBufferHours: "0", amenities: "", bookingStatus: "draft", nightlyRate: "", cleaningFee: "0", securityDeposit: "0", lodgingTaxPercent: "0" });

export default function ReservationInventoryPanel() {
  const [state, setState] = useState({ loading: true, units: [], inventory: [], error: "" });
  const [form, setForm] = useState(INITIAL);
  const [saving, setSaving] = useState(false);
  const configured = useMemo(() => new Set(state.inventory.map((item) => item.unit_id)), [state.inventory]);
  const units = state.units.filter((unit) => !configured.has(unit.id) || unit.id === form.unitId);
  async function load() {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try { const response = await fetch("/api/rental/reservations/inventory"); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Unable to load reservation inventory."); setState({ loading: false, units: payload.units || [], inventory: payload.inventory || [], error: "" }); }
    catch (error) { setState((current) => ({ ...current, loading: false, error: error.message })); }
  }
  useEffect(() => { load(); }, []);
  function update(name, value) { setForm((current) => ({ ...current, [name]: value })); }
  async function save(event) {
    event.preventDefault(); setSaving(true); setState((current) => ({ ...current, error: "" }));
    try {
      const inventory = { ...form, maximumGuests: Number(form.maximumGuests), minimumNights: Number(form.minimumNights), maximumNights: form.maximumNights ? Number(form.maximumNights) : null, turnoverBufferHours: Number(form.turnoverBufferHours), amenities: form.amenities.split(",").map((item) => item.trim()).filter(Boolean), nightlyRateCents: Math.round(Number(form.nightlyRate) * 100), cleaningFeeCents: Math.round(Number(form.cleaningFee) * 100), securityDepositCents: Math.round(Number(form.securityDeposit) * 100), lodgingTaxBasisPoints: Math.round(Number(form.lodgingTaxPercent) * 100) };
      const response = await fetch("/api/rental/reservations/inventory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "save-inventory", inventory }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "Unable to save reservation inventory."); setForm(INITIAL); await load();
    } catch (error) { setState((current) => ({ ...current, error: error.message })); } finally { setSaving(false); }
  }
  return <section aria-label="RV and short-term rental inventory" className="space-y-5">
    <div><p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700 dark:text-sky-400">Reservations</p><h2 className="text-2xl font-black text-slate-950 dark:text-white">RV & short-term rentals</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Configure reservable spaces and stays. Drivable RVs are intentionally excluded.</p></div>
    {state.error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-800">{state.error}</p>}
    <ReservationInventoryBulkImport onImported={load}/>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"><h3 className="font-black">Reservable inventory</h3>{state.loading ? <p className="mt-3 text-sm">Loading inventory…</p> : state.inventory.length === 0 ? <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">No RV or short-term rental inventory configured yet.</p> : <ul className="mt-3 space-y-3">{state.inventory.map((item) => <li key={item.unit_id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><div className="flex items-start justify-between gap-3"><div><p className="font-black">{item.public_name}</p><p className="text-sm text-slate-600 dark:text-slate-300">{TYPE_LABELS[item.inventory_type]} · up to {item.maximum_guests} guests · {item.minimum_nights} night minimum</p></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black uppercase dark:bg-slate-800">{item.booking_status}</span></div></li>)}</ul>}</div>
      <form onSubmit={save} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"><h3 className="font-black">Configure a space</h3>
        <label className="block text-sm font-bold">Rental Manager property/unit<select required value={form.unitId} onChange={(e)=>update("unitId",e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-slate-950 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"><option value="">Select inventory</option>{units.map((unit)=><option key={unit.id} value={unit.id}>{unit.label}</option>)}</select></label>
        <label className="block text-sm font-bold">Space type<select value={form.inventoryType} onChange={(e)=>update("inventoryType",e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-slate-950 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100">{Object.entries(TYPE_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block text-sm font-bold">Public name<input required value={form.publicName} onChange={(e)=>update("publicName",e.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-600 dark:bg-slate-950" /></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm font-bold">Maximum guests<input type="number" min="1" required value={form.maximumGuests} onChange={(e)=>update("maximumGuests",e.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-600 dark:bg-slate-950" /></label><label className="text-sm font-bold">Minimum nights<input type="number" min="1" required value={form.minimumNights} onChange={(e)=>update("minimumNights",e.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-600 dark:bg-slate-950" /></label></div>
        <label className="block text-sm font-bold">Turnover buffer hours<input type="number" min="0" max="168" value={form.turnoverBufferHours} onChange={(e)=>update("turnoverBufferHours",e.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-600 dark:bg-slate-950" /></label>
        <label className="block text-sm font-bold">Amenities <span className="font-normal">(comma separated)</span><input value={form.amenities} onChange={(e)=>update("amenities",e.target.value)} placeholder="50 amp, water, sewer, Wi-Fi" className="mt-1 w-full rounded-lg border p-2 dark:border-slate-600 dark:bg-slate-950" /></label>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm font-bold">Nightly rate ($)<input type="number" min="0.01" step="0.01" required value={form.nightlyRate} onChange={(e)=>update("nightlyRate",e.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-600 dark:bg-slate-950" /></label><label className="text-sm font-bold">Cleaning fee ($)<input type="number" min="0" step="0.01" value={form.cleaningFee} onChange={(e)=>update("cleaningFee",e.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-600 dark:bg-slate-950" /></label></div>
        <div className="grid grid-cols-2 gap-3"><label className="text-sm font-bold">Security deposit ($)<input type="number" min="0" step="0.01" value={form.securityDeposit} onChange={(e)=>update("securityDeposit",e.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-600 dark:bg-slate-950" /></label><label className="text-sm font-bold">Lodging tax (%)<input type="number" min="0" max="100" step="0.01" value={form.lodgingTaxPercent} onChange={(e)=>update("lodgingTaxPercent",e.target.value)} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-600 dark:bg-slate-950" /></label></div>
        <button disabled={saving} className="w-full rounded-lg bg-slate-950 px-4 py-2 font-black text-white disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950">{saving ? "Saving…" : "Save reservation inventory"}</button>
      </form>
    </div>
  </section>;
}
