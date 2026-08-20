"use client";
import { useEffect, useState } from "react";
import RentalRecordBrowser from "./RentalRecordBrowser";
import RentRollImportPanel from "./RentRollImportPanel";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const STATUS_TEXT_COLORS = { active: "text-emerald-700", draft: "text-amber-700", cancelled: "text-slate-400 line-through", ended: "text-slate-400", terminated: "text-slate-400" };
const STATUS_BADGE_COLORS = { active: "bg-emerald-100 text-emerald-800", draft: "bg-amber-100 text-amber-800", cancelled: "bg-slate-200 text-slate-600", ended: "bg-slate-200 text-slate-600", terminated: "bg-slate-200 text-slate-600" };

export function deriveLeaseFormDefaults(setup, recordContext) {
  const leases = setup.leases || [];
  const leaseMemberships = setup.leaseMemberships || [];
  const contextTenantId = recordContext?.recordType === "tenant" ? recordContext.recordId : null;
  if (contextTenantId) {
    const contextLeaseId = leaseMemberships.find((membership) => membership.tenant_id === contextTenantId)?.lease_id || null;
    const hasLease = contextLeaseId != null && leases.some((lease) => lease.id === contextLeaseId);
    return { tenantId: contextTenantId, showCreate: !hasLease, selectedId: hasLease ? contextLeaseId : null };
  }
  return { tenantId: null, showCreate: leases.length === 0, selectedId: leases[0]?.id || null };
}

export function propertyIdForSelectedUnit(units, unitId) {
  return (units || []).find((unit) => unit.id === unitId)?.property_id || null;
}

export default function RentalLeasePanel({ initialSetup = { units: [], tenants: [], leases: [], schedules: [], leaseMemberships: [] }, loadOnMount = true, initialShowCreate = null, recordContext = null }) {
  const initialDefaults = deriveLeaseFormDefaults(initialSetup, recordContext);
  const contextTenantId = recordContext?.recordType === "tenant" ? recordContext.recordId : null;
  const [message, setMessage] = useState("");
  const [setup, setSetup] = useState(initialSetup);
  const [showCreate, setShowCreate] = useState(initialShowCreate ?? initialDefaults.showCreate);
  const [selectedId, setSelectedId] = useState(initialDefaults.selectedId);
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [working, setWorking] = useState(false);
  useEffect(() => {
    if (!selectedUnitId && setup.units.length === 1) setSelectedUnitId(setup.units[0].id);
  }, [setup.units, selectedUnitId]);
  const selectedUnitPropertyId = propertyIdForSelectedUnit(setup.units, selectedUnitId);
  async function reload() {
    const response = await fetch("/api/rental"); const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load lease setup records.");
    const loaded = { units: result.units || [], tenants: result.tenants || [], leases: result.leases || [], schedules: result.schedules || [], leaseMemberships: result.leaseMemberships || [] };
    setSetup(loaded); setSelectedId((current) => loaded.leases.some((item) => item.id === current) ? current : loaded.leases[0]?.id || null); setShowCreate(loaded.leases.length === 0);
    return loaded;
  }
  useEffect(() => {
    if (!loadOnMount) return;
    reload().then((loaded) => {
      if (!contextTenantId) return;
      const defaults = deriveLeaseFormDefaults(loaded, recordContext);
      setShowCreate(defaults.showCreate);
      setSelectedId(defaults.selectedId);
    }).catch((error) => setMessage(error.message));
  }, [loadOnMount]);
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
  async function createSchedule(event, lease) {
    event.preventDefault(); setWorking(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-schedule", schedule: { leaseId: lease.id, status: "draft",
          amountCents: Math.round(Number(form.get("monthlyRent")) * 100), currencyCode: lease.currency_code || "USD",
          dueDay: Number(form.get("dueDay")), effectiveStartDate: form.get("startDate"), effectiveEndDate: form.get("endDate") || null } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save the rent schedule.");
      setMessage(`Rent schedule saved: ${result.schedule.id}. You can now activate this lease.`);
      await reload();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function cancelLease(lease) {
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "cancel-lease", leaseId: lease.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to cancel the lease.");
      setMessage(`Lease cancelled: ${result.lease.id}`);
      await reload();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function save(event) {
    event.preventDefault(); setMessage("");
    const form = new FormData(event.currentTarget);
    const unitId = form.get("unitId");
    const propertyId = propertyIdForSelectedUnit(setup.units, unitId);
    if (!propertyId) { setMessage("Select a valid rental unit before saving."); return; }
    setWorking(true);
    try {
      const leaseResponse = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-lease", lease: { propertyId, unitId,
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
    <p className="mt-2 text-sm text-slate-600">Review existing leases first. New schedules remain draft until the signed lease is ready. If a tenant is already renting but has no lease on file (their original term expired and was never re-signed, or the record didn't import), add one below and leave the end date blank for an ongoing month-to-month tenancy.</p>
    {(setup.leases || []).length > 0 && <RentalRecordBrowser title="Leases" records={setup.leases} selectedId={selectedId} onSelect={setSelectedId}
      getTitle={(lease) => setup.units.find((item) => item.id === lease.unit_id)?.label || lease.unit_id}
      getSubtitle={(lease) => <><span className={`font-bold capitalize ${STATUS_TEXT_COLORS[lease.status] || ""}`}>{lease.status}</span> · {money.format(Number(lease.monthly_rent_cents) / 100)} monthly</>}>
      {(() => { const lease = setup.leases.find((item) => item.id === selectedId) || setup.leases[0]; const unit = setup.units.find((item) => item.id === lease?.unit_id);
        return lease && <LeaseDetail lease={lease} unit={unit} schedule={(setup.schedules || []).find((item) => item.lease_id === lease.id)} working={working} onActivate={activateLease} onSaveSchedule={createSchedule} onCancel={cancelLease} />; })()}
    </RentalRecordBrowser>}
    {(setup.units.length === 0 || setup.tenants.length === 0) && <p role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-950">
      Save at least one rental unit and tenant before creating a lease.</p>}
    {(setup.leases || []).length > 0 && !showCreate && <button type="button" onClick={() => setShowCreate(true)} className="mt-5 rounded-xl bg-slate-950 px-5 py-3 font-black text-white">+ Add a lease for an existing tenant</button>}
    <RentRollImportPanel units={setup.units} tenants={setup.tenants} leases={setup.leases} onImported={reload} />
    {showCreate && <form onSubmit={save} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {(setup.leases || []).length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 md:col-span-2 xl:col-span-3"><p className="text-sm font-bold text-amber-950">Other leases already exist. This adds a new one — for a future/replacement term, or to attach a currently-renting tenant who has no lease on file yet.</p><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-amber-500 bg-white px-3 py-2 text-sm font-black text-amber-950">Cancel setup</button></div>}
      <label className="text-sm font-bold">Rental unit<select name="unitId" required value={selectedUnitId} onChange={(event) => setSelectedUnitId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3">
        <option value="" disabled>Select a saved unit</option>{setup.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label} — {unit.property_id}</option>)}</select></label>
      <label className="text-sm font-bold">Property<p className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 font-bold text-slate-700">{selectedUnitPropertyId || "Select a rental unit to set the property."}</p></label>
      <label className="text-sm font-bold">Tenant<select name="tenantId" required defaultValue={contextTenantId || (setup.tenants.length === 1 ? setup.tenants[0].id : "")} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3">
        <option value="" disabled>Select a saved tenant</option>{setup.tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.display_name} — {tenant.email}</option>)}</select></label>
      <label className="text-sm font-bold">Start date<input name="startDate" type="date" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">End date<input name="endDate" type="date" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /><span className="mt-1 block text-xs font-normal text-slate-500">Leave blank for an ongoing month-to-month tenancy.</span></label>
      <label className="text-sm font-bold">Monthly rent<input name="monthlyRent" type="number" min="0.01" step="0.01" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold">Due day<input name="dueDay" type="number" min="1" max="28" defaultValue="1" required className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <label className="text-sm font-bold xl:col-span-2">Notes<input name="notes" placeholder="e.g. Month-to-month after original 1-year term expired" className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3" /></label>
      <div className="md:col-span-2 xl:col-span-3 flex items-center gap-4"><button disabled={working || setup.units.length === 0 || setup.tenants.length === 0 || !selectedUnitId} className="rounded-xl bg-slate-950 px-5 py-3 font-black text-white disabled:opacity-50">{working ? "Saving…" : "Save draft lease and schedule"}</button>
        {message && <p role="status" className="text-sm font-bold text-slate-700">{message}</p>}</div>
    </form>}
  </section>;
}

function Detail({ label, value }) { return <div><dt className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</dt><dd className="mt-1 break-words font-bold text-slate-800">{value}</dd></div>; }

function LeaseDetail({ lease, unit, schedule, working, onActivate, onSaveSchedule, onCancel }) {
  return <div data-rental-lease-detail>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-black uppercase tracking-wide text-sky-700">Selected lease</p><h3 className="mt-2 text-2xl font-black">{unit?.label || lease.unit_id}</h3></div>
      <span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${STATUS_BADGE_COLORS[lease.status] || "bg-amber-100 text-amber-800"}`}>{lease.status}</span>
    </div>
    <dl className="mt-5 grid gap-4 sm:grid-cols-2">
      <Detail label="Monthly rent" value={money.format(Number(lease.monthly_rent_cents) / 100)} />
      <Detail label="Due day" value={lease.rent_due_day || "Not recorded"} />
      <Detail label="Starts" value={lease.start_date} />
      <Detail label="Ends" value={lease.end_date || "Current"} />
      <Detail label="Property" value={lease.property_id} />
      <Detail label="Lease ID" value={lease.id} />
    </dl>
    {lease.status === "draft" && (schedule ? (
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="button" disabled={working} onClick={() => onActivate(lease)} className="rounded-xl bg-emerald-700 px-5 py-2.5 font-black text-white disabled:opacity-50">{working ? "Activating…" : "Activate lease"}</button>
        <p className="text-xs text-slate-500">Only activate once the lease is actually signed and in effect.</p>
      </div>
    ) : (
      <form onSubmit={(event) => onSaveSchedule(event, lease)} className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
        <p className="text-sm font-bold text-slate-700 sm:col-span-2">No rent schedule yet — confirm billing terms before this lease can be activated.</p>
        <label className="text-sm font-bold">Monthly rent<input name="monthlyRent" type="number" min="0.01" step="0.01" required defaultValue={(Number(lease.monthly_rent_cents) / 100).toFixed(2)} className="mt-1 w-full rounded-lg border p-2" /></label>
        <label className="text-sm font-bold">Due day<input name="dueDay" type="number" min="1" max="28" required defaultValue={lease.rent_due_day || 1} className="mt-1 w-full rounded-lg border p-2" /></label>
        <label className="text-sm font-bold">Effective start<input name="startDate" type="date" required defaultValue={lease.start_date} className="mt-1 w-full rounded-lg border p-2" /></label>
        <label className="text-sm font-bold">Effective end<input name="endDate" type="date" defaultValue={lease.end_date || ""} className="mt-1 w-full rounded-lg border p-2" /></label>
        <button disabled={working} className="rounded-lg bg-slate-950 px-4 py-2 font-bold text-white disabled:opacity-50 sm:col-span-2">{working ? "Saving…" : "Save rent schedule"}</button>
      </form>
    ))}
    {lease.status === "draft" && (
      <div className="mt-4 flex items-center gap-4 border-t border-slate-100 pt-4">
        <button type="button" disabled={working} onClick={() => onCancel(lease)} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-bold text-red-700 hover:border-red-400 disabled:opacity-50">Cancel this lease</button>
        <p className="text-xs text-slate-500">Only cancel a genuine duplicate or one created in error — this is a real record change.</p>
      </div>
    )}
  </div>;
}
