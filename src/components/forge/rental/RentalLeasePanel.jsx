"use client";
import { useCallback, useRef, useState } from "react";
import RentalRecordBrowser from "./RentalRecordBrowser";
import RentalViewFilterBanner from "./RentalViewFilterBanner";
import RentRollImportPanel from "./RentRollImportPanel";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const STATUS_TEXT_COLORS = { active: "text-emerald-700 dark:text-emerald-400", draft: "text-amber-700 dark:text-amber-400", cancelled: "text-slate-400 line-through dark:text-slate-500", ended: "text-slate-400 dark:text-slate-500", terminated: "text-slate-400 dark:text-slate-500" };
const STATUS_BADGE_COLORS = { active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300", draft: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300", cancelled: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400", ended: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400", terminated: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400" };

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

// A lease counts as expiring soon on an active lease whose end date falls
// within the dashboard's 90-day expiring-leases window (inclusive). Used by the
// "expiring" filtered view the dashboard's expiring-leases alert box links to.
export function isLeaseExpiringSoon(lease, today = new Date().toISOString().slice(0, 10)) {
  if (!lease || lease.status !== "active" || !lease.end_date) return false;
  const remaining = Math.ceil((Date.parse(lease.end_date) - Date.parse(today)) / 86_400_000);
  return remaining >= 0 && remaining <= 90;
}

export default function RentalLeasePanel({ initialSetup = { units: [], tenants: [], leases: [], schedules: [], leaseMemberships: [] }, loadOnMount = true, initialShowCreate = null, recordContext = null, initialViewFilter = null }) {
  // Lease setup: stale-while-revalidate under one global key (skipped entirely
  // when loadOnMount is false). The cached setup renders instantly on return
  // visits and refreshes in the background — the last good data never blanks
  // out. Mutations post through /api/rental then call refresh() to revalidate.
  const fetchLeaseSetup = useCallback(async () => {
    const response = await fetch("/api/rental");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load lease setup records.");
    return { units: result.units || [], tenants: result.tenants || [], leases: result.leases || [], schedules: result.schedules || [], leaseMemberships: result.leaseMemberships || [] };
  }, []);
  const { data: loaded, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    loadOnMount ? "rental:lease-setup" : null,
    fetchLeaseSetup,
    { ttlMs: 60_000 },
  );
  const setup = loaded || initialSetup;
  const initialDefaults = deriveLeaseFormDefaults(initialSetup, recordContext);
  // Dashboard deep-link filter ("expiring"): narrows the lease queue to the
  // 90-day expiring window and shows a banner with a one-click clear.
  // Re-syncs on navigation so sidebar navigation (which passes null) clears it.
  const [viewFilter, setViewFilter] = useState(initialViewFilter ?? null);
  // Re-syncs on navigation so sidebar navigation (which passes null) clears
  // the banner. Adjusted during render — not in an effect — so the local
  // "Show all" clear and the navigation prop never fight.
  const prevInitialViewFilter = useRef(initialViewFilter ?? null);
  if (prevInitialViewFilter.current !== (initialViewFilter ?? null)) {
    prevInitialViewFilter.current = initialViewFilter ?? null;
    setViewFilter(initialViewFilter ?? null);
  }
  const visibleLeases = viewFilter === "expiring" ? (setup.leases || []).filter((lease) => isLeaseExpiringSoon(lease)) : (setup.leases || []);
  const contextTenantId = recordContext?.recordType === "tenant" ? recordContext.recordId : null;
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(initialShowCreate ?? initialDefaults.showCreate);
  const [selectedId, setSelectedId] = useState(initialDefaults.selectedId);
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [working, setWorking] = useState(false);
  // Default to the only unit when there is exactly one — adjusted during
  // render, not in an effect, mirroring the viewFilter re-sync above.
  if (!selectedUnitId && setup.units.length === 1) {
    setSelectedUnitId(setup.units[0].id);
  }
  // One-time adoption of the loaded dataset (mirrors the old fetch-on-mount):
  // keep the selection on a real lease and collapse the create form when
  // leases exist. Background refreshes never touch selection or the form.
  // Adjusted during render — not in an effect — mirroring the viewFilter
  // re-sync above; the state once-guard keeps background refreshes from
  // re-adopting.
  const [adoptedSelection, setAdoptedSelection] = useState(false);
  if (loaded && !adoptedSelection) {
    setAdoptedSelection(true);
    const adoptionLeases = loaded.leases || [];
    if (contextTenantId) {
      const defaults = deriveLeaseFormDefaults(loaded, recordContext);
      setShowCreate(defaults.showCreate);
      setSelectedId(defaults.selectedId);
    } else {
      const adoptionPool = viewFilter === "expiring" ? adoptionLeases.filter((lease) => isLeaseExpiringSoon(lease)) : adoptionLeases;
      setSelectedId((current) => adoptionPool.some((item) => item.id === current) ? current : adoptionPool[0]?.id || null);
      setShowCreate(adoptionLeases.length === 0);
    }
  }
  const selectedUnitPropertyId = propertyIdForSelectedUnit(setup.units, selectedUnitId);
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
      await refresh();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function saveEarlyPay(event, schedule) {
    event.preventDefault(); setWorking(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-schedule", schedule: { ...schedule, leaseId: schedule.lease_id,
          amountCents: schedule.amount_cents, currencyCode: schedule.currency_code, dueDay: schedule.due_day,
          effectiveStartDate: schedule.effective_start_date, effectiveEndDate: schedule.effective_end_date,
          collectionMode: schedule.collection_mode, collectionProvider: schedule.collection_provider,
          forgeCutoverDate: schedule.forge_cutover_date, createdAt: schedule.created_at,
          earlyPayDays: Number(form.get("earlyPayDays")) } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save the early pay window.");
      setMessage(`Early pay window saved: ${result.schedule.earlyPayDays ?? 7} days.`);
      await refresh();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function createSchedule(event, lease) {    event.preventDefault(); setWorking(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-schedule", schedule: { leaseId: lease.id, status: "draft",
          amountCents: Math.round(Number(form.get("monthlyRent")) * 100), currencyCode: lease.currency_code || "USD",
          dueDay: Number(form.get("dueDay")), effectiveStartDate: form.get("startDate"), effectiveEndDate: form.get("endDate") || null,
          earlyPayDays: Number(form.get("earlyPayDays") ?? 7) } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save the rent schedule.");
      setMessage(`Rent schedule saved: ${result.schedule.id}. You can now activate this lease.`);
      await refresh();
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
      await refresh();
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

  if (loadOnMount && !loaded && isLoading) return <ForgeLoadingState label="Loading leases and rent schedules…" />;
  if (loadOnMount && !loaded && loadError) {
    return <ForgeErrorState
      title="Unable to load leases and rent schedules"
      detail={loadError}
      onRetry={() => refresh()}
    />;
  }

  return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-rental-lease-setup>
    <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Lease setup</p>
    <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Leases and rent schedules</h2>
    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Review existing leases first. New schedules remain draft until the signed lease is ready. If a tenant is already renting but has no lease on file (their original term expired and was never re-signed, or the record didn&apos;t import), add one below and leave the end date blank for an ongoing month-to-month tenancy.</p>
    {(loaded || initialSetup) && loadError ? <p role="status" className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Could not refresh — showing the last saved setup.</p> : null}
    {(loaded || initialSetup) && isRefreshing ? <p className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p> : null}
    {viewFilter === "expiring" && <RentalViewFilterBanner filterLabel="Leases expiring within 90 days" onClear={() => setViewFilter(null)} />}
    {visibleLeases.length > 0 && <RentalRecordBrowser title="Leases" records={visibleLeases} selectedId={selectedId} onSelect={setSelectedId}
      getTitle={(lease) => setup.units.find((item) => item.id === lease.unit_id)?.label || lease.unit_id}
      getSubtitle={(lease) => <><span className={`font-bold capitalize ${STATUS_TEXT_COLORS[lease.status] || ""}`}>{lease.status}</span> · {money.format(Number(lease.monthly_rent_cents) / 100)} monthly</>}>
      {(() => { const lease = visibleLeases.find((item) => item.id === selectedId) || visibleLeases[0]; const unit = setup.units.find((item) => item.id === lease?.unit_id);
        return lease && <LeaseDetail lease={lease} unit={unit} schedule={(setup.schedules || []).find((item) => item.lease_id === lease.id)} working={working} onActivate={activateLease} onSaveSchedule={createSchedule} onSaveEarlyPay={saveEarlyPay} onCancel={cancelLease} />; })()}
    </RentalRecordBrowser>}
    {(setup.units.length === 0 || setup.tenants.length === 0) && <p role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
      Save at least one rental unit and tenant before creating a lease.</p>}
    {(setup.leases || []).length > 0 && !showCreate && <button type="button" onClick={() => setShowCreate(true)} className={`mt-5 rounded-xl px-5 py-3 text-sm font-black transition ${goldControlClassName}`}>+ Add a lease for an existing tenant</button>}
    <RentRollImportPanel units={setup.units} tenants={setup.tenants} leases={setup.leases} onImported={refresh} />
    {showCreate && <form onSubmit={save} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {(setup.leases || []).length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30 md:col-span-2 xl:col-span-3"><p className="text-sm font-bold text-amber-950 dark:text-amber-200">Other leases already exist. This adds a new one — for a future/replacement term, or to attach a currently-renting tenant who has no lease on file yet.</p><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-amber-500 bg-white px-3 py-2 text-sm font-black text-amber-950 transition hover:bg-amber-50 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-slate-800">Cancel setup</button></div>}
      <label className="text-sm font-bold text-slate-900 dark:text-white">Rental unit<select name="unitId" required value={selectedUnitId} onChange={(event) => setSelectedUnitId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
        <option value="" disabled>Select a saved unit</option>{setup.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label} — {unit.property_id}</option>)}</select></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Property<p className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-950/40 dark:text-slate-300">{selectedUnitPropertyId || "Select a rental unit to set the property."}</p></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Tenant<select name="tenantId" required defaultValue={contextTenantId || (setup.tenants.length === 1 ? setup.tenants[0].id : "")} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
        <option value="" disabled>Select a saved tenant</option>{setup.tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.display_name} — {tenant.email}</option>)}</select></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Start date<input name="startDate" type="date" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">End date<input name="endDate" type="date" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /><span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">Leave blank for an ongoing month-to-month tenancy.</span></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Monthly rent<input name="monthlyRent" type="number" min="0.01" step="0.01" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Due day<input name="dueDay" type="number" min="1" max="28" defaultValue="1" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white xl:col-span-2">Notes<input name="notes" placeholder="e.g. Month-to-month after original 1-year term expired" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
      <div className="md:col-span-2 xl:col-span-3 flex items-center gap-4"><button disabled={working || setup.units.length === 0 || setup.tenants.length === 0 || !selectedUnitId} className={`rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>{working ? "Saving…" : "Save draft lease and schedule"}</button>
        {message && <p role="status" className="text-sm font-bold text-slate-700 dark:text-slate-300">{message}</p>}</div>
    </form>}
  </section>;
}

function Detail({ label, value }) { return <div><dt className="text-xs font-black uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</dt><dd className="mt-1 break-words font-bold text-slate-800 dark:text-slate-200">{value}</dd></div>; }

function LeaseDetail({ lease, unit, schedule, working, onActivate, onSaveSchedule, onCancel, onSaveEarlyPay }) {
  return <div data-rental-lease-detail>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">Selected lease</p><h3 className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{unit?.label || lease.unit_id}</h3></div>
      <span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${STATUS_BADGE_COLORS[lease.status] || "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300"}`}>{lease.status}</span>
    </div>
    <dl className="mt-5 grid gap-4 sm:grid-cols-2">
      <Detail label="Monthly rent" value={money.format(Number(lease.monthly_rent_cents) / 100)} />
      <Detail label="Due day" value={lease.rent_due_day || "Not recorded"} />
      <Detail label="Starts" value={lease.start_date} />
      <Detail label="Ends" value={lease.end_date || "Current"} />
      <Detail label="Property" value={lease.property_id} />
      <Detail label="Lease ID" value={lease.id} />
    </dl>
    {schedule && (
      <form onSubmit={(event) => onSaveEarlyPay(event, schedule)} className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40">
        <label className="text-sm font-bold text-slate-900 dark:text-white">Early pay window (days)<input name="earlyPayDays" type="number" min="0" max="31" required defaultValue={schedule.early_pay_days ?? 7} className="mt-1 w-24 rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <button disabled={working} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">{working ? "Saving…" : "Save"}</button>
        <p className="w-full text-xs text-slate-500 dark:text-slate-400">How many days before the due date next month&apos;s rent appears for the tenant to pay early. 0 = only after the month starts.</p>
      </form>
    )}
    {lease.status === "draft" && (schedule ? (
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="button" disabled={working} onClick={() => onActivate(lease)} className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-black text-white transition hover:bg-emerald-800 disabled:opacity-50">{working ? "Activating…" : "Activate lease"}</button>
        <p className="text-xs text-slate-500 dark:text-slate-400">Only activate once the lease is actually signed and in effect.</p>
      </div>
    ) : (
      <form onSubmit={(event) => onSaveSchedule(event, lease)} className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40 sm:grid-cols-2">
        <p className="text-sm font-bold text-slate-700 dark:text-slate-300 sm:col-span-2">No rent schedule yet — confirm billing terms before this lease can be activated.</p>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Monthly rent<input name="monthlyRent" type="number" min="0.01" step="0.01" required defaultValue={(Number(lease.monthly_rent_cents) / 100).toFixed(2)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Due day<input name="dueDay" type="number" min="1" max="28" required defaultValue={lease.rent_due_day || 1} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Early pay window (days)<input name="earlyPayDays" type="number" min="0" max="31" defaultValue={7} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Effective start<input name="startDate" type="date" required defaultValue={lease.start_date} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Effective end<input name="endDate" type="date" defaultValue={lease.end_date || ""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <button disabled={working} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300 sm:col-span-2">{working ? "Saving…" : "Save rent schedule"}</button>
      </form>
    ))}
    {lease.status === "draft" && (
      <div className="mt-4 flex items-center gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
        <button type="button" disabled={working} onClick={() => onCancel(lease)} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-bold text-red-700 transition hover:border-red-400 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30">Cancel this lease</button>
        <p className="text-xs text-slate-500 dark:text-slate-400">Only cancel a genuine duplicate or one created in error — this is a real record change.</p>
      </div>
    )}
  </div>;
}
