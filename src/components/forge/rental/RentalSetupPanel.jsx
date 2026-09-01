"use client";
import { useEffect, useState } from "react";
import RentalRecordBrowser from "./RentalRecordBrowser";
import RentalRecordActions, { labelRentalRecordContext } from "./RentalRecordActions";
import RentalPhotoUpload from "./RentalPhotoUpload";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

async function submit(operation, key, value) {
  const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, [key]: value }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Rental Manager operation failed.");
  return result;
}

export function tenantLabelForUnit(unit, leases, leaseMemberships, tenants) {
  const activeLease = leases.find((lease) => lease.unit_id === unit.id && lease.status === "active");
  if (!activeLease) return null;
  const tenantIds = leaseMemberships.filter((membership) => membership.lease_id === activeLease.id).map((membership) => membership.tenant_id);
  const names = tenantIds.map((id) => tenants.find((tenant) => tenant.id === id)?.display_name).filter(Boolean);
  return names.length ? names.join(", ") : null;
}

export function activeBalanceCentsForUnit(unit, leases, openCharges) {
  const activeLeaseIds = new Set(leases.filter((lease) => lease.unit_id === unit.id && lease.status === "active").map((lease) => lease.id));
  if (activeLeaseIds.size === 0) return null;
  return openCharges
    .filter((charge) => activeLeaseIds.has(charge.lease_id))
    .reduce((sum, charge) => sum + Number(charge.amount_cents || 0) - Number(charge.paid_amount_cents || 0), 0);
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function RentalSetupPanel({ initialUnits = [], onNavigate: navigate }) {
  const [message, setMessage] = useState("");
  const [units, setUnits] = useState(initialUnits);
  const [leases, setLeases] = useState([]);
  const [leaseMemberships, setLeaseMemberships] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [openCharges, setOpenCharges] = useState([]);
  const [showCreate, setShowCreate] = useState(initialUnits.length === 0);
  const [selectedId, setSelectedId] = useState(initialUnits[0]?.id || null);
  const [working, setWorking] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [archiveCandidateId, setArchiveCandidateId] = useState(null);
  const onNavigate = (target, context) => navigate?.(target, labelRentalRecordContext(context, units, "label"));
  async function loadUnits() {
    const response = await fetch("/api/rental"); const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load rental units.");
    const loaded = result.units || []; setUnits(loaded); setSelectedId((current) => loaded.some((item) => item.id === current && item.status !== "inactive") ? current : loaded.find((item) => item.status !== "inactive")?.id || null); setShowCreate(loaded.every((item) => item.status === "inactive"));
    setLeases(result.leases || []); setLeaseMemberships(result.leaseMemberships || []); setTenants(result.tenants || []); setOpenCharges(result.openCharges || []);
  }
  useEffect(() => {
    fetch("/api/rental").then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load rental units.");
      return result;
    }).then((result) => { const loadedUnits = result.units || []; setUnits(loadedUnits); setSelectedId(loadedUnits.find((item) => item.status !== "inactive")?.id || null); setShowCreate(loadedUnits.every((item) => item.status === "inactive"));
      setLeases(result.leases || []); setLeaseMemberships(result.leaseMemberships || []); setTenants(result.tenants || []); setOpenCharges(result.openCharges || []); }).catch((error) => setMessage(error.message));
  }, []);
  async function saveUnit(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const existing = units.find((item) => item.id === values.get("id"));
    const action = existing
      ? `Save changes to ${existing.label}?`
      : `Create a new property/unit named ${values.get("label")} (${values.get("propertyId")})? This creates a separate record; it does not edit an existing property.`;
    if (!window.confirm(action)) return;
    setWorking(true); setMessage("");
    try {
      const result = await submit("save-unit", "unit", { id: values.get("id") || undefined, propertyId: values.get("propertyId"), label: values.get("label"),
        status: existing?.status || "preparing", bedrooms: Number(values.get("bedrooms")) || null, bathrooms: Number(values.get("bathrooms")) || null,
        squareFeet: Number(values.get("squareFeet")) || null, notes: values.get("notes") || null,
        availableAt: existing?.available_at || null, createdAt: existing?.created_at || undefined });
      setMessage(`Unit saved: ${result.unit.label} — ID: ${result.unit.id}`);
      setShowCreate(false); setEditingId(null);
      await loadUnits();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function archiveUnit(unit) {
    setWorking(true); setMessage("");
    try {
      await submit("archive-unit", "unitId", unit.id);
      setMessage(`${unit.label} archived. Financial and lease history was preserved.`);
      setArchiveCandidateId(null);
      await loadUnits();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function permanentlyDeleteUnit(unit) {
    const typed = window.prompt(`Permanently delete ${unit.label}? Type the exact property/unit name to confirm. This cannot be undone.`);
    if (typed !== unit.label) { if (typed !== null) setMessage("Permanent deletion cancelled: the name did not match."); return; }
    setWorking(true); setMessage("");
    try {
      await submit("delete-archived-unit", "unitId", unit.id);
      setMessage(`${unit.label} was permanently deleted.`);
      await loadUnits();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-rental-setup>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl"><p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Kent Avenue setup</p>
          <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Rental units</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Review saved units first. Create another unit only as a deliberate action.</p></div>
        {units.length > 0 && !showCreate && <button type="button" onClick={() => setShowCreate(true)} className={`shrink-0 rounded-xl px-5 py-3 text-sm font-black transition ${goldControlClassName}`}>+ Add a new property / unit</button>}
      </div>
      {units.length > 0 && !showCreate && <RentalRecordBrowser title="Rental properties" records={units.filter((unit) => unit.status !== "inactive")} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setEditingId(null); setArchiveCandidateId(null); }} getThumbnail={(unit) => unit.photo_url} listSize="wide"
        columns={[
          { header: "Property address", render: (unit) => <><strong className="block text-sm text-slate-950 dark:text-white">{unit.label}</strong><span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{unit.property_id} · {unit.status || "Status not set"}</span></> },
          { header: "Tenant", render: (unit) => { const tenantLabel = tenantLabelForUnit(unit, leases, leaseMemberships, tenants); return tenantLabel || <button type="button" onClick={(event) => { event.stopPropagation(); onNavigate?.("tenants", { recordType: "unit", recordId: unit.id, propertyId: unit.property_id, openCreateTenant: true }); }} className="font-black text-sky-700 underline decoration-2 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-200">Add tenant</button>; } },
          { header: "Active balance", render: (unit) => { const balanceCents = activeBalanceCentsForUnit(unit, leases, openCharges); return balanceCents === null
            ? <span className="text-slate-500 dark:text-slate-400">—</span>
            : <strong className={balanceCents > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}>{money.format(balanceCents / 100)}</strong>; } },
        ]}>
        {(() => {
          const unit = units.find((item) => item.id === selectedId) || units.find((item) => item.status !== "inactive");
          const context = { recordType: "unit", recordId: unit?.id, propertyId: unit?.property_id };
          return unit && <div data-rental-unit-detail>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">Selected unit</p><h3 className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{unit.label}</h3></div>
              <RentalRecordActions label="Property actions" summaryClassName="cursor-pointer list-none rounded-xl bg-red-600 px-4 py-2 text-sm font-black text-white transition hover:bg-red-700" actions={[{label:"Edit property details",onSelect:()=>{setArchiveCandidateId(null);setEditingId(unit.id);}},{label:"Manage lease",onSelect:()=>onNavigate?.("leases",context)},{label:"Rent & payments",onSelect:()=>onNavigate?.("charges",context)},{label:"Financial setup",onSelect:()=>onNavigate?.("financial-setup",context)},{label:"Work orders",onSelect:()=>onNavigate?.("maintenance",context)},{label:"Inspections",onSelect:()=>onNavigate?.("inspections",context)},{label:"File library",onSelect:()=>onNavigate?.("documents",context)},{label:"Archive duplicate / inactive property",onSelect:()=>{setEditingId(null);setArchiveCandidateId(unit.id);}}]}/>
            </div>
            <div className="mt-4"><RentalPhotoUpload entityType="unit" entityId={unit.id} photoUrl={unit.photo_url} onUploaded={loadUnits} /></div>
            {archiveCandidateId === unit.id ? <div className="mt-5 rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30"><p className="font-black text-red-900 dark:text-red-200">Archive {unit.label}?</p><p className="mt-2 text-sm text-red-800 dark:text-red-300">This removes the property/unit from active lists but preserves its financial, lease, and audit history. A property with an active lease cannot be archived.</p><div className="mt-3 flex gap-2"><button type="button" disabled={working} onClick={() => archiveUnit(unit)} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white">Confirm archive</button><button type="button" onClick={() => setArchiveCandidateId(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold dark:border-slate-600 dark:text-slate-300">Cancel</button></div></div>
              : editingId===unit.id ? <UnitEditForm unit={unit} working={working} onCancel={()=>setEditingId(null)} onSave={saveUnit}/>
              : <dl className="mt-5 grid gap-4 sm:grid-cols-2"><Detail label="Property" value={unit.property_id} /><Detail label="Status" value={unit.status || "Not set"} /><Detail label="Bedrooms" value={unit.bedrooms ?? "Not recorded"} /><Detail label="Bathrooms" value={unit.bathrooms ?? "Not recorded"} /><Detail label="Square feet" value={unit.square_feet ?? "Not recorded"} /><Detail label="Notes" value={unit.notes || "No notes"} /></dl>}
          </div>;
        })()}
      </RentalRecordBrowser>}
      {showCreate && <form className="mt-6 grid max-w-4xl gap-4 rounded-2xl border-2 border-sky-500 bg-sky-50 p-5 dark:border-sky-700 dark:bg-sky-950/30 md:grid-cols-2" onSubmit={saveUnit}>
        <div className="md:col-span-2"><h3 className="text-xl font-black text-slate-950 dark:text-white">Create a new property / unit</h3><p className="mt-1 text-sm font-bold text-sky-900 dark:text-sky-200">You are creating a separate record—not editing the property you previously selected. Review the name and property ID before continuing.</p></div>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Property ID<input name="propertyId" defaultValue="4800-kent-ave" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Unit label<input name="label" defaultValue="Main residence" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Bedrooms<input name="bedrooms" type="number" min="0" step="1" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Bathrooms<input name="bathrooms" type="number" min="0" step="0.5" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Square feet<input name="squareFeet" type="number" min="0" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Notes<input name="notes" defaultValue="Remodel in progress." className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <div className="md:col-span-2 flex flex-wrap items-center gap-4"><button disabled={working} className={`rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>{working ? "Saving…" : "Review and create property / unit"}</button><button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 dark:border-slate-600 dark:text-slate-300">Cancel creation</button>
          {message && <p role="status" className="text-sm font-bold text-slate-700 dark:text-slate-300">{message}</p>}</div>
      </form>}
      {!showCreate && units.some((unit) => unit.status === "inactive") && <div className="mt-6 rounded-2xl border border-slate-300 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40">
        <h3 className="text-lg font-black text-slate-950 dark:text-white">Archived properties / units</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Permanent deletion is available only for empty accidental duplicates. Records with lease, maintenance, or inspection history are protected.</p>
        <div className="mt-4 grid gap-3">{units.filter((unit) => unit.status === "inactive").map((unit) => <div key={unit.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div><p className="font-black text-slate-950 dark:text-white">{unit.label}</p><p className="text-xs text-slate-500 dark:text-slate-400">{unit.property_id}</p></div>
          <button type="button" disabled={working} onClick={() => permanentlyDeleteUnit(unit)} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">Permanently delete duplicate</button>
        </div>)}</div>
      </div>}
      {!showCreate && message && <p role="status" className="mt-4 text-sm font-bold text-slate-700 dark:text-slate-300">{message}</p>}
    </section>
  );
}

function Detail({ label, value }) { return <div><dt className="text-xs font-black uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</dt><dd className="mt-1 font-bold text-slate-800 dark:text-slate-200">{value}</dd></div>; }
function UnitEditForm({unit,working,onCancel,onSave}){return <form aria-label={`Edit ${unit.label}`} onSubmit={onSave} className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40 sm:grid-cols-2"><input type="hidden" name="id" value={unit.id}/><input type="hidden" name="propertyId" value={unit.property_id}/><label className="text-sm font-bold text-slate-900 dark:text-white">Unit label<input name="label" defaultValue={unit.label} required className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label><label className="text-sm font-bold text-slate-900 dark:text-white">Bedrooms<input name="bedrooms" type="number" min="0" defaultValue={unit.bedrooms??""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label><label className="text-sm font-bold text-slate-900 dark:text-white">Bathrooms<input name="bathrooms" type="number" min="0" step="0.5" defaultValue={unit.bathrooms??""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label><label className="text-sm font-bold text-slate-900 dark:text-white">Square feet<input name="squareFeet" type="number" min="0" defaultValue={unit.square_feet??""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label><label className="text-sm font-bold text-slate-900 dark:text-white sm:col-span-2">Notes<input name="notes" defaultValue={unit.notes||""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label><div className="flex gap-2 sm:col-span-2"><button disabled={working} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">Save changes</button><button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button></div></form>}
