"use client";
import { useEffect, useState } from "react";
import RentalRecordBrowser from "./RentalRecordBrowser";
import RentalRecordActions, { labelRentalRecordContext } from "./RentalRecordActions";
import RentalPhotoUpload from "./RentalPhotoUpload";

async function submit(operation, key, value) {
  const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, [key]: value }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Rental Manager operation failed.");
  return result;
}

export default function RentalSetupPanel({ initialUnits = [], onNavigate: navigate }) {
  const [message, setMessage] = useState("");
  const [units, setUnits] = useState(initialUnits);
  const [showCreate, setShowCreate] = useState(initialUnits.length === 0);
  const [selectedId, setSelectedId] = useState(initialUnits[0]?.id || null);
  const [working, setWorking] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const onNavigate = (target, context) => navigate?.(target, labelRentalRecordContext(context, units, "label"));
  async function loadUnits() {
    const response = await fetch("/api/rental"); const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load rental units.");
    const loaded = result.units || []; setUnits(loaded); setSelectedId((current) => loaded.some((item) => item.id === current) ? current : loaded[0]?.id || null);
  }
  useEffect(() => {
    fetch("/api/rental").then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load rental units.");
      return result.units || [];
    }).then((loadedUnits) => { setUnits(loadedUnits); setSelectedId(loadedUnits[0]?.id || null); setShowCreate(loadedUnits.length === 0); }).catch((error) => setMessage(error.message));
  }, []);
  async function saveUnit(event) {
    event.preventDefault(); setWorking(true); setMessage("");
    const values = new FormData(event.currentTarget);
    try {
      const existing = units.find((item) => item.id === values.get("id"));
      const result = await submit("save-unit", "unit", { id: values.get("id") || undefined, propertyId: values.get("propertyId"), label: values.get("label"),
        status: existing?.status || "preparing", bedrooms: Number(values.get("bedrooms")) || null, bathrooms: Number(values.get("bathrooms")) || null,
        squareFeet: Number(values.get("squareFeet")) || null, notes: values.get("notes") || null,
        availableAt: existing?.available_at || null, createdAt: existing?.created_at || undefined });
      setMessage(`Unit saved: ${result.unit.label} — ID: ${result.unit.id}`);
      await loadUnits();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-rental-setup>
      <div className="max-w-3xl"><p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Kent Avenue setup</p>
        <h2 className="mt-2 text-2xl font-black">Rental units</h2>
        <p className="mt-2 text-sm text-slate-600">Review saved units first. Create another unit only as a deliberate action.</p></div>
      {units.length > 0 && <RentalRecordBrowser title="Rental units" records={units} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setEditingId(null); }} getTitle={(unit) => unit.label} getSubtitle={(unit) => `${unit.property_id} · ${unit.status || "Status not set"}`} getThumbnail={(unit) => unit.photo_url}>
        {(() => { const unit = units.find((item) => item.id === selectedId) || units[0]; const context = { recordType: "unit", recordId: unit?.id, propertyId: unit?.property_id }; return unit && <div data-rental-unit-detail><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-sky-700">Selected unit</p><h3 className="mt-2 text-2xl font-black">{unit.label}</h3></div><RentalRecordActions label="Property actions" actions={[{label:"Edit property details",onSelect:()=>setEditingId(unit.id)},{label:"Manage lease",onSelect:()=>onNavigate?.("leases",context)},{label:"Rent & payments",onSelect:()=>onNavigate?.("charges",context)},{label:"Work orders",onSelect:()=>onNavigate?.("maintenance",context)},{label:"Inspections",onSelect:()=>onNavigate?.("inspections",context)},{label:"File library",onSelect:()=>onNavigate?.("documents",context)}]}/></div><div className="mt-4"><RentalPhotoUpload entityType="unit" entityId={unit.id} photoUrl={unit.photo_url} onUploaded={loadUnits} /></div>{editingId===unit.id?<UnitEditForm unit={unit} working={working} onCancel={()=>setEditingId(null)} onSave={saveUnit}/>:<dl className="mt-5 grid gap-4 sm:grid-cols-2"><Detail label="Property" value={unit.property_id} /><Detail label="Status" value={unit.status || "Not set"} /><Detail label="Bedrooms" value={unit.bedrooms ?? "Not recorded"} /><Detail label="Bathrooms" value={unit.bathrooms ?? "Not recorded"} /><Detail label="Square feet" value={unit.square_feet ?? "Not recorded"} /><Detail label="Notes" value={unit.notes || "No notes"} /></dl>}</div>; })()}
      </RentalRecordBrowser>}
      {units.length > 0 && !showCreate && <button type="button" onClick={() => setShowCreate(true)} className="mt-5 rounded-xl border border-slate-300 px-4 py-2 text-sm font-black">Add another rental unit</button>}
      {showCreate && <form className="mt-6 grid max-w-4xl gap-4 md:grid-cols-2" onSubmit={saveUnit}>
        <label className="text-sm font-bold">Property ID<input name="propertyId" defaultValue="4800-kent-ave" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <label className="text-sm font-bold">Unit label<input name="label" defaultValue="Main residence" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <label className="text-sm font-bold">Bedrooms<input name="bedrooms" type="number" min="0" step="1" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <label className="text-sm font-bold">Bathrooms<input name="bathrooms" type="number" min="0" step="0.5" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <label className="text-sm font-bold">Square feet<input name="squareFeet" type="number" min="0" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <label className="text-sm font-bold">Notes<input name="notes" defaultValue="Remodel in progress." className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
        <div className="md:col-span-2 flex items-center gap-4"><button disabled={working} className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50">{working ? "Saving…" : "Save Kent Avenue unit"}</button>
          {message && <p role="status" className="text-sm font-bold text-slate-700">{message}</p>}</div>
      </form>}
    </section>
  );
}

function Detail({ label, value }) { return <div><dt className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</dt><dd className="mt-1 font-bold text-slate-800">{value}</dd></div>; }
function UnitEditForm({unit,working,onCancel,onSave}){return <form aria-label={`Edit ${unit.label}`} onSubmit={onSave} className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2"><input type="hidden" name="id" value={unit.id}/><input type="hidden" name="propertyId" value={unit.property_id}/><label className="text-sm font-bold">Unit label<input name="label" defaultValue={unit.label} required className="mt-1 w-full rounded-lg border p-2"/></label><label className="text-sm font-bold">Bedrooms<input name="bedrooms" type="number" min="0" defaultValue={unit.bedrooms??""} className="mt-1 w-full rounded-lg border p-2"/></label><label className="text-sm font-bold">Bathrooms<input name="bathrooms" type="number" min="0" step="0.5" defaultValue={unit.bathrooms??""} className="mt-1 w-full rounded-lg border p-2"/></label><label className="text-sm font-bold">Square feet<input name="squareFeet" type="number" min="0" defaultValue={unit.square_feet??""} className="mt-1 w-full rounded-lg border p-2"/></label><label className="text-sm font-bold sm:col-span-2">Notes<input name="notes" defaultValue={unit.notes||""} className="mt-1 w-full rounded-lg border p-2"/></label><div className="flex gap-2 sm:col-span-2"><button disabled={working} className="rounded-lg bg-slate-950 px-4 py-2 font-bold text-white">Save changes</button><button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 font-bold">Cancel</button></div></form>}
