"use client";
import { useEffect, useState } from "react";
import RentalRecordBrowser from "./RentalRecordBrowser";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function RentalLeasePanel({ initialSetup = { units: [], tenants: [], leases: [], schedules: [] }, loadOnMount = true, initialShowCreate = null }) {
  const [message, setMessage] = useState("");
  const [setup, setSetup] = useState(initialSetup);
  const [showCreate, setShowCreate] = useState(initialShowCreate ?? (initialSetup.leases || []).length === 0);
  const [selectedId, setSelectedId] = useState(initialSetup.leases?.[0]?.id || null);
  const [working, setWorking] = useState(false);
  const contextualPropertyId = setup.leases?.[0]?.property_id || setup.units?.[0]?.property_id || "4800-kent-ave";
  async function reload() {
    const response = await fetch("/api/rental"); const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load lease setup records.");
    const loaded = { units: result.units || [], tenants: result.tenants || [], leases: result.leases || [], schedules: result.schedules || [] };
    setSetup(loaded); setSelectedId((current) => loaded.leases.some((item) => item.id === current) ? current : loaded.leases[0]?.id || null); setShowCreate(loaded.leases.length === 0);
    return loaded;
  }
  useEffect(() => { if (!loadOnMount) return; reload().catch((error) => setMessage(error.message)); }, [loadOnMount]);
  async function activateLease(lease) {
    const schedule = (setup.schedules || []).find((item) => item.lease_id === lease.id);
    if (!schedule) { setMessage("No rent schedule found for this lease — save one before activating."); return; }
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "activate-lease-schedule", scheduleId: schedule.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to activate the lease.");
      setMessage(`Lease activated: ${result.activation.leaseId}`);
      await reload();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function save(event) {
    event.preventDefault(); setWorking(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const leaseResponse = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-lease", lease: { propertyId: form.get("propertyId"), unitId: form.get("unitId"),
          tenantIds: [form.get("tenantId")], status: "draft", startDate: form.get("startDate"), endDate: form.get("endDate") || null,
          monthlyRentCents: Math.round(Number(form.get("monthlyRent")) * 100), currencyCode: "USD",
          rentDueDay: Number(form.get("dueDay")), notes: form.get("notes") || null } }) });
      const leaseResult = await leaseResponse.json();
      if (!leaseResponse.ok) throw new Error(leaseResult.error || "Unable to save lease.");
      const scheduleResponse = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-schedule", schedule: { leaseId: leaseResult.lease.id, status: "draft",
          amountCents: leaseResult.lease.monthlyRentCents, currencyCode: "USD", dueDay: leaseResult.lease.rentDueDay,
          effectiveStartDate: leaseResult.lease.startDate, effectiveEndDate: leaseResult.lease.endDate } }) });
      const scheduleResult = await scheduleResponse.json();
      if (!scheduleResponse.ok) throw new Error(scheduleResult.error || "Lease saved, but its rent schedule could not be saved.");
      setMessage(`Lease saved: ${leaseResult.lease.id} — Schedule: ${scheduleResult.schedule.id}`);
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  return <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-rental-lease-setup>
    <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Lease setup</p>
    <h2 className="mt-2 text-2xl font-black">Leases and rent schedules</h2>
    <p className="mt-2 text-sm text-slate-600">Review existing leases first. New schedules remain draft until the signed lease is ready.</p>
    {(setup.leases || []).length > 0 && <RentalRecordBrowser title="Leases" records={setup.leases} selectedId={selectedId} onSelect={setSelectedId}
      getTitle={(lease) => setup.units.find((item) => item.id === lease.unit_id)?.label || lease.unit_id}
      getSubtitle={(lease) => `${lease.status} · ${money.format(Number(lease.monthly_rent_cents) / 100)} monthly`}>
      {(() => { const lease = setup.leases.find((item) => item.id === selectedId) || setup.leases[0]; const unit = setup.units.find((item) => item.id === lease?.unit_id); return lease && <div data-rental-lease-detail><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-sky-700">Selected lease</p><h3 className="mt-2 text-2xl font-black">{unit?.label || lease.unit_id}</h3></div><span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${lease.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{lease.status}</span></div><dl className="mt-5 grid gap-4 sm:grid-cols-2"><Detail label="Monthly rent" value={money.format(Number(lease.monthly_rent_cents) / 100)} /><Detail label="Due day" value={lease.rent_due_day || "Not recorded"} /><Detail label="Starts" value={lease.start_date} /><Detail label="Ends" value={lease.end_date || "Current"} /><Detail label="Property" value={lease.property_id} /><Detail label="Lease ID" value={lease.id} /></dl>{lease.status === "draft" && <div className="mt-5 flex items-center gap-4"><button type="button" disabled={working} onClick={() => activateLease(lease)} className="rounded-xl bg-emerald-700 px-5 py-2.5 font-black text-white disabled:opacity-50">{working ? "Activating…" : "Activate lease"}</button><p className="text-xs text-slate-500">Only activate once the lease is actually signed and in effect.</p></div>}</div>; })()}
    </RentalRecordBrowser>}
    {(setup.units.length === 0 || setup.tenants.length === 0) && <p role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-950">
      Save at least one rental unit and tenant before creating a lease.</p>}
    {(setup.leases || []).length > 0 && !showCreate && <button type="button" onClick={() => setShowCreate(true)} className="mt-5 rounded-xl border border-slate-300 px-4 py-2 text-sm font-black">Create future or replacement lease</button>}
    {showCreate && <form onSubmit={save} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {(setup.leases || []).length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 md:col-span-2 xl:col-span-3"><p className="text-sm font-bold text-amber-950">An existing lease is already recorded. Continue only for a future or replacement lease.</p><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-amber-500 bg-white px-3 py-2 text-sm font-black text-amber-950">Cancel setup</button></div>}
      <label className="text-sm font-bold">Property ID<input name="propertyId" defaultValue={contextualPropertyId} required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">Rental unit<select name="unitId" required defaultValue={setup.units.length === 1 ? setup.units[0].id : ""} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3">
        <option value="" disabled>Select a saved unit</option>{setup.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label} — {unit.property_id}</option>)}</select></label>
      <label className="text-sm font-bold">Tenant<select name="tenantId" required defaultValue={setup.tenants.length === 1 ? setup.tenants[0].id : ""} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3">
        <option value="" disabled>Select a saved tenant</option>{setup.tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.display_name} — {tenant.email}</option>)}</select></label>
      <label className="text-sm font-bold">Start date<input name="startDate" type="date" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">End date<input name="endDate" type="date" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">Monthly rent<input name="monthlyRent" type="number" min="0.01" step="0.01" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">Due day<input name="dueDay" type="number" min="1" max="28" defaultValue="1" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold xl:col-span-2">Notes<input name="notes" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <div className="md:col-span-2 xl:col-span-3 flex items-center gap-4"><button disabled={working || setup.units.length === 0 || setup.tenants.length === 0} className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50">{working ? "Saving…" : "Save draft lease and schedule"}</button>
        {message && <p role="status" className="text-sm font-bold text-slate-700">{message}</p>}</div>
    </form>}
  </section>;
}

function Detail({ label, value }) { return <div><dt className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</dt><dd className="mt-1 break-words font-bold text-slate-800">{value}</dd></div>; }
