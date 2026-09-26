"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import RentalRecordBrowser from "./RentalRecordBrowser";
import RentalRecordActions, { labelRentalRecordContext } from "./RentalRecordActions";
import RentalPhotoUpload from "./RentalPhotoUpload";
import PropertyExpenseHistory, { PROPERTY_EXPENSES_OPEN_EVENT } from "./PropertyExpenseHistory";
import PropertyLedgerPage from "./PropertyLedgerPage";
import RentalViewFilterBanner from "./RentalViewFilterBanner";
import { useCardContextMenu, CardContextMenu } from "./CardContextMenu";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";
import StructuredAddressFields from "./StructuredAddressFields";
import { addressOfUnit, formatAddress, validateAddressFields } from "@/lib/address/validateAddress";

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

// A unit is vacant when it has no active lease on file -- i.e. there is no
// tenant label for it. Used by the "vacant" filtered view the dashboard's
// vacancy alert box deep-links to.
export function isUnitVacant(unit, leases, leaseMemberships, tenants) {
  return tenantLabelForUnit(unit, leases, leaseMemberships, tenants) === null;
}

export default function RentalSetupPanel({ initialUnits = [], onNavigate: navigate, initialViewFilter = null }) {
  // Rental units: stale-while-revalidate. The cached units render instantly on
  // return visits and refresh in the background — the last good data never
  // blanks out. Mutations post through /api/rental then call refresh() to
  // revalidate. Archive/delete confirmations are preserved unchanged.
  const fetchSetup = useCallback(async () => {
    const response = await fetch("/api/rental");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load rental units.");
    return result;
  }, []);
  const { data: loaded, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    "rental:setup",
    fetchSetup,
    { ttlMs: 60_000 },
  );
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(initialUnits.length === 0);
  const [selectedId, setSelectedId] = useState(initialUnits[0]?.id || null);
  // Dashboard deep-link filter ("vacant"): narrows the unit queue and shows a
  // banner with a one-click clear. Re-syncs whenever navigation passes a new
  // filter in, so sidebar navigation (which passes null) always clears it.
  const [viewFilter, setViewFilter] = useState(initialViewFilter ?? null);
  // Re-syncs on navigation so sidebar navigation (which passes null) clears
  // the banner. Adjusted during render — not in an effect — so the local
  // "Show all" clear and the navigation prop never fight.
  const prevInitialViewFilter = useRef(initialViewFilter ?? null);
  if (prevInitialViewFilter.current !== (initialViewFilter ?? null)) {
    prevInitialViewFilter.current = initialViewFilter ?? null;
    setViewFilter(initialViewFilter ?? null);
  }
  const [working, setWorking] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [archiveCandidateId, setArchiveCandidateId] = useState(null);
  const [addressErrors, setAddressErrors] = useState({});
  const { menu: contextMenu, onContextMenu, close: closeContextMenu } = useCardContextMenu();
  const [ledgerUnit, setLedgerUnit] = useState(null);
  const openFullExpenses = useCallback((unit) => {
    window.dispatchEvent(new CustomEvent(PROPERTY_EXPENSES_OPEN_EVENT, { detail: { propertyId: unit?.property_id } }));
  }, []);
  // Adopt freshly fetched data the same way the original mount fetch did:
  // keep the current selection when still active, otherwise select the first
  // active unit; show the create form only when everything is inactive.
  // The adoption is deferred to a microtask so it runs outside the effect
  // body, exactly like the original fetch .then() handler did.
  useEffect(() => {
    if (!loaded) return undefined;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const nextUnits = loaded.units || [];
      const nextLeases = loaded.leases || [];
      const nextMemberships = loaded.leaseMemberships || [];
      const nextTenants = loaded.tenants || [];
      const pool = viewFilter === "vacant"
        ? nextUnits.filter((unit) => unit.status !== "inactive" && isUnitVacant(unit, nextLeases, nextMemberships, nextTenants))
        : nextUnits.filter((unit) => unit.status !== "inactive");
      setSelectedId((current) => pool.some((item) => item.id === current) ? current : pool[0]?.id || null);
      setShowCreate(nextUnits.every((item) => item.status === "inactive"));
    });
    return () => { cancelled = true; };
  }, [loaded, viewFilter]);
  const seed = initialUnits.length > 0 ? { units: initialUnits, leases: [], leaseMemberships: [], tenants: [], openCharges: [] } : null;
  const result = loaded || seed;
  const units = result?.units || [];
  const leases = result?.leases || [];
  const leaseMemberships = result?.leaseMemberships || [];
  const tenants = result?.tenants || [];
  const openCharges = result?.openCharges || [];
  const onNavigate = (target, context) => navigate?.(target, labelRentalRecordContext(context, units, "label"));
  // The filtered view narrows the queue the record browser shows: the "vacant"
  // deep-link from the dashboard's vacancy alert box lists only units with no
  // active lease, so the queue behind the count is exactly what the box showed.
  const visibleUnits = viewFilter === "vacant"
    ? units.filter((unit) => unit.status !== "inactive" && isUnitVacant(unit, leases, leaseMemberships, tenants))
    : units.filter((unit) => unit.status !== "inactive");
  const refreshUnits = refresh;
  // The panel eyebrow follows the currently selected unit instead of naming a
  // hardcoded sample property -- the old "Kent Avenue setup" text shipped from
  // a fixture and was wrong for every other property.
  const selectedUnit = visibleUnits.find((item) => item.id === selectedId) || visibleUnits[0] || null;
  const setupEyebrow = selectedUnit ? `${selectedUnit.label || selectedUnit.property_id} setup` : "Rental setup";

  if (!result && isLoading) return <ForgeLoadingState label="Loading rental units…" />;
  if (!result && loadError) return <ForgeErrorState title="Unable to load rental units" detail={loadError} onRetry={() => refresh()} />;

  async function saveUnit(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const existing = units.find((item) => item.id === values.get("id"));
    const addressCheck = validateAddressFields({
      street: values.get("addressStreet"), unit: values.get("addressUnit"), city: values.get("addressCity"),
      state: values.get("addressState"), zip: values.get("addressZip"),
    }, { allowEmptyGroup: Boolean(existing) });
    if (!addressCheck.ok) {
      setAddressErrors(addressCheck.errors);
      setMessage(`Fix the property address: ${Object.values(addressCheck.errors).join(" ")}`);
      return;
    }
    setAddressErrors({});
    const action = existing
      ? `Save changes to ${existing.label}?`
      : `Create a new property/unit named ${values.get("label")} (${values.get("propertyId")})? This creates a separate record; it does not edit an existing property.`;
    if (!window.confirm(action)) return;
    setWorking(true); setMessage("");
    try {
      const saved = await submit("save-unit", "unit", { id: values.get("id") || undefined, propertyId: values.get("propertyId"), label: values.get("label"),
        status: existing?.status || "preparing", bedrooms: Number(values.get("bedrooms")) || null, bathrooms: Number(values.get("bathrooms")) || null,
        squareFeet: Number(values.get("squareFeet")) || null, notes: values.get("notes") || null,
        addressStreet: addressCheck.values.street || null, addressUnit: addressCheck.values.unit || null,
        addressCity: addressCheck.values.city || null, addressState: addressCheck.values.state || null,
        addressZip: addressCheck.values.zip || null,
        availableAt: existing?.available_at || null, createdAt: existing?.created_at || undefined });
      setMessage(`Unit saved: ${saved.unit.label} — ID: ${saved.unit.id}`);
      setShowCreate(false); setEditingId(null);
      await refreshUnits();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function archiveUnit(unit) {
    setWorking(true); setMessage("");
    try {
      await submit("archive-unit", "unitId", unit.id);
      setMessage(`${unit.label} archived. Financial and lease history was preserved.`);
      setArchiveCandidateId(null);
      await refreshUnits();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function permanentlyDeleteUnit(unit) {
    const typed = window.prompt(`Permanently delete ${unit.label}? Type the exact property/unit name to confirm. This cannot be undone.`);
    if (typed !== unit.label) { if (typed !== null) setMessage("Permanent deletion cancelled: the name did not match."); return; }
    setWorking(true); setMessage("");
    try {
      await submit("delete-archived-unit", "unitId", unit.id);
      setMessage(`${unit.label} was permanently deleted.`);
      await refreshUnits();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-rental-setup>
      {ledgerUnit ? (
        <PropertyLedgerPage propertyId={ledgerUnit.property_id} propertyLabel={ledgerUnit.label}
          onClose={() => setLedgerUnit(null)}
          onPostIncome={() => { /* slice 2: post income form */ }}
          onPostExpense={() => { /* slice 2: post expense form */ }} />
      ) : (
      <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl"><p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">{setupEyebrow}</p>
          <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Rental units</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Review saved units first. Create another unit only as a deliberate action.</p></div>
        {units.length > 0 && !showCreate && <button type="button" onClick={() => { setShowCreate(true); setAddressErrors({}); }} className={`shrink-0 rounded-xl px-5 py-3 text-sm font-black transition ${goldControlClassName}`}>+ Add a new property / unit</button>}
      </div>
      {viewFilter === "vacant" && <RentalViewFilterBanner filterLabel="Vacant units only" onClear={() => setViewFilter(null)} />}
      {result && loadError ? <p role="status" className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Could not refresh — showing the last saved units.</p> : null}
      {result && isRefreshing ? <p className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p> : null}
      {units.length > 0 && !showCreate && <RentalRecordBrowser title="Rental properties" records={visibleUnits} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setEditingId(null); setArchiveCandidateId(null); }} getThumbnail={(unit) => unit.photo_url} listSize="wide"
        columns={[
          { header: "Property address", render: (unit) => { const structured = formatAddress(addressOfUnit(unit)); return <><strong className="block text-sm text-slate-950 dark:text-white">{unit.label}</strong>{structured ? <span className="mt-1 block text-xs font-bold text-slate-700 dark:text-slate-300">{structured}</span> : null}<span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{unit.property_id} · {unit.status || "Status not set"}</span></>; } },
          { header: "Tenant", render: (unit) => { const tenantLabel = tenantLabelForUnit(unit, leases, leaseMemberships, tenants); return tenantLabel || <button type="button" onClick={(event) => { event.stopPropagation(); onNavigate?.("tenants", { recordType: "unit", recordId: unit.id, propertyId: unit.property_id, openCreateTenant: true }); }} className="font-black text-sky-700 underline decoration-2 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-200">Add tenant</button>; } },
          { header: "Active balance", render: (unit) => { const balanceCents = activeBalanceCentsForUnit(unit, leases, openCharges); return balanceCents === null
            ? <span className="text-slate-500 dark:text-slate-400">—</span>
            : <strong className={balanceCents > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}>{money.format(balanceCents / 100)}</strong>; } },
        ]}>
        {(() => {
          const unit = visibleUnits.find((item) => item.id === selectedId) || visibleUnits[0];
          const context = { recordType: "unit", recordId: unit?.id, propertyId: unit?.property_id };
          return unit && <div data-rental-unit-detail
            onContextMenu={(event) => onContextMenu(event, [
              { label: "View Ledger", onSelect: () => setLedgerUnit(unit) },
              { label: "Open full expenses ledger", onSelect: () => openFullExpenses(unit) },
            ])}
            title="Right-click for ledger options">
            <CardContextMenu menu={contextMenu} onClose={closeContextMenu} />
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">Selected unit</p><h3 className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{unit.label}</h3></div>
              <RentalRecordActions label="Property actions" actions={[{label:"View ledger",onSelect:()=>setLedgerUnit(unit)},{label:"Edit property details",onSelect:()=>{setArchiveCandidateId(null);setEditingId(unit.id);setAddressErrors({});}},{label:"Manage lease",onSelect:()=>onNavigate?.("leases",context)},{label:"Rent & payments",onSelect:()=>onNavigate?.("charges",context)},{label:"Financial setup",onSelect:()=>onNavigate?.("financial-setup",context)},{label:"Work orders",onSelect:()=>onNavigate?.("maintenance",context)},{label:"Inspections",onSelect:()=>onNavigate?.("inspections",context)},{label:"File library",onSelect:()=>onNavigate?.("documents",context)},{label:"Archive duplicate / inactive property",destructive:true,onSelect:()=>{setEditingId(null);setArchiveCandidateId(unit.id);}}]}/>
            </div>
            <div className="mt-4"><RentalPhotoUpload entityType="unit" entityId={unit.id} photoUrl={unit.photo_url} onUploaded={refreshUnits} /></div>
            <PropertyExpenseHistory key={unit.id} propertyId={unit.property_id} propertyLabel={unit.label} />
            {archiveCandidateId === unit.id ? <div className="mt-5 rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30"><p className="font-black text-red-900 dark:text-red-200">Archive {unit.label}?</p><p className="mt-2 text-sm text-red-800 dark:text-red-300">This removes the property/unit from active lists but preserves its financial, lease, and audit history. A property with an active lease cannot be archived.</p><div className="mt-3 flex gap-2"><button type="button" disabled={working} onClick={() => archiveUnit(unit)} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white">Confirm archive</button><button type="button" onClick={() => setArchiveCandidateId(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold dark:border-slate-600 dark:text-slate-300">Cancel</button></div></div>
              : editingId===unit.id ? <UnitEditForm unit={unit} working={working} onCancel={()=>setEditingId(null)} onSave={saveUnit} addressErrors={addressErrors}/>
              : <dl className="mt-5 grid gap-4 sm:grid-cols-2"><Detail label="Property" value={unit.property_id} /><Detail label="Status" value={unit.status || "Not set"} /><Detail label="Address" value={formatAddress(addressOfUnit(unit)) || "Not recorded"} /><Detail label="Bedrooms" value={unit.bedrooms ?? "Not recorded"} /><Detail label="Bathrooms" value={unit.bathrooms ?? "Not recorded"} /><Detail label="Square feet" value={unit.square_feet ?? "Not recorded"} /><Detail label="Notes" value={unit.notes || "No notes"} /></dl>}
          </div>;
        })()}
      </RentalRecordBrowser>}
      {showCreate && <form className="mt-6 grid max-w-4xl gap-4 rounded-2xl border-2 border-sky-500 bg-sky-50 p-5 dark:border-sky-700 dark:bg-sky-950/30 md:grid-cols-2" onSubmit={saveUnit}>
        <div className="md:col-span-2"><h3 className="text-xl font-black text-slate-950 dark:text-white">Create a new property / unit</h3><p className="mt-1 text-sm font-bold text-sky-900 dark:text-sky-200">You are creating a separate record—not editing the property you previously selected. Review the name and property ID before continuing.</p></div>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Property ID<input name="propertyId" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Unit label<input name="label" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <StructuredAddressFields required idPrefix="create-address" externalErrors={addressErrors} />
        <label className="text-sm font-bold text-slate-900 dark:text-white">Bedrooms<input name="bedrooms" type="number" min="0" step="1" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Bathrooms<input name="bathrooms" type="number" min="0" step="0.5" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Square feet<input name="squareFeet" type="number" min="0" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Notes<input name="notes" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
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
      </>
      )}
    </section>
  );
}

function Detail({ label, value }) { return <div><dt className="text-xs font-black uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</dt><dd className="mt-1 font-bold text-slate-800 dark:text-slate-200">{value}</dd></div>; }
function UnitEditForm({unit,working,onCancel,onSave,addressErrors}){return <form aria-label={`Edit ${unit.label}`} onSubmit={onSave} className="mt-5 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40 sm:grid-cols-2"><input type="hidden" name="id" value={unit.id}/><input type="hidden" name="propertyId" value={unit.property_id}/><label className="text-sm font-bold text-slate-900 dark:text-white">Unit label<input name="label" defaultValue={unit.label} required className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label><StructuredAddressFields key={unit.id} idPrefix={`edit-address-${unit.id}`} className="sm:col-span-2" initialValues={addressOfUnit(unit)} externalErrors={addressErrors}/><label className="text-sm font-bold text-slate-900 dark:text-white">Bedrooms<input name="bedrooms" type="number" min="0" defaultValue={unit.bedrooms??""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label><label className="text-sm font-bold text-slate-900 dark:text-white">Bathrooms<input name="bathrooms" type="number" min="0" step="0.5" defaultValue={unit.bathrooms??""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label><label className="text-sm font-bold text-slate-900 dark:text-white">Square feet<input name="squareFeet" type="number" min="0" defaultValue={unit.square_feet??""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label><label className="text-sm font-bold text-slate-900 dark:text-white sm:col-span-2">Notes<input name="notes" defaultValue={unit.notes||""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label><div className="flex gap-2 sm:col-span-2"><button disabled={working} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">Save changes</button><button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button></div></form>}
