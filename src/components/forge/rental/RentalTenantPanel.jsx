"use client";
import { useEffect, useState } from "react";
import RentalRecordBrowser from "./RentalRecordBrowser";
import RentalRecordActions, { labelRentalRecordContext } from "./RentalRecordActions";
import RentalPhotoUpload from "./RentalPhotoUpload";

export default function RentalTenantPanel({ initialTenants = [], onNavigate: navigate }) {
  const [message, setMessage] = useState("");
  const [tenants, setTenants] = useState(initialTenants);
  const [showCreate, setShowCreate] = useState(initialTenants.length === 0);
  const [selectedId, setSelectedId] = useState(initialTenants[0]?.id || null);
  const [working, setWorking] = useState(false);
  const onNavigate = (target, context) => navigate?.(target, labelRentalRecordContext(context, tenants, "display_name"));
  async function loadTenants() {
    const response = await fetch("/api/rental");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load tenants.");
    const loaded = result.tenants || []; setTenants(loaded); setSelectedId((current) => loaded.some((item) => item.id === current) ? current : loaded[0]?.id || null);
  }
  useEffect(() => {
    fetch("/api/rental").then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load tenants.");
      return result.tenants || [];
    }).then((loadedTenants) => { setTenants(loadedTenants); setSelectedId(loadedTenants[0]?.id || null); setShowCreate(loadedTenants.length === 0); }).catch((error) => setMessage(error.message));
  }, []);
  async function save(event) {
    event.preventDefault(); setWorking(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-tenant", tenant: { displayName: form.get("displayName"),
          email: form.get("email"), phone: form.get("phone") || null, status: "invited" } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save tenant.");
      setMessage(`Tenant saved: ${result.tenant.displayName} — ID: ${result.tenant.id}`);
      event.currentTarget.reset();
      await loadTenants();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function updateEmail(event, tenantId) {
    event.preventDefault(); setWorking(true); setMessage(""); const form = new FormData(event.currentTarget);
    try { const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "update-tenant-email", tenantId, email: form.get("portalEmail") }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to update tenant email.");
      setMessage(`Portal email updated for ${result.tenant.display_name}.`); await loadTenants();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-rental-tenant-setup>
    <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Tenant setup</p>
    <h2 className="mt-2 text-2xl font-black">Tenants</h2>
    <p className="mt-2 text-sm text-slate-600">Review saved tenants first. Creation remains separate from portal access and lease assignment.</p>
    {tenants.length > 0 && <RentalRecordBrowser title="Tenants" records={tenants} selectedId={selectedId} onSelect={setSelectedId} getTitle={(tenant) => tenant.display_name} getSubtitle={(tenant) => `${tenant.email} · ${tenant.status || "Status not set"}`} getThumbnail={(tenant) => tenant.photo_url}>
      {(() => { const tenant = tenants.find((item) => item.id === selectedId) || tenants[0]; const context={recordType:"tenant",recordId:tenant?.id}; return tenant && <div data-rental-tenant-detail><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-sky-700">Selected tenant</p><h3 className="mt-2 text-2xl font-black">{tenant.display_name}</h3><p className="mt-2 text-sm text-slate-600">{tenant.phone || "No phone recorded"}</p></div><RentalRecordActions label="Tenant actions" actions={[{label:"Rent & payments",onSelect:()=>onNavigate?.("charges",context)},{label:"Manage lease",onSelect:()=>onNavigate?.("leases",context)},{label:"Messaging",onSelect:()=>onNavigate?.("communications",context)},{label:"Inspections",onSelect:()=>onNavigate?.("inspections",context)},{label:"File library",onSelect:()=>onNavigate?.("documents",context)}]}/></div><div className="mt-4"><RentalPhotoUpload entityType="tenant" entityId={tenant.id} photoUrl={tenant.photo_url} onUploaded={loadTenants} /></div><form onSubmit={(event) => updateEmail(event, tenant.id)} className="mt-5"><label className="text-sm font-bold">Portal email<input name="portalEmail" type="email" required defaultValue={tenant.email} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" aria-label={`Portal email for ${tenant.display_name}`} /></label><button disabled={working} className="mt-3 rounded-xl bg-slate-950 px-4 py-2.5 font-bold text-white disabled:opacity-50">Update portal email</button></form><a href="/auth?next=/forge/rental/portal" className="mt-5 inline-block font-bold text-sky-700 underline">Open tenant sign-in</a></div>; })()}
    </RentalRecordBrowser>}
    {tenants.length > 0 && !showCreate && <button type="button" onClick={() => setShowCreate(true)} className="mt-5 rounded-xl border border-slate-300 px-4 py-2 text-sm font-black">Add another tenant</button>}
    {showCreate && <form onSubmit={save} className="mt-6 grid max-w-4xl gap-4 md:grid-cols-2">
      <label className="text-sm font-bold">Tenant name<input name="displayName" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">Email<input name="email" type="email" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">Phone<input name="phone" type="tel" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <div className="flex items-end"><button disabled={working} className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50">{working ? "Saving…" : "Save tenant"}</button></div>
      {message && <p role="status" className="md:col-span-2 text-sm font-bold text-slate-700">{message}</p>}
    </form>}
  </section>;
}
