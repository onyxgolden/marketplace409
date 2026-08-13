"use client";
import { useEffect, useState } from "react";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export default function RentalLeasePanel({ initialSetup = { units: [], tenants: [], leases: [] } }) {
  const [message, setMessage] = useState("");
  const [setup, setSetup] = useState(initialSetup);
  const [showCreate, setShowCreate] = useState((initialSetup.leases || []).length === 0);
  const [working, setWorking] = useState(false);
  useEffect(() => { (async () => {
    const response = await fetch("/api/rental"); const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load lease setup records.");
    const loaded = { units: result.units || [], tenants: result.tenants || [], leases: result.leases || [] };
    setSetup(loaded); setShowCreate(loaded.leases.length === 0);
  })().catch((error) => setMessage(error.message)); }, []);
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
    {(setup.leases || []).length > 0 && <div className="mt-5 rounded-xl border border-emerald-300 bg-emerald-50 p-4"><p className="text-sm font-black text-emerald-950">Saved leases</p><ul className="mt-2 space-y-2 text-sm text-emerald-950">{setup.leases.map((lease) => { const unit = setup.units.find((item) => item.id === lease.unit_id); return <li key={lease.id}><strong>{unit?.label || lease.unit_id}</strong> · <span className="capitalize">{lease.status}</span> · {money.format(Number(lease.monthly_rent_cents) / 100)} monthly · {lease.start_date}{lease.end_date ? ` to ${lease.end_date}` : " to current"}</li>; })}</ul></div>}
    {(setup.units.length === 0 || setup.tenants.length === 0) && <p role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-950">
      Save at least one rental unit and tenant before creating a lease.</p>}
    {(setup.leases || []).length > 0 && !showCreate && <button type="button" onClick={() => setShowCreate(true)} className="mt-5 rounded-xl border border-slate-300 px-4 py-2 text-sm font-black">Add another draft lease</button>}
    {showCreate && <form onSubmit={save} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <label className="text-sm font-bold">Property ID<input name="propertyId" defaultValue="4800-kent-ave" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">Rental unit<select name="unitId" required defaultValue="" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3">
        <option value="" disabled>Select a saved unit</option>{setup.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label} — {unit.property_id}</option>)}</select></label>
      <label className="text-sm font-bold">Tenant<select name="tenantId" required defaultValue="" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3">
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
