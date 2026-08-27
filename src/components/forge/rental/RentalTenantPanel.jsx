"use client";
import { useEffect, useState } from "react";
import RentalRecordBrowser from "./RentalRecordBrowser";
import RentalRecordActions, { labelRentalRecordContext } from "./RentalRecordActions";
import RentalPhotoUpload from "./RentalPhotoUpload";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

export function propertyLabelForTenant(tenant, leases, leaseMemberships, units) {
  const leaseIds = leaseMemberships.filter((membership) => membership.tenant_id === tenant.id).map((membership) => membership.lease_id);
  const activeLease = leases.find((lease) => leaseIds.includes(lease.id) && lease.status === "active");
  if (!activeLease) return null;
  const unit = units.find((item) => item.id === activeLease.unit_id);
  return unit?.label || activeLease.unit_id || null;
}

export function activeBalanceCentsForTenant(tenant, leases, leaseMemberships, openCharges) {
  const leaseIds = new Set(leaseMemberships.filter((membership) => membership.tenant_id === tenant.id).map((membership) => membership.lease_id));
  const activeLeaseIds = new Set(leases.filter((lease) => leaseIds.has(lease.id) && lease.status === "active").map((lease) => lease.id));
  if (activeLeaseIds.size === 0) return null;
  return openCharges
    .filter((charge) => activeLeaseIds.has(charge.lease_id))
    .reduce((sum, charge) => sum + Number(charge.amount_cents || 0) - Number(charge.paid_amount_cents || 0), 0);
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function RentalTenantPanel({ initialTenants = [], onNavigate: navigate }) {
  const [message, setMessage] = useState("");
  const [tenants, setTenants] = useState(initialTenants);
  const [leases, setLeases] = useState([]);
  const [leaseMemberships, setLeaseMemberships] = useState([]);
  const [units, setUnits] = useState([]);
  const [openCharges, setOpenCharges] = useState([]);
  const [showCreate, setShowCreate] = useState(initialTenants.length === 0);
  const [selectedId, setSelectedId] = useState(initialTenants[0]?.id || null);
  const [working, setWorking] = useState(false);
  const onNavigate = (target, context) => navigate?.(target, labelRentalRecordContext(context, tenants, "display_name"));
  async function loadTenants() {
    const response = await fetch("/api/rental");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load tenants.");
    const loaded = result.tenants || []; setTenants(loaded); setSelectedId((current) => loaded.some((item) => item.id === current) ? current : loaded[0]?.id || null);
    setLeases(result.leases || []); setLeaseMemberships(result.leaseMemberships || []); setUnits(result.units || []); setOpenCharges(result.openCharges || []);
  }
  useEffect(() => {
    fetch("/api/rental").then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load tenants.");
      return result;
    }).then((result) => { const loadedTenants = result.tenants || []; setTenants(loadedTenants); setSelectedId(loadedTenants[0]?.id || null); setShowCreate(loadedTenants.length === 0);
      setLeases(result.leases || []); setLeaseMemberships(result.leaseMemberships || []); setUnits(result.units || []); setOpenCharges(result.openCharges || []); }).catch((error) => setMessage(error.message));
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
  return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-rental-tenant-setup>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Tenant setup</p>
        <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Tenants</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Review saved tenants first. Creation remains separate from portal access and lease assignment.</p></div>
      {tenants.length > 0 && !showCreate && <button type="button" onClick={() => setShowCreate(true)} className={`shrink-0 rounded-xl px-5 py-3 text-sm font-black transition ${goldControlClassName}`}>+ Add a new tenant</button>}
    </div>
    {tenants.length > 0 && <RentalRecordBrowser title="Tenants" records={tenants} selectedId={selectedId} onSelect={setSelectedId} getThumbnail={(tenant) => tenant.photo_url} listSize="wide"
      columns={[
        { header: "Tenant", render: (tenant) => <><strong className="block text-sm text-slate-950 dark:text-white">{tenant.display_name}</strong><span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{tenant.email} · {tenant.status || "Status not set"}</span></> },
        { header: "Property", render: (tenant) => { const propertyLabel = propertyLabelForTenant(tenant, leases, leaseMemberships, units); return propertyLabel || <span className="font-bold text-red-600 dark:text-red-400">No active lease</span>; } },
        { header: "Active balance", render: (tenant) => { const balanceCents = activeBalanceCentsForTenant(tenant, leases, leaseMemberships, openCharges); return balanceCents === null
          ? <span className="text-slate-500 dark:text-slate-400">—</span>
          : <strong className={balanceCents > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}>{money.format(balanceCents / 100)}</strong>; } },
      ]}>
      {(() => { const tenant = tenants.find((item) => item.id === selectedId) || tenants[0]; const context={recordType:"tenant",recordId:tenant?.id}; return tenant && <div data-rental-tenant-detail><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">Selected tenant</p><h3 className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{tenant.display_name}</h3><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{tenant.phone || "No phone recorded"}</p></div><RentalRecordActions label="Tenant actions" summaryClassName="cursor-pointer list-none rounded-xl bg-red-600 px-4 py-2 text-sm font-black text-white transition hover:bg-red-700" actions={[{label:"Rent & payments",onSelect:()=>onNavigate?.("charges",context)},{label:"Manage lease",onSelect:()=>onNavigate?.("leases",context)},{label:"Messaging",onSelect:()=>onNavigate?.("communications",context)},{label:"Inspections",onSelect:()=>onNavigate?.("inspections",context)},{label:"File library",onSelect:()=>onNavigate?.("documents",context)}]}/></div><div className="mt-4"><RentalPhotoUpload entityType="tenant" entityId={tenant.id} photoUrl={tenant.photo_url} onUploaded={loadTenants} /></div><form onSubmit={(event) => updateEmail(event, tenant.id)} className="mt-5"><label className="text-sm font-bold text-slate-900 dark:text-white">Portal email<input name="portalEmail" type="email" required defaultValue={tenant.email} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" aria-label={`Portal email for ${tenant.display_name}`} /></label><button disabled={working} className="mt-3 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">Update portal email</button></form><a href="/auth?next=/forge/rental/portal" className="mt-5 inline-block text-sm font-bold text-sky-700 underline hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300">Open tenant sign-in</a></div>; })()}
    </RentalRecordBrowser>}
    {showCreate && <form onSubmit={save} className="mt-6 grid max-w-4xl gap-4 md:grid-cols-2">
      <label className="text-sm font-bold text-slate-900 dark:text-white">Tenant name<input name="displayName" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Email<input name="email" type="email" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Phone<input name="phone" type="tel" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
      <div className="flex items-end"><button disabled={working} className={`rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>{working ? "Saving…" : "Save tenant"}</button></div>
      {message && <p role="status" className="md:col-span-2 text-sm font-bold text-slate-700 dark:text-slate-300">{message}</p>}
    </form>}
  </section>;
}
