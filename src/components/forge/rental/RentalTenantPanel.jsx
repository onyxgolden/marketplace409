"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import RentalRecordBrowser from "./RentalRecordBrowser";
import RentalRecordActions, { labelRentalRecordContext } from "./RentalRecordActions";
import RentalPhotoUpload from "./RentalPhotoUpload";
import TenantPaymentHistory from "./TenantPaymentHistory";
import CustomFieldsEditor from "./CustomFieldsEditor";
import NoticeLogList from "./NoticeLogList";
import TenantLedgerPage from "./TenantLedgerPage";
import { useCardContextMenu, CardContextMenu, CARD_REGION_ATTRIBUTE } from "./CardContextMenu";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeLoadingState } from "@/components/forge/ForgeStates";
import { PAYMENT_POLICIES, paymentPolicyDescription, paymentPolicyLabel } from "@/domains/rental-payment/paymentPolicy";
import { useRentalTerminology } from "./rentalTerminologyContext";

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

export function tenantHouseholdForSelection(selectedTenant, tenants, leases, leaseMemberships, units) {
  if (!selectedTenant) return { lease: null, unit: null, primaryTenant: null, coTenants: [] };
  const memberships = leaseMemberships.filter((item) => item.tenant_id === selectedTenant.id);
  const lease = leases.find((item) => item.status === "active" && memberships.some((membership) => membership.lease_id === item.id))
    || leases.find((item) => memberships.some((membership) => membership.lease_id === item.id)) || null;
  if (!lease) return { lease: null, unit: null, primaryTenant: selectedTenant, coTenants: [] };
  const householdMemberships = leaseMemberships.filter((item) => item.lease_id === lease.id);
  const primaryMembership = householdMemberships.find((item) => item.occupancy_role === "primary") || householdMemberships[0];
  const primaryTenant = tenants.find((item) => item.id === primaryMembership?.tenant_id) || selectedTenant;
  const coTenants = householdMemberships.filter((item) => item.tenant_id !== primaryTenant.id)
    .map((item) => tenants.find((tenant) => tenant.id === item.tenant_id)).filter(Boolean);
  return { lease, unit: units.find((item) => item.id === lease.unit_id) || null, primaryTenant, coTenants };
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function tenantInviteLabel(tenant) {
  // The lifecycle `status` column is stamped "invited" at creation, before any
  // email goes out — it must never be shown as the invite state. Derive the
  // label from what actually happened: portal claimed, invite email sent, or
  // nothing yet.
  if (tenant?.auth_user_id) return "Portal claimed";
  if (tenant?.invited_at) return `Invite sent ${new Date(tenant.invited_at).toLocaleDateString()}`;
  return "Invite not sent";
}

export default function RentalTenantPanel({ initialTenants = [], onNavigate: navigate, recordContext = null }) {
  // R25 terminology: panel headings resolve through the workspace term map.
  const { termLabel } = useRentalTerminology();
  const [message, setMessage] = useState("");
  const openCreateTenant = recordContext?.openCreateTenant === true;
  // Master tenant dataset: stale-while-revalidate under one global key. The panel
  // renders `initialTenants` (or the last cached payload) immediately and refreshes
  // in the background — switching away and back never blanks the tenant list.
  // Mutations post through /api/rental then call refresh() to revalidate.
  const fetchRentalMaster = useCallback(async () => {
    const response = await fetch("/api/rental");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load tenants.");
    return result;
  }, []);
  const { data, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    "rental:tenants",
    fetchRentalMaster,
    { ttlMs: 60_000 },
  );
  const tenants = data?.tenants ?? initialTenants;
  const leases = data?.leases || [];
  const leaseMemberships = data?.leaseMemberships || [];
  const units = data?.units || [];
  const openCharges = data?.openCharges || [];
  const [showCreate, setShowCreate] = useState(openCreateTenant || initialTenants.length === 0);
  const [selectedId, setSelectedId] = useState(initialTenants[0]?.id || null);
  const [working, setWorking] = useState(false);
  // In-app delete confirmation (replaces the native window.confirm): the dialog
  // below is part of the DOM, so it is visible and clickable in every browser —
  // including automated ones that auto-dismiss native dialogs, which previously
  // made the "Delete unused duplicate" button appear completely dead.
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const { menu: contextMenu, onContextMenu, openAt: openContextMenuAt, close: closeContextMenu } = useCardContextMenu();
  // One-time adoption of the loaded dataset (mirrors the old fetch-on-mount): pick
  // the first tenant when nothing is selected yet, and collapse the create form
  // when tenants exist. Background refreshes never touch selection or the form.
  const adoptedInitial = useRef(false);
  useEffect(() => {
    if (!data || adoptedInitial.current) return;
    adoptedInitial.current = true;
    setSelectedId((current) => current || data.tenants?.[0]?.id || null);
    setShowCreate(openCreateTenant || (data.tenants?.length || 0) === 0);
  }, [data, openCreateTenant]);
  // Full-page ledger state: { tenant, initialView } where initialView is null |
  // "post-income" | "print". Rendered full-page below, replacing the card surface.
  const [ledgerTenant, setLedgerTenant] = useState(null);
  const openFullLedger = useCallback((tenant, initialView = null) => {
    closeContextMenu();
    if (tenant?.id) setLedgerTenant({ tenant, initialView });
  }, [closeContextMenu]);
  const onNavigate = useCallback((target, context) => navigate?.(target, labelRentalRecordContext(context, tenants, "display_name")), [navigate, tenants]);
  // Rentec's triple-redundant ledger access: right-click menu, ⋮ button, and the
  // balance itself as a link — every path opens the same full-page ledger.
  // Row right-click (Brandy's workflow): View Ledger, Tenant Details, View Property,
  // Post Income, Post Charge, Print Statement.
  const tenantMenuItems = useCallback((tenant, context) => {
    if (!tenant) return [];
    const items = [
      { label: "View Ledger", onSelect: () => openFullLedger(tenant) },
      { label: "Tenant Details", onSelect: () => setSelectedId(tenant.id) },
    ];
    const leaseIds = leaseMemberships.filter((membership) => membership.tenant_id === tenant.id).map((membership) => membership.lease_id);
    const lease = leases.find((item) => leaseIds.includes(item.id) && item.status === "active")
      || leases.find((item) => leaseIds.includes(item.id));
    const unit = units.find((item) => item.id === lease?.unit_id);
    if (unit) {
      items.push({ label: "View Property", onSelect: () => onNavigate("setup", { recordType: "property", recordId: unit.id, recordLabel: unit.label }) });
    }
    items.push(
      { label: "Post Income", onSelect: () => openFullLedger(tenant, "post-income") },
      { label: "Post Charge", onSelect: () => onNavigate("charges", context) },
      { label: "Print Statement", onSelect: () => openFullLedger(tenant, "print") },
    );
    return items;
  }, [openFullLedger, onNavigate, leases, leaseMemberships, units]);
  const openTenantMenuBelow = useCallback((buttonElement, tenant, context) => {
    const rect = buttonElement?.getBoundingClientRect?.();
    openContextMenuAt(rect ? rect.left : 120, rect ? rect.bottom + 6 : 120, tenantMenuItems(tenant, context));
  }, [openContextMenuAt, tenantMenuItems]);
  // Mutations revalidate the cached master dataset; selection is preserved because
  // refresh() never blanks the list.
  async function save(event) {
    event.preventDefault(); setWorking(true); setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-tenant", tenant: { displayName: form.get("displayName"),
          email: form.get("email"), phone: form.get("phone") || null, status: "invited" } }) });
      const result = await response.json();
      if (!response.ok) {
        if (result.existingTenant?.id) { setSelectedId(result.existingTenant.id); setShowCreate(false); }
        throw new Error(result.error || "Unable to save tenant.");
      }
      const savedId = result.tenant.id;
      formElement.reset();
      await refresh();
      setSelectedId(savedId);
      setShowCreate(false);
      setMessage(`New tenant added: ${result.tenant.displayName}. The saved tenant is open below.`);
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function deleteUnusedTenant(tenant) {
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "delete-unused-tenant", tenantId: tenant.id, confirmation: "DELETE" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to delete the unused tenant.");
      await refresh();
      setMessage(`Deleted unused duplicate: ${result.deletedTenant.display_name}.`);
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  function cancelDeleteTarget() { setDeleteTarget(null); setDeleteConfirmText(""); }
  async function confirmDeleteTarget() {
    const target = deleteTarget;
    cancelDeleteTarget();
    if (target) await deleteUnusedTenant(target);
  }
  async function updateEmail(event, tenantId) {
    event.preventDefault(); setWorking(true); setMessage(""); const form = new FormData(event.currentTarget);
    try { const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "update-tenant-email", tenantId, email: form.get("portalEmail") }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to update tenant email.");
      setMessage(`Portal email updated for ${result.tenant.display_name}.`); await refresh();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  // Join-up invite: one explicit owner action per tenant. The button disables
  // the instant it is pressed (shared `working` state) and the server sends
  // with a per-day idempotency key, so a double click cannot send twice.
  async function sendInviteEmail(tenant, leaseId) {
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "send-tenant-invite", tenantId: tenant.id, leaseId: leaseId || null }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to send the invite email.");
      setMessage(`Invite email sent to ${tenant.display_name} (${tenant.email}).`);
      await refresh();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function updateProfile(event, tenantId) {
    event.preventDefault(); setWorking(true); setMessage(""); const form = new FormData(event.currentTarget);
    const dollars = form.get("monthlyIncome");
    // FORGE does not collect tenant birth dates -- there is deliberately no dateOfBirth field here.
    const profile = { phone: form.get("phone"), workPhone: form.get("workPhone"),
      employerName: form.get("employerName"), employerPhone: form.get("employerPhone"),
      monthlyIncomeCents: dollars ? Math.round(Number(dollars) * 100) : null,
      emergencyContactName: form.get("emergencyContactName"), emergencyContactPhone: form.get("emergencyContactPhone"),
      applicationStatus: form.get("applicationStatus"), applicationSubmittedAt: form.get("applicationSubmittedAt"),
      screeningProvider: form.get("screeningProvider"), screeningReference: form.get("screeningReference"),
      screeningStatus: form.get("screeningStatus"), screeningCompletedAt: form.get("screeningCompletedAt"),
      ssnLastFour: form.get("ssnLastFour"), landlordNotes: form.get("landlordNotes") };
    try { const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "update-tenant-profile", tenantId, profile }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to update tenant profile.");
      setMessage(`Tenant information updated for ${result.tenant.display_name}.`); await refresh();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function makePrimary(leaseId, tenantId) {
    setWorking(true); setMessage("");
    try { const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "set-primary-tenant", leaseId, tenantId }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to change the primary tenant.");
      setMessage("Primary tenant updated."); await refresh();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  // Per-tenant late-fee override: exempt, or per-field overrides of the
  // portfolio default. Saving with every field blank clears the override.
  async function saveLateFeeOverride(event, tenantId, clear) {
    event.preventDefault(); setWorking(true); setMessage("");
    let payload;
    if (clear) {
      payload = { tenantId, exempt: false };
    } else {
      const form = new FormData(event.currentTarget);
      payload = { tenantId,
        exempt: form.get("overrideExempt") === "on",
        graceDays: form.get("overrideGraceDays") || null,
        calculationType: form.get("overrideCalculationType") || null,
        fixedAmountCents: form.get("overrideFixedAmount") ? Math.round(Number(form.get("overrideFixedAmount")) * 100) : null,
        percentageBasisPoints: form.get("overridePercentage") ? Math.round(Number(form.get("overridePercentage")) * 100) : null,
        maximumAmountCents: form.get("overrideMaximumAmount") ? Math.round(Number(form.get("overrideMaximumAmount")) * 100) : null };
    }
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-late-fee-tenant-override", override: payload }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to save the late-fee override.");
      setMessage(result.override ? `Late-fee override saved.` : `Late-fee override cleared — the portfolio default applies.`);
      await refresh();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  // Per-tenant payment-policy override (R11): a single policy that beats the
  // portfolio default; saving "inherit" (blank) clears it.
  async function savePaymentPolicyOverride(event, tenantId, clear) {
    event.preventDefault(); setWorking(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const policy = clear ? "inherit" : (form.get("overridePaymentPolicy") || "inherit");
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-payment-policy-tenant-override", override: { tenantId, policy } }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to save the payment policy override.");
      setMessage(result.override ? "Payment policy override saved." : "Payment policy override cleared — the portfolio default applies.");
      await refresh();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  // Full-page ledger replaces the entire panel surface — Rentec-style, no cramped card.
  if (ledgerTenant?.tenant) {
    const ledgered = ledgerTenant.tenant;
    return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-rental-tenant-setup>
      <TenantLedgerPage tenantId={ledgered.id} tenantName={ledgered.display_name}
        unitLabel={propertyLabelForTenant(ledgered, leases, leaseMemberships, units)}
        initialView={ledgerTenant.initialView} onClose={() => setLedgerTenant(null)}
        onOpenPropertyLedger={(propertyKey, propertyLabel) => onNavigate("setup", { recordType: "property", recordId: propertyKey, recordLabel: propertyLabel })}
        onOpenBankLedger={() => navigate?.("bank-ledger")} />
    </section>;
  }
  return <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-rental-tenant-setup>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">{termLabel("tenant", { capitalize: true })} setup</p>
        <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-white">{termLabel("tenant", { plural: true, capitalize: true })}</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Review saved tenants first. Creation remains separate from portal access and lease assignment.</p></div>
      {tenants.length > 0 && !showCreate && <button type="button" onClick={() => setShowCreate(true)} className={`shrink-0 rounded-xl px-5 py-3 text-sm font-black transition ${goldControlClassName}`}>+ Add a new tenant</button>}
    </div>
    {message && <p role="status" className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-bold text-slate-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-slate-200">{message}</p>}
    {isLoading && <div className="mt-4"><ForgeLoadingState label="Loading tenants…" /></div>}
    {isRefreshing && tenants.length > 0 && <p className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p>}
    {loadError && !data && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{loadError}</p>}
    {tenants.length > 0 && <RentalRecordBrowser title="Tenants" records={tenants} selectedId={selectedId} onSelect={setSelectedId} getThumbnail={(tenant) => tenant.photo_url} listSize="wide"
      onRowContextMenu={(event, tenant) => {
        // Rentec behavior: right-click selects the row, then opens the menu.
        setSelectedId(tenant.id);
        onContextMenu(event, tenantMenuItems(tenant, { recordType: "tenant", recordId: tenant.id }));
      }}
      columns={[
        { header: "Tenant", render: (tenant) => <strong className="block truncate text-sm text-slate-950 dark:text-white">{tenant.display_name}</strong> },
        { header: "Email", render: (tenant) => <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{tenant.email}</span> },
        { header: "Invite", render: (tenant) => <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{tenantInviteLabel(tenant)}</span> },
        { header: "Property", render: (tenant) => { const leaseIds = leaseMemberships.filter((membership) => membership.tenant_id === tenant.id).map((membership) => membership.lease_id); const lease = leases.find((item) => leaseIds.includes(item.id) && item.status === "active") || leases.find((item) => leaseIds.includes(item.id)); const unit = units.find((item) => item.id === lease?.unit_id); const propertyLabel = propertyLabelForTenant(tenant, leases, leaseMemberships, units);
          if (!propertyLabel) return <span className="font-bold text-red-600 dark:text-red-400">No active lease</span>;
          return unit
            ? <button type="button" onClick={(event) => { event.stopPropagation(); onNavigate("setup", { recordType: "property", recordId: unit.id, recordLabel: unit.label }); }} title={`View property ${unit.label}`} className="block truncate text-left font-bold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300">{propertyLabel}</button>
            : <span className="block truncate">{propertyLabel}</span>; } },
        { header: "Status", render: (tenant) => { const leaseIds = leaseMemberships.filter((membership) => membership.tenant_id === tenant.id).map((membership) => membership.lease_id); const movedIn = leases.some((lease) => leaseIds.includes(lease.id) && lease.status === "active"); return movedIn
          ? <span className="font-bold text-emerald-700 dark:text-emerald-400">Moved In</span>
          : <span className="font-bold text-slate-500 dark:text-slate-400">Inactive</span>; } },
        { header: "Active balance", align: "right", render: (tenant) => { const balanceCents = activeBalanceCentsForTenant(tenant, leases, leaseMemberships, openCharges); return balanceCents === null
          ? <span className="text-slate-500 dark:text-slate-400">—</span>
          : <button type="button" onClick={() => openFullLedger(tenant)}
              title={`View the full ledger for ${tenant.display_name}`}
              aria-label={`View the full ledger for ${tenant.display_name} — balance ${money.format(balanceCents / 100)}`}
              className="underline decoration-dotted underline-offset-4 hover:opacity-80">
              <strong className={balanceCents > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}>{money.format(balanceCents / 100)}</strong>
            </button>; } },
      ]}>
      {(() => { const selected = tenants.find((item) => item.id === selectedId) || tenants[0]; const household=tenantHouseholdForSelection(selected,tenants,leases,leaseMemberships,units); const tenant=household.primaryTenant; const context={recordType:"tenant",recordId:tenant?.id};
        return tenant && <div data-rental-tenant-detail {...{ [CARD_REGION_ATTRIBUTE]: "" }}
        onContextMenu={(event) => onContextMenu(event, tenantMenuItems(tenant, context))}
        title="Right-click for tenant actions">
        <CardContextMenu menu={contextMenu} onClose={closeContextMenu} />
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">Tenant household</p><h3 className="mt-1 text-xl font-black text-slate-950 dark:text-white">{household.unit?.label || "No active property"}</h3></div><div className="flex items-center gap-2"><button type="button" aria-label={`More actions for ${tenant.display_name}`} aria-haspopup="menu" title="More actions"
          onClick={(event) => openTenantMenuBelow(event.currentTarget, tenant, context)}
          className="rounded-xl border border-slate-300 px-3 py-2 text-lg font-black leading-none text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">⋮</button><RentalRecordActions label="Tenant actions" actions={[{label:"Rent & payments",onSelect:()=>onNavigate?.("charges",context)},{label:"Manage lease",onSelect:()=>onNavigate?.("leases",context)},{label:"Messaging",onSelect:()=>onNavigate?.("communications",context)},{label:"Inspections",onSelect:()=>onNavigate?.("inspections",context)},{label:"File library",onSelect:()=>onNavigate?.("documents",context)}]}/></div></div>
        <LeaseSummary lease={household.lease} unit={household.unit}/>
        <TenantRecordTabs
          key={tenant.id}
          tenantId={tenant.id}
          tenantName={tenant.display_name}
          unitLabel={propertyLabelForTenant(tenant, leases, leaseMemberships, units)}
          onOpenPropertyLedger={(propertyKey, propertyLabel) => onNavigate("setup", { recordType: "property", recordId: propertyKey, recordLabel: propertyLabel })}
          onOpenBankLedger={() => navigate?.("bank-ledger")}
          details={<>
        <TenantPaymentHistory key={tenant.id} tenantId={tenant.id} tenantName={tenant.display_name} onOpenFullLedger={() => openFullLedger(tenant)} />
        <TenantProfileCard title="Primary tenant" tenant={tenant} working={working} updateProfile={updateProfile} updateEmail={updateEmail} loadTenants={refresh} sendInviteEmail={sendInviteEmail} leaseId={household.lease?.id} lateFeeOverride={(data?.lateFeeTenantOverrides||[]).find((item)=>item.tenant_id===tenant.id)||null} saveLateFeeOverride={saveLateFeeOverride} workspacePaymentPolicy={data?.paymentPolicy||"allow_any_amount"} paymentPolicyOverride={tenant.payment_policy||null} savePaymentPolicyOverride={savePaymentPolicyOverride}/>
        <CustomFieldsEditor groups={[{ entity: "tenant", recordId: tenant.id }]} />
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/60 p-5 dark:border-slate-700 dark:bg-slate-950/30" data-tenant-notice-log>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Generated notices</p>
          <NoticeLogList tenantId={tenant.id} tenantName={tenant.display_name} compact />
        </div>
        {!leaseMemberships.some((item) => item.tenant_id === tenant.id) && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30"><p className="text-sm font-bold text-red-900 dark:text-red-200">This tenant is not assigned to any lease.</p><button type="button" disabled={working} onClick={() => { setDeleteTarget(tenant); setDeleteConfirmText(""); }} className="mt-3 rounded-lg bg-red-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">Delete unused duplicate</button></div>}
        {deleteTarget && <div role="alertdialog" aria-modal="true" aria-labelledby="delete-unused-tenant-title" aria-describedby="delete-unused-tenant-desc"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          onKeyDown={(event) => { if (event.key === "Escape") cancelDeleteTarget(); }}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 id="delete-unused-tenant-title" className="text-lg font-black text-slate-950 dark:text-white">Delete unused duplicate?</h3>
            <p id="delete-unused-tenant-desc" className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Permanently delete <strong>{deleteTarget.display_name}</strong> ({deleteTarget.email})? This cannot be undone.
              Only tenants with no lease, payments, or other rental history can be deleted.</p>
            <label className="mt-4 block text-sm font-bold text-slate-900 dark:text-white">Type DELETE to confirm
              <input name="deleteConfirmText" autoFocus value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-950 dark:text-white" /></label>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={cancelDeleteTarget} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-black text-slate-700 dark:border-slate-600 dark:text-slate-200">Cancel</button>
              <button type="button" disabled={working || deleteConfirmText !== "DELETE"} onClick={confirmDeleteTarget}
                className="rounded-xl bg-red-700 px-5 py-2.5 text-sm font-black text-white transition disabled:opacity-50">Delete permanently</button>
            </div>
          </div>
        </div>}
        <div className="mt-6 space-y-4"><h3 className="text-xl font-black text-slate-950 dark:text-white">Co-tenants / spouse</h3>{household.coTenants.length ? household.coTenants.map((coTenant)=><TenantProfileCard key={coTenant.id} title="Co-tenant" tenant={coTenant} working={working} updateProfile={updateProfile} updateEmail={updateEmail} loadTenants={refresh} sendInviteEmail={sendInviteEmail} leaseId={household.lease?.id} lateFeeOverride={(data?.lateFeeTenantOverrides||[]).find((item)=>item.tenant_id===coTenant.id)||null} saveLateFeeOverride={saveLateFeeOverride} workspacePaymentPolicy={data?.paymentPolicy||"allow_any_amount"} paymentPolicyOverride={coTenant.payment_policy||null} savePaymentPolicyOverride={savePaymentPolicyOverride} makePrimary={household.lease ? ()=>makePrimary(household.lease.id,coTenant.id) : null}/>) : <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No co-tenant is assigned to this lease.</p>}</div>
        <a href="/auth?next=/forge/rental/portal" className="mt-5 inline-block text-sm font-bold text-sky-700 underline hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300">Open tenant sign-in</a></>}
        />
        </div>; })()}
 (feat(rentec-parity): R11 payment policies + per-tenant override)
    </RentalRecordBrowser>}
    {showCreate && <form onSubmit={save} className="mt-6 grid max-w-4xl gap-4 md:grid-cols-2">
      <label className="text-sm font-bold text-slate-900 dark:text-white">Tenant name<input name="displayName" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Email<input name="email" type="email" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Phone<input name="phone" type="tel" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
      <div className="flex items-end gap-3"><button disabled={working} className={`rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>{working ? "Saving…" : "Save tenant"}</button>{tenants.length > 0 && <button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 dark:border-slate-600 dark:text-slate-200">Cancel</button>}</div>
    </form>}
  </section>;
}

// Rentec-parity: the tenant record leads with the details -- the info view is
// the record home (contact, lease, deposit, activity), and the ledger is the
// second tab. Matches Rentec's tenant detail panel; the full-page ledger
// remains one click away via View Ledger. Keyed by tenant id by the caller so
// switching records always resets to the details tab.
function TenantRecordTabs({ tenantId, tenantName, unitLabel, onOpenPropertyLedger, onOpenBankLedger, details }) {
  const [recordTab, setRecordTab] = useState("details");
  const tabClass = (active) => `rounded-t-xl px-4 py-2.5 text-sm font-black transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
    active
      ? "bg-white text-slate-950 shadow-[inset_0_-2px_0_0_#0284c7] dark:bg-slate-900 dark:text-white"
      : "text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white"
  }`;
  return <>
    <div role="tablist" aria-label={`Record views for ${tenantName}`} className="mt-5 flex gap-1 border-b border-slate-200 dark:border-slate-700">
      <button type="button" role="tab" aria-selected={recordTab === "details"} data-record-tab="details"
        onClick={() => setRecordTab("details")} className={tabClass(recordTab === "details")}>Tenant details</button>
      <button type="button" role="tab" aria-selected={recordTab === "ledger"} data-record-tab="ledger"
        onClick={() => setRecordTab("ledger")} className={tabClass(recordTab === "ledger")}>Ledger</button>
    </div>
    {recordTab === "details" ? (
      <div role="tabpanel" aria-label="Tenant details" className="mt-4">{details}</div>
    ) : (
      <div role="tabpanel" aria-label="Tenant ledger" className="mt-4">
        <TenantLedgerPage tenantId={tenantId} tenantName={tenantName} unitLabel={unitLabel}
          closeLabel="Tenant details" onClose={() => setRecordTab("details")}
          onOpenPropertyLedger={onOpenPropertyLedger} onOpenBankLedger={onOpenBankLedger} />
      </div>
    )}
  </>;
}

function LeaseSummary({lease,unit}) { return <div className="mt-4 grid gap-2 rounded-2xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/30 sm:grid-cols-2 lg:grid-cols-4"><Info label="Property" value={unit?.label||lease?.property_id}/><Info label="Lease status" value={lease?.status}/><Info label="Lease dates" value={lease?`${lease.start_date} to ${lease.end_date||"Open-ended"}`:null}/><Info label="Monthly rent" value={lease?money.format(Number(lease.monthly_rent_cents||0)/100):null}/></div> }
function Info({label,value}) { return <div><p className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p><p className="mt-1 font-bold text-slate-950 dark:text-white">{value||"Not recorded"}</p></div> }
function Field({label,name,defaultValue="",type="text",step}) { return <label className="text-sm font-bold text-slate-900 dark:text-white">{label}<input name={name} type={type} step={step} defaultValue={defaultValue??""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label> }
function TenantProfileCard({title,tenant,working,updateProfile,updateEmail,loadTenants,makePrimary,sendInviteEmail,leaseId,lateFeeOverride,saveLateFeeOverride,workspacePaymentPolicy,paymentPolicyOverride,savePaymentPolicyOverride}) {
  // Join-up invite confirmation (mirrors the borrower-invite pattern: checkbox
  // plus a typed phrase). The button fires a real email, so a single click
  // must never send it.
  const [showInviteConfirm, setShowInviteConfirm] = useState(false);
  const [inviteAck, setInviteAck] = useState(false);
  const [inviteConfirmText, setInviteConfirmText] = useState("");
  function openInviteConfirm() { setShowInviteConfirm(true); setInviteAck(false); setInviteConfirmText(""); }
  return <article className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">{title}</p><h4 className="mt-1 text-xl font-black text-slate-950 dark:text-white">{tenant.display_name}</h4></div>{makePrimary&&<button type="button" disabled={working} onClick={makePrimary} className="rounded-lg border border-sky-500 px-3 py-2 text-sm font-bold text-sky-800 dark:text-sky-300">Make primary tenant</button>}</div>
  <div className="mt-4"><RentalPhotoUpload entityType="tenant" entityId={tenant.id} photoUrl={tenant.photo_url} onUploaded={loadTenants}/></div>
  <form key={`email-${tenant.id}`} onSubmit={(event)=>updateEmail(event,tenant.id)} className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-[260px] flex-1 text-sm font-bold text-slate-900 dark:text-white">Contact / portal email<input name="portalEmail" type="email" required defaultValue={tenant.email} aria-label={`Portal email for ${tenant.display_name}`} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label><button disabled={working} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white dark:bg-amber-400 dark:text-slate-950">Update email</button></form>
  {!tenant.auth_user_id && <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/30">
    <button type="button" disabled={working} onClick={openInviteConfirm} className={`rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>{working?"Sending…":tenant.invited_at?"Resend invite email":"Send invite email"}</button>
    <p className="text-xs font-bold text-slate-600 dark:text-slate-400">{tenant.invited_at?`Invite sent ${new Date(tenant.invited_at).toLocaleDateString()}. The tenant signs in with the email above.`:"Emails the tenant a join-up invite with the portal link."}</p>
  </div>}
  {showInviteConfirm && <div role="alertdialog" aria-modal="true" aria-labelledby="send-invite-title" aria-describedby="send-invite-desc"
    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
    onKeyDown={(event) => { if (event.key === "Escape") setShowInviteConfirm(false); }}>
    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
      <h3 id="send-invite-title" className="text-lg font-black text-slate-950 dark:text-white">Send invite email?</h3>
      <p id="send-invite-desc" className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        This sends a real email to <strong>{tenant.display_name}</strong> ({tenant.email}) with the tenant portal
        join-up link{tenant.invited_at ? " — resending the invite" : ""}. Only send when the tenant is ready to sign up.</p>
      <label className="mt-4 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
        <input type="checkbox" checked={inviteAck} onChange={(event) => setInviteAck(event.target.checked)} />
        I verified this recipient email is correct.</label>
      <label className="mt-3 block text-sm font-bold text-slate-900 dark:text-white">Type INVITE to confirm
        <input name="inviteConfirmText" autoFocus value={inviteConfirmText}
          onChange={(event) => setInviteConfirmText(event.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-950 dark:text-white" /></label>
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" onClick={() => setShowInviteConfirm(false)} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-black text-slate-700 dark:border-slate-600 dark:text-slate-200">Cancel</button>
        <button type="button" disabled={working || !inviteAck || inviteConfirmText !== "INVITE"}
          onClick={async () => { setShowInviteConfirm(false); await sendInviteEmail(tenant, leaseId); }}
          className="rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-black text-white transition disabled:opacity-50">Send invite</button>
      </div>
    </div>
  </div>}
  <form key={`profile-${tenant.id}`} onSubmit={(event)=>updateProfile(event,tenant.id)} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <Field label="Mobile phone" name="phone" type="tel" defaultValue={tenant.phone}/><Field label="Work phone" name="workPhone" type="tel" defaultValue={tenant.work_phone}/>
    <Field label="Employer" name="employerName" defaultValue={tenant.employer_name}/><Field label="Employer phone" name="employerPhone" type="tel" defaultValue={tenant.employer_phone}/><Field label="Monthly income" name="monthlyIncome" type="number" step="0.01" defaultValue={tenant.monthly_income_cents==null?"":Number(tenant.monthly_income_cents)/100}/>
    <Field label="Emergency contact" name="emergencyContactName" defaultValue={tenant.emergency_contact_name}/><Field label="Emergency contact phone" name="emergencyContactPhone" type="tel" defaultValue={tenant.emergency_contact_phone}/><Field label="SSN last four only" name="ssnLastFour" defaultValue={tenant.ssn_last_four}/>
    <label className="text-sm font-bold text-slate-900 dark:text-white">Application status<select name="applicationStatus" defaultValue={tenant.application_status||""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"><option value="">Not recorded</option><option value="not_started">Not started</option><option value="received">Received</option><option value="screening">Screening</option><option value="approved">Approved</option><option value="denied">Denied</option><option value="withdrawn">Withdrawn</option></select></label>
    <Field label="Application submitted" name="applicationSubmittedAt" type="datetime-local" defaultValue={tenant.application_submitted_at?.slice(0,16)}/><Field label="Screening provider" name="screeningProvider" defaultValue={tenant.screening_provider}/><Field label="Screening reference" name="screeningReference" defaultValue={tenant.screening_reference}/>
    <label className="text-sm font-bold text-slate-900 dark:text-white">Screening status<select name="screeningStatus" defaultValue={tenant.screening_status||""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"><option value="">Not recorded</option><option value="not_started">Not started</option><option value="pending">Pending</option><option value="complete">Complete</option><option value="review_required">Review required</option></select></label><Field label="Screening completed" name="screeningCompletedAt" type="datetime-local" defaultValue={tenant.screening_completed_at?.slice(0,16)}/>
    <label className="text-sm font-bold text-slate-900 dark:text-white sm:col-span-2 lg:col-span-3">Private landlord notes<textarea name="landlordNotes" defaultValue={tenant.landlord_notes||""} rows="3" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label>
    <div className="sm:col-span-2 lg:col-span-3"><p className="mb-3 text-xs font-bold text-amber-800 dark:text-amber-300">Never enter a full Social Security number. Full screening credentials stay with the screening provider.</p><button disabled={working} className={`rounded-xl px-5 py-3 text-sm font-black disabled:opacity-50 ${goldControlClassName}`}>Save tenant information</button></div>
  </form>
  <LateFeeOverrideForm tenant={tenant} override={lateFeeOverride} working={working} onSave={saveLateFeeOverride}/>
  <PaymentPolicyOverrideForm tenant={tenant} override={paymentPolicyOverride} workspacePolicy={workspacePaymentPolicy} working={working} onSave={savePaymentPolicyOverride}/>
</article> }

// Per-tenant automatic late-fee override. Blank fields fall back to the
// portfolio default; exempt skips the tenant entirely.
function LateFeeOverrideForm({tenant,override,working,onSave}) {
  const inputClassName="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white";
  const formKey=`latefee-override-${tenant.id}-${override?.updated_at||"none"}`;
  return <form key={formKey} onSubmit={(event)=>onSave(event,tenant.id,false)} className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
    <p className="text-xs font-black uppercase tracking-wide text-red-700 dark:text-red-400">Late-fee override</p>
    <h4 className="mt-1 text-lg font-black text-slate-950 dark:text-white">Automatic late fees for {tenant.display_name}</h4>
    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Blank fields fall back to the portfolio default. Exempt skips this tenant entirely.</p>
    {override
      ? <p className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm font-bold text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">Override active{override.exempt?" — exempt from automatic late fees":" — custom terms apply"}.</p>
      : <p className="mt-3 text-sm font-bold text-slate-500 dark:text-slate-400">No override — the portfolio default applies.</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><input name="overrideExempt" type="checkbox" defaultChecked={override?.exempt===true}/> Exempt from automatic late fees</label>
      <Field label="Grace days (override)" name="overrideGraceDays" type="number" defaultValue={override?.grace_days??""} min={0} max={31} className={inputClassName}/>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Calculation (override)<select name="overrideCalculationType" defaultValue={override?.calculation_type||""} className={inputClassName}><option value="">Portfolio default</option><option value="fixed">Fixed amount</option><option value="percentage">Percentage of unpaid balance</option></select></label>
      <Field label="Fixed amount $ (override)" name="overrideFixedAmount" type="number" step="0.01" min="0.01" defaultValue={override?.fixed_amount_cents!=null?Number(override.fixed_amount_cents)/100:""} className={inputClassName}/>
      <Field label="Percentage % (override)" name="overridePercentage" type="number" step="0.01" min="0.01" defaultValue={override?.percentage_basis_points!=null?Number(override.percentage_basis_points)/100:""} className={inputClassName}/>
      <Field label="Maximum $ (override)" name="overrideMaximumAmount" type="number" step="0.01" min="0.01" defaultValue={override?.maximum_amount_cents!=null?Number(override.maximum_amount_cents)/100:""} className={inputClassName}/>
    </div>
    <div className="mt-4 flex flex-wrap gap-3">
      <button disabled={working} className={`rounded-xl px-5 py-3 text-sm font-black disabled:opacity-50 ${goldControlClassName}`}>Save override</button>
      {override?<button type="button" disabled={working} onClick={(event)=>onSave(event,tenant.id,true)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">Clear override</button>:null}
    </div>
  </form>;
}

// Per-tenant payment-policy override (R11). Shows the effective policy -- the
// tenant's override when set, otherwise the inherited portfolio default -- and
// lets the owner pick one of the three modes or inherit again.
function PaymentPolicyOverrideForm({tenant,override,workspacePolicy,working,onSave}) {
  const inputClassName="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white";
  const formKey=`payment-policy-override-${tenant.id}-${override||"inherit"}`;
  const effective=override||workspacePolicy||"allow_any_amount";
  return <form key={formKey} onSubmit={(event)=>onSave(event,tenant.id,false)} aria-label="Payment policy override" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
    <p className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">Payment policy override</p>
    <h4 className="mt-1 text-lg font-black text-slate-950 dark:text-white">Payment rules for {tenant.display_name}</h4>
    {override
      ? <p className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm font-bold text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">Override active — this tenant follows <strong>{paymentPolicyLabel(override)}</strong> instead of the portfolio default.</p>
      : <p className="mt-3 text-sm font-bold text-slate-500 dark:text-slate-400">No override — inherits the portfolio default: <strong>{paymentPolicyLabel(workspacePolicy)}</strong>.</p>}
    <label className="mt-4 block text-sm font-bold text-slate-900 dark:text-white">Policy for this tenant
      <select name="overridePaymentPolicy" defaultValue={override||"inherit"} className={inputClassName}>
        <option value="inherit">Inherit portfolio default ({paymentPolicyLabel(workspacePolicy)})</option>
        {PAYMENT_POLICIES.map((policy)=><option key={policy} value={policy}>{paymentPolicyLabel(policy)} — {paymentPolicyDescription(policy)}</option>)}
      </select>
    </label>
    <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">Effective policy: {paymentPolicyLabel(effective)}. {paymentPolicyDescription(effective)}</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <button disabled={working} className={`rounded-xl px-5 py-3 text-sm font-black disabled:opacity-50 ${goldControlClassName}`}>Save override</button>
      {override?<button type="button" disabled={working} onClick={(event)=>onSave(event,tenant.id,true)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">Clear override</button>:null}
    </div>
  </form>;
}
