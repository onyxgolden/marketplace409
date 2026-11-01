"use client";
import { useCallback, useRef, useState } from "react";
import RentalRecordBrowser from "./RentalRecordBrowser";
import RentalViewFilterBanner from "./RentalViewFilterBanner";
import RentRollImportPanel from "./RentRollImportPanel";
import CustomFieldsEditor from "./CustomFieldsEditor";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import PaymentFrequencyPicker, { paymentFrequencyDescription } from "./PaymentFrequencyPicker";
import { availableCoTenants } from "./RentalTenantPanel";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";
import { useRentalTerminology } from "./rentalTerminologyContext";
import { leaseBalanceCents } from "@/application/rental/leaseBalance";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Lease balance display text: positive = owed, zero = nothing due, negative =
// the tenant holds an unapplied credit. Never renders "$0.00 due" — a lease
// with no charges (including an external schedule that never generated any)
// honestly reads "No balance due", never a faked amount.
export function leaseBalanceText(balanceCents) {
  if (typeof balanceCents !== "number" || !Number.isSafeInteger(balanceCents)) return null;
  if (balanceCents > 0) return `${money.format(balanceCents / 100)} due`;
  if (balanceCents < 0) return `${money.format(-balanceCents / 100)} credit`;
  return "No balance due";
}

function ordinal(day) {
  const n = Number(day);
  if (!Number.isSafeInteger(n)) return String(day);
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  if (n % 10 === 1) return `${n}st`;
  if (n % 10 === 2) return `${n}nd`;
  if (n % 10 === 3) return `${n}rd`;
  return `${n}th`;
}

// Formats a YYYY-MM-DD date without timezone drift (split, never Date.parse).
export function formatShortDate(isoDate) {
  if (typeof isoDate !== "string") return null;
  const parts = isoDate.slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isSafeInteger(part))) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
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

export default function RentalLeasePanel({ initialSetup = { units: [], tenants: [], leases: [], schedules: [], leaseMemberships: [], openCharges: [], payments: [], credits: [] }, loadOnMount = true, initialShowCreate = null, recordContext = null, initialViewFilter = null }) {
  // R25 terminology: panel headings resolve through the workspace term map.
  const { termLabel } = useRentalTerminology();
  // Lease setup: stale-while-revalidate under one global key (skipped entirely
  // when loadOnMount is false). The cached setup renders instantly on return
  // visits and refreshes in the background — the last good data never blanks
  // out. Mutations post through /api/rental then call refresh() to revalidate.
  const fetchLeaseSetup = useCallback(async () => {
    const response = await fetch("/api/rental");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to load lease setup records.");
    return { units: result.units || [], tenants: result.tenants || [], leases: result.leases || [], schedules: result.schedules || [], leaseMemberships: result.leaseMemberships || [], openCharges: result.openCharges || [], payments: result.payments || [], credits: result.credits || [], deposits: result.deposits || [] };
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
  const [saveNotice, setSaveNotice] = useState("");
  // Success/error feedback for lease-detail actions, rendered at the top of
  // LeaseDetail (where the user is looking) instead of the panel-top message.
  // Scoped by lease id so a notice never shows on a different lease.
  const [detailNotice, setDetailNotice] = useState(null);
  const [detailError, setDetailError] = useState(null);
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
  function unitLabelForLease(lease) {
    return setup.units.find((item) => item.id === lease.unit_id)?.label || "this unit";
  }
  // Controls-sweep G2: lease-side membership actions, mirroring the tenant
  // record's flows so a landlord working from Leases never has to detour.
  async function makePrimary(leaseId, tenantId) {
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "set-primary-tenant", leaseId, tenantId }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to change the primary tenant.");
      setMessage("Primary tenant updated."); await refresh();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function addCoTenant(event, leaseId) {
    event.preventDefault(); setWorking(true); setMessage(""); const form = new FormData(event.currentTarget);
    const tenantId = form.get("coTenantId");
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "add-co-tenant", leaseId, tenantId }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to add the co-tenant.");
      const added = (setup.tenants || []).find((item) => item.id === tenantId);
      setMessage(`Co-tenant added: ${added?.display_name || "tenant"}.`); await refresh();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function removeCoTenant(leaseId, tenant) {
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "remove-co-tenant", leaseId, tenantId: tenant.id }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to remove the co-tenant.");
      setMessage(`Co-tenant removed: ${tenant.display_name}. Their tenant record is untouched and can be re-added.`); await refresh();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function activateLease(lease) {
    const schedule = (setup.schedules || []).find((item) => item.lease_id === lease.id);
    if (!schedule) { setDetailError({ leaseId: lease.id, text: "No rent schedule found for this lease — save one before activating." }); return; }
    setWorking(true); setDetailNotice(null); setDetailError(null);
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "activate-lease-schedule", scheduleId: schedule.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to activate the lease.");
      setDetailNotice({ leaseId: lease.id, text: `✓ Lease activated for ${unitLabelForLease(lease)}.` });
      await refresh();
    } catch (error) { setDetailError({ leaseId: lease.id, text: error.message }); } finally { setWorking(false); }
  }
  // Moves one active external schedule onto FORGE billing. The RPC enforces
  // the authenticated owner, so this must go through the app session — never
  // a direct call. Returns a result object so the lease detail can confirm
  // in place; a failed refresh never clobbers the confirmation.
  async function activateForgeBilling(lease, schedule, { cutoverDate, reconciliationNote }) {
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "activate-forge-billing", scheduleId: schedule.id, cutoverDate,
          reconciliationSummary: reconciliationNote ? { note: reconciliationNote } : {} }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to activate FORGE billing.");
      const unitLabel = (setup.units || []).find((item) => item.id === lease.unit_id)?.label || lease.unit_id;
      const memberships = (setup.leaseMemberships || []).filter((item) => item.lease_id === lease.id);
      const primary = memberships.find((item) => item.occupancy_role === "primary") || memberships[0];
      const tenantName = (setup.tenants || []).find((item) => item.id === primary?.tenant_id)?.display_name;
      const notice = tenantName
        ? `FORGE billing activated for ${unitLabel} — ${tenantName} from ${cutoverDate}.`
        : `FORGE billing activated for ${unitLabel} from ${cutoverDate}.`;
      try { await refresh(); } catch { /* confirmation stands; data refreshes next visit */ }
      return { ok: true, notice };
    } catch (error) {
      return { ok: false, error: error.message };
    } finally { setWorking(false); }
  }
  async function saveEarlyPay(event, schedule) {
    event.preventDefault(); setWorking(true); setDetailNotice(null); setDetailError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-schedule", schedule: { ...schedule, leaseId: schedule.lease_id,
          amountCents: schedule.amount_cents, currencyCode: schedule.currency_code, dueDay: schedule.due_day,
          effectiveStartDate: schedule.effective_start_date, effectiveEndDate: schedule.effective_end_date,
          collectionMode: schedule.collection_mode, collectionProvider: schedule.collection_provider,
          forgeCutoverDate: schedule.forge_cutover_date, createdAt: schedule.created_at,
          // R13: pass the frequency/anchor through explicitly -- createRentSchedule()
          // defaults an omitted frequency to 'monthly', which would silently reset
          // a weekly/bi-weekly schedule on every early-pay save.
          paymentFrequency: schedule.payment_frequency || "monthly",
          paymentAnchorDate: schedule.payment_anchor_date || schedule.effective_start_date,
          earlyPayDays: Number(form.get("earlyPayDays")) } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save the early pay window.");
      setDetailNotice({ leaseId: schedule.lease_id, text: `✓ Early pay window saved: ${result.schedule.earlyPayDays ?? 7} days.` });
      await refresh();
    } catch (error) { setDetailError({ leaseId: schedule.lease_id, text: error.message }); } finally { setWorking(false); }
  }
  async function updateLeaseTerms(event, lease, schedule) {
    event.preventDefault(); setWorking(true); setDetailNotice(null); setDetailError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "update-lease-terms", terms: { leaseId: lease.id,
          monthlyRentCents: Math.round(Number(form.get("monthlyRent")) * 100), rentDueDay: Number(form.get("dueDay")),
          startDate: form.get("startDate"), endDate: form.get("endDate") || null,
          beginChargesDate: form.get("beginChargesDate") || null,
          earlyPayDays: Number(form.get("earlyPayDays") ?? 7),
          paymentFrequency: form.get("paymentFrequency") || "monthly" } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to update the lease terms.");
      setDetailNotice({ leaseId: lease.id, text: "✓ Lease terms updated. Future charges will use the new terms." });
      await refresh();
      return true;
    } catch (error) { setDetailError({ leaseId: lease.id, text: error.message }); return false; } finally { setWorking(false); }
  }
  async function createSchedule(event, lease) {    event.preventDefault(); setWorking(true); setDetailNotice(null); setDetailError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-schedule", schedule: { leaseId: lease.id, status: "draft",
          amountCents: Math.round(Number(form.get("monthlyRent")) * 100), currencyCode: lease.currency_code || "USD",
          dueDay: Number(form.get("dueDay")), effectiveStartDate: form.get("startDate"), effectiveEndDate: form.get("endDate") || null,
          paymentFrequency: form.get("paymentFrequency") || "monthly",
          earlyPayDays: Number(form.get("earlyPayDays") ?? 7) } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save the rent schedule.");
      setDetailNotice({ leaseId: lease.id, text: `✓ Rent schedule saved for ${unitLabelForLease(lease)} — ${money.format(Number(result.schedule.amount_cents ?? Math.round(Number(form.get("monthlyRent")) * 100)) / 100)}/mo, due day ${result.schedule.due_day ?? form.get("dueDay")}. You can now activate this lease.` });
      await refresh();
    } catch (error) { setDetailError({ leaseId: lease.id, text: error.message }); } finally { setWorking(false); }
  }
  async function saveLeaseDeposit(event, lease, tenantId) {
    event.preventDefault(); setWorking(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const raw = form.get("securityDeposit");
    const amountCents = raw === "" || raw == null ? 0 : Math.round(Number(raw) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) { setMessage("Enter a security deposit amount greater than $0."); setWorking(false); return; }
    if (!tenantId) { setMessage("No tenant is attached to this lease, so a deposit cannot be recorded."); setWorking(false); return; }
    const jurisdictionCode = String(form.get("jurisdiction") || "").trim() || null;
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-security-deposit", deposit: { leaseId: lease.id, tenantId, requiredAmountCents: amountCents, jurisdictionCode } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save the security deposit.");
      setMessage(`Security deposit ${money.format(amountCents / 100)} recorded.`);
      await refresh();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function cancelLease(lease) {
    setWorking(true); setDetailNotice(null); setDetailError(null);
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "cancel-lease", leaseId: lease.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to cancel the lease.");
      setDetailNotice({ leaseId: lease.id, text: `✓ Lease cancelled for ${unitLabelForLease(lease)}.` });
      await refresh();
    } catch (error) { setDetailError({ leaseId: lease.id, text: error.message }); } finally { setWorking(false); }
  }
  async function restoreLease(lease) {
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "restore-lease", leaseId: lease.id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to restore the lease.");
      setMessage(`Lease restored to draft: ${result.lease.id}`);
      await refresh();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function setScheduleStatus(schedule, status) {
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "set-schedule-status", scheduleId: schedule.id, status }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to change the schedule status.");
      setMessage(status === "paused" ? "Rent schedule paused — no new charges will generate until it resumes." : "Rent schedule resumed — charge generation is active again.");
      await refresh();
    } catch (error) { setMessage(error.message); } finally { setWorking(false); }
  }
  async function endLease(event, lease) {
    event.preventDefault(); setWorking(true); setMessage("");
    const form = new FormData(event.currentTarget);
    if (form.get("confirm") !== "END") { setMessage("Type END to confirm ending this lease."); setWorking(false); return false; }
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "end-lease", leaseId: lease.id, endDate: form.get("endDate") || null, reason: form.get("reason") || null }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to end the lease.");
      const unitLabel = setup.units.find((item) => item.id === lease.unit_id)?.label || lease.unit_id;
      setMessage(`Lease ended: ${unitLabel} — ${result.lease.end_date}. Future charges stopped; open charges stay on the books.`);
      await refresh();
      return true;
    } catch (error) { setMessage(error.message); return false; } finally { setWorking(false); }
  }
  async function save(event) {
    event.preventDefault(); setMessage(""); setSaveNotice("");
    const form = new FormData(event.currentTarget);
    const unitId = form.get("unitId");
    const propertyId = propertyIdForSelectedUnit(setup.units, unitId);
    if (!propertyId) { setMessage("Select a valid rental unit before saving."); return; }
    const depositRaw = form.get("securityDeposit");
    if (depositRaw !== "" && depositRaw != null && (!Number.isFinite(Number(depositRaw)) || Number(depositRaw) < 0)) { setMessage("Enter a valid security deposit amount, or leave it blank."); return; }
    const depositAmountCents = depositRaw === "" || depositRaw == null ? 0 : Math.round(Number(depositRaw) * 100);
    const depositJurisdiction = String(form.get("jurisdiction") || "").trim() || null;
    setWorking(true);
    try {
      const leaseResponse = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-lease", lease: { propertyId, unitId,
          tenantIds: [form.get("tenantId")], status: "draft", startDate: form.get("startDate"), endDate: form.get("endDate") || null,
          beginChargesDate: form.get("beginChargesDate") || null,
          monthlyRentCents: Math.round(Number(form.get("monthlyRent")) * 100), currencyCode: "USD",
          rentDueDay: Number(form.get("dueDay")), notes: form.get("notes") || null } }) });
      const leaseResult = await leaseResponse.json();
      if (!leaseResponse.ok) throw new Error(leaseResult.error || "Unable to save lease.");
      const scheduleResponse = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-schedule", schedule: { leaseId: leaseResult.lease.id, status: "draft",
          amountCents: leaseResult.lease.monthlyRentCents, currencyCode: "USD", dueDay: leaseResult.lease.rentDueDay,
          effectiveStartDate: leaseResult.lease.startDate, effectiveEndDate: leaseResult.lease.endDate,
          paymentFrequency: form.get("paymentFrequency") || "monthly" } }) });
      const scheduleResult = await scheduleResponse.json();
      if (!scheduleResponse.ok) throw new Error(scheduleResult.error || "Lease saved, but its rent schedule could not be saved.");
      const savedUnitLabel = setup.units.find((item) => item.id === unitId)?.label || "Rental unit";
      const savedTenantName = setup.tenants.find((item) => item.id === form.get("tenantId"))?.display_name || "Tenant";
      if (depositAmountCents > 0) {
        const depositResponse = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ operation: "save-security-deposit", deposit: { leaseId: leaseResult.lease.id, tenantId: form.get("tenantId"), requiredAmountCents: depositAmountCents, jurisdictionCode: depositJurisdiction } }) });
        const depositResult = await depositResponse.json();
        if (!depositResponse.ok) {
          setMessage(`Lease saved, but the security deposit was NOT recorded: ${depositResult.error || "Unable to save the security deposit."}`);
          return;
        }
        setSaveNotice(`Lease saved: ${savedUnitLabel} — ${savedTenantName} — ${money.format(Number(leaseResult.lease.monthlyRentCents) / 100)}/mo, draft schedule ready — Security deposit ${money.format(depositAmountCents / 100)} recorded.`);
      } else {
        setSaveNotice(`Lease saved: ${savedUnitLabel} — ${savedTenantName} — ${money.format(Number(leaseResult.lease.monthlyRentCents) / 100)}/mo, draft schedule ready`);
      }
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
    <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">{termLabel("lease", { capitalize: true })} setup</p>
    <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">{termLabel("lease", { plural: true, capitalize: true })} and rent schedules</h2>
    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Review existing leases first. New schedules remain draft until the signed lease is ready. If a tenant is already renting but has no lease on file (their original term expired and was never re-signed, or the record didn&apos;t import), add one below and leave the end date blank for an ongoing month-to-month tenancy.</p>
    {message && <p role="status" className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-black text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{message}</p>}
    {(loaded || initialSetup) && loadError ? <p role="status" className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Could not refresh — showing the last saved setup.</p> : null}
    {(loaded || initialSetup) && isRefreshing ? <p className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p> : null}
    {viewFilter === "expiring" && <RentalViewFilterBanner filterLabel="Leases expiring within 90 days" onClear={() => setViewFilter(null)} />}
    {visibleLeases.length > 0 && <RentalRecordBrowser title="Leases" records={visibleLeases} selectedId={selectedId} onSelect={setSelectedId}
      getTitle={(lease) => setup.units.find((item) => item.id === lease.unit_id)?.label || lease.unit_id}
      getSubtitle={(lease) => { const balanceText = leaseBalanceText(leaseBalanceCents(lease.id, { openCharges: setup.openCharges, credits: setup.credits, payments: setup.payments })); return <><span className={`font-bold capitalize ${STATUS_TEXT_COLORS[lease.status] || ""}`}>{lease.status}</span> · {money.format(Number(lease.monthly_rent_cents) / 100)} monthly{ balanceText ? <> · {balanceText}</> : null}</>; }}>
      {(() => { const lease = visibleLeases.find((item) => item.id === selectedId) || visibleLeases[0]; const unit = setup.units.find((item) => item.id === lease?.unit_id);
        const leaseMembershipsForLease = (setup.leaseMemberships || []).filter((item) => item.lease_id === lease?.id);
        const depositTenantId = (leaseMembershipsForLease.find((item) => item.occupancy_role === "primary") || leaseMembershipsForLease[0])?.tenant_id || null;
        const existingDeposit = (setup.deposits || []).find((item) => item.lease_id === lease?.id) || null;
        return lease && <LeaseDetail lease={lease} unit={unit} schedule={(setup.schedules || []).find((item) => item.lease_id === lease.id)} balanceCents={leaseBalanceCents(lease.id, { openCharges: setup.openCharges, credits: setup.credits, payments: setup.payments })} working={working} notice={detailNotice?.leaseId === lease.id ? detailNotice.text : ""} detailError={detailError?.leaseId === lease.id ? detailError.text : ""} onActivate={activateLease} onSaveSchedule={createSchedule} onSaveEarlyPay={saveEarlyPay} onCancel={cancelLease} onRestore={restoreLease} onSetScheduleStatus={setScheduleStatus} onUpdateTerms={updateLeaseTerms} onActivateForgeBilling={activateForgeBilling} existingDeposit={existingDeposit} depositTenantId={depositTenantId} onSaveDeposit={saveLeaseDeposit} onEnd={endLease} tenants={setup.tenants || []} leaseMemberships={setup.leaseMemberships || []} onMakePrimary={makePrimary} onAddCoTenant={addCoTenant} onRemoveCoTenant={removeCoTenant} />; })()}
    </RentalRecordBrowser>}
    {(setup.units.length === 0 || setup.tenants.length === 0) && <p role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
      Save at least one rental unit and tenant before creating a lease. Add units under <a className="underline" href="/forge/rental?section=properties">Properties</a> and tenants under <a className="underline" href="/forge/rental?section=tenants">Tenants</a>.</p>}
    {(setup.leases || []).length > 0 && !showCreate && <button type="button" onClick={() => setShowCreate(true)} className={`mt-5 rounded-xl px-5 py-3 text-sm font-black transition ${goldControlClassName}`}>+ Add a lease for an existing tenant</button>}
    <RentRollImportPanel units={setup.units} tenants={setup.tenants} leases={setup.leases} onImported={refresh} />
    {showCreate && <form onSubmit={save} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {(setup.leases || []).length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30 md:col-span-2 xl:col-span-3"><p className="text-sm font-bold text-amber-950 dark:text-amber-200">Other leases already exist. This adds a new one — for a future/replacement term, or to attach a currently-renting tenant who has no lease on file yet.</p><button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-amber-500 bg-white px-3 py-2 text-sm font-black text-amber-950 transition hover:bg-amber-50 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-slate-800">Cancel setup</button></div>}
      <label className="text-sm font-bold text-slate-900 dark:text-white">Rental unit<select name="unitId" required value={selectedUnitId} onChange={(event) => setSelectedUnitId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
        <option value="" disabled>Select a saved unit</option>{setup.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.label} — {unit.property_id}</option>)}</select></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Property<p className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-950/40 dark:text-slate-300">{selectedUnitPropertyId || "Select a rental unit to set the property."}</p></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Tenant<select name="tenantId" required defaultValue={contextTenantId || (setup.tenants.length === 1 ? setup.tenants[0].id : "")} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
        <option value="" disabled>Select a saved tenant</option>{setup.tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.display_name} — {tenant.email}</option>)}</select></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Move-in date<input name="startDate" type="date" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /><span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">Day they move in.</span></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Begin charges on<input name="beginChargesDate" type="date" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /><span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">Day charges start — e.g. moved in Aug 28 but charges start Sep 1. Leave blank to start charges on the move-in date.</span></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">End date<input name="endDate" type="date" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /><span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">Leave blank for an ongoing month-to-month tenancy.</span></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Monthly rent<input name="monthlyRent" type="number" min="0.01" step="0.01" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Security deposit<input name="securityDeposit" type="number" min="0" step="0.01" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /><span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">Optional — leave blank if no deposit is required. It is recorded right after the lease saves.</span></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Jurisdiction<input name="jurisdiction" placeholder="e.g. TX" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /><span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">Optional — used for deposit rules. Leave blank if unsure.</span></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Due day<input name="dueDay" type="number" min="1" max="28" defaultValue="1" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
      <PaymentFrequencyPicker />
      <label className="text-sm font-bold text-slate-900 dark:text-white xl:col-span-2">Notes<input name="notes" placeholder="e.g. Month-to-month after original 1-year term expired" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
      {saveNotice && <p role="status" className="md:col-span-2 xl:col-span-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-base font-black text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100">✓ {saveNotice}</p>}
      <div className="md:col-span-2 xl:col-span-3 flex items-center gap-4"><button disabled={working || setup.units.length === 0 || setup.tenants.length === 0 || !selectedUnitId} className={`rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>{working ? "Saving…" : "Save draft lease and schedule"}</button>{setup.units.length > 0 && !selectedUnitId && <p className="text-sm font-bold text-slate-500 dark:text-slate-400">Select a rental unit above to enable saving.</p>}</div>
    </form>}
  </section>;
}

function Detail({ label, value }) { return <div><dt className="text-xs font-black uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</dt><dd className="mt-1 break-words font-bold text-slate-800 dark:text-slate-200">{value}</dd></div>; }

export function LeaseDetail({ lease, unit, schedule, balanceCents = null, working, notice, detailError, onActivate, onSaveSchedule, onCancel, onRestore, onSetScheduleStatus, onSaveEarlyPay, onUpdateTerms, onActivateForgeBilling, existingDeposit = null, depositTenantId = null, onSaveDeposit = null, onEnd, tenants = [], leaseMemberships = [], onMakePrimary, onAddCoTenant, onRemoveCoTenant }) {
  const [showEditTerms, setShowEditTerms] = useState(false);
  const [billingNotice, setBillingNotice] = useState("");
  const [billingError, setBillingError] = useState("");
  const [showEndLease, setShowEndLease] = useState(false);
  async function handleUpdateTerms(event) {
    if (await onUpdateTerms(event, lease, schedule)) setShowEditTerms(false);
  }
  async function handleActivateForgeBilling(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const cutoverDate = form.get("cutoverDate");
    const reconciliationNote = (form.get("reconciliationNote") || "").trim();
    if (!cutoverDate) { setBillingError("Pick a cutover date before activating FORGE billing."); return; }
    setBillingNotice(""); setBillingError("");
    const result = await onActivateForgeBilling(lease, schedule, { cutoverDate, reconciliationNote });
    if (result?.ok) setBillingNotice(result.notice);
    else setBillingError(result?.error || "Unable to activate FORGE billing.");
  }
  const balanceText = leaseBalanceText(balanceCents);
  const dueDayText = lease.rent_due_day ? `Rent due on the ${ordinal(lease.rent_due_day)}` : "Due day not recorded";
  const startText = formatShortDate(lease.start_date) ? `Since ${formatShortDate(lease.start_date)}` : null;
  // Controls-sweep G2: the lease-side membership path — the same member list,
  // add, make-primary, and remove the tenant record offers, without detouring
  // to Tenants. The server enforces the same gates (cancelled lease, primary
  // required before adding); the UI hides the actions in those states.
  const leaseMembers = (leaseMemberships || []).filter((item) => item.lease_id === lease.id)
    .map((item) => ({ membership: item, tenant: (tenants || []).find((candidate) => candidate.id === item.tenant_id) || null }));
  const hasPrimary = leaseMembers.some((item) => item.membership.role === "primary");
  const candidates = availableCoTenants(tenants || [], leaseMemberships || [], lease.id);
  const leaseCancelled = lease.status === "cancelled";
  return <div data-rental-lease-detail>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">Selected lease</p><h3 className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{unit?.label || lease.unit_id}</h3></div>
      <span className={`rounded-full px-3 py-1 text-xs font-black capitalize ${STATUS_BADGE_COLORS[lease.status] || "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300"}`}>{lease.status}</span>
    </div>
    {balanceText && <p className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-300">{dueDayText}{startText ? ` · ${startText}` : ""} · Balance: {balanceText}</p>}
    {notice ? <p role="status" className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</p> : null}
    {detailError ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{detailError}</p> : null}
    <dl className="mt-5 grid gap-4 sm:grid-cols-2">
      <Detail label="Monthly rent" value={money.format(Number(lease.monthly_rent_cents) / 100)} />
      <Detail label="Due day" value={lease.rent_due_day || "Not recorded"} />
      <Detail label="Move-in date" value={lease.start_date} />
      <Detail label="Charges begin" value={lease.begin_charges_date || lease.start_date} />
      <Detail label="Payment frequency" value={paymentFrequencyDescription(schedule?.payment_frequency || "monthly")} />
      <Detail label="Ends" value={lease.end_date || "Current"} />
      <Detail label="Property" value={lease.property_id} />
      <Detail label="Lease ID" value={lease.id} />
    </dl>
    {existingDeposit ? (
      <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">Deposit on file: {money.format(Number(existingDeposit.required_amount_cents) / 100)}{existingDeposit.jurisdiction_code ? ` · ${existingDeposit.jurisdiction_code}` : ""} — manage it on the Security deposits screen.</p>
    ) : depositTenantId && onSaveDeposit && lease.status !== "cancelled" ? (
      <form onSubmit={(event) => onSaveDeposit(event, lease, depositTenantId)} className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40">
        <label className="text-sm font-bold text-slate-900 dark:text-white">Security deposit<input name="securityDeposit" type="number" min="0.01" step="0.01" required placeholder="No deposit recorded yet" className="mt-1 w-48 rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Jurisdiction<input name="jurisdiction" placeholder="e.g. TX" className="mt-1 w-48 rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <button disabled={working} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">{working ? "Saving…" : "Save deposit"}</button>
        <p className="w-full text-xs text-slate-500 dark:text-slate-400">Recorded for this lease only — it does not create a second deposit if one already exists.</p>
      </form>
    ) : null}
    <div className="mt-6">
      <h4 className="text-sm font-black uppercase tracking-wide text-slate-900 dark:text-white">Tenants on this lease</h4>
      {leaseCancelled && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">This lease is cancelled — membership cannot be changed.</p>}
      {leaseMembers.length === 0 && !leaseCancelled && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">No tenants on this lease yet. Add the first tenant from the Tenants screen, then manage membership here.</p>}
      {!hasPrimary && leaseMembers.length > 0 && !leaseCancelled && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">This lease has no primary tenant — make one primary below before adding a co-tenant.</p>}
      <ul className="mt-3 grid gap-2">
        {leaseMembers.map(({ membership, tenant }) => (
          <li key={membership.id || membership.tenant_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <span className="text-sm font-bold text-slate-900 dark:text-white">
              {tenant ? <a className="underline" href={`/forge/rental?section=tenants&recordType=tenant&recordId=${tenant.id}`}>{tenant.display_name || tenant.email}</a> : membership.tenant_id}
              <span className="ml-2 text-xs font-black capitalize text-slate-500 dark:text-slate-400">{membership.role}</span>
            </span>
            {!leaseCancelled && (membership.role !== "primary" || !hasPrimary) && <span className="flex gap-2">
              <button type="button" disabled={working} onClick={() => onMakePrimary?.(lease.id, membership.tenant_id)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Make primary</button>
              {membership.role !== "primary" && <button type="button" disabled={working} onClick={() => onRemoveCoTenant?.(lease.id, tenant || { id: membership.tenant_id, display_name: membership.tenant_id })} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Remove co-tenant</button>}
            </span>}
          </li>
        ))}
      </ul>
      {!leaseCancelled && hasPrimary && candidates.length > 0 && <form onSubmit={(event) => onAddCoTenant?.(event, lease.id)} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-sm font-bold text-slate-900 dark:text-white">Add co-tenant<select name="coTenantId" required className="mt-1 rounded-xl border border-slate-300 bg-white px-3 py-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
          {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.display_name || candidate.email}</option>)}
        </select></label>
        <button type="submit" disabled={working} className={`rounded-xl px-4 py-2 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>Add co-tenant</button>
      </form>}
      {!leaseCancelled && hasPrimary && candidates.length === 0 && leaseMembers.length > 0 && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Every tenant record is already on this lease — create a new tenant record under Tenants to add another person.</p>}
    </div>
    <CustomFieldsEditor groups={[{ entity: "lease", recordId: lease.id }]} />
    {schedule && lease.status !== "cancelled" && (
      <div className="mt-4">
        <button type="button" disabled={working} onClick={() => setShowEditTerms((value) => !value)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">{showEditTerms ? "Close" : "Edit terms"}</button>
        {showEditTerms && (
          <form onSubmit={handleUpdateTerms} className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40 sm:grid-cols-2">
            <label className="text-sm font-bold text-slate-900 dark:text-white">Monthly rent<input name="monthlyRent" type="number" min="0.01" step="0.01" required defaultValue={(Number(lease.monthly_rent_cents) / 100).toFixed(2)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
            <label className="text-sm font-bold text-slate-900 dark:text-white">Due day<input name="dueDay" type="number" min="1" max="28" required defaultValue={lease.rent_due_day || 1} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
            <label className="text-sm font-bold text-slate-900 dark:text-white">Move-in date<input name="startDate" type="date" required defaultValue={lease.start_date} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /><span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">Day they move in.</span></label>
            <label className="text-sm font-bold text-slate-900 dark:text-white">Begin charges on<input name="beginChargesDate" type="date" required defaultValue={lease.begin_charges_date || lease.start_date} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /><span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">Day charges start — e.g. moved in Aug 28 but charges start Sep 1. No charge is ever generated for a period due before this date.</span></label>
            <label className="text-sm font-bold text-slate-900 dark:text-white">End date<input name="endDate" type="date" defaultValue={lease.end_date || ""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /><span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">Leave blank for an ongoing month-to-month tenancy.</span></label>
            <label className="text-sm font-bold text-slate-900 dark:text-white">Early pay window (days)<input name="earlyPayDays" type="number" min="0" max="31" required defaultValue={schedule.early_pay_days ?? 7} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
            <div className="sm:col-span-2"><PaymentFrequencyPicker name="paymentFrequency" defaultValue={schedule.payment_frequency || "monthly"} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></div>
            <button disabled={working} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300 sm:col-span-2">{working ? "Saving…" : "Save terms"}</button>
            <p className="text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">New terms apply to future charges only — charges already generated keep their original terms. Changing the frequency restarts the payment cadence from today.</p>
          </form>
        )}
      </div>
    )}
    {schedule && lease.status !== "cancelled" && (
      <form onSubmit={(event) => onSaveEarlyPay(event, schedule)} className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40">
        <label className="text-sm font-bold text-slate-900 dark:text-white">Early pay window (days)<input name="earlyPayDays" type="number" min="0" max="31" required defaultValue={schedule.early_pay_days ?? 7} className="mt-1 w-24 rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <button disabled={working} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">{working ? "Saving…" : "Save"}</button>
        <p className="w-full text-xs text-slate-500 dark:text-slate-400">How many days before the due date next month&apos;s rent appears for the tenant to pay early. 0 = only after the month starts.</p>
      </form>
    )}
    {schedule && schedule.status === "active" && schedule.collection_mode === "external" && lease.status !== "cancelled" && (
      <form onSubmit={handleActivateForgeBilling} className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40 sm:grid-cols-2">
        <p className="text-sm font-bold text-slate-700 dark:text-slate-300 sm:col-span-2">This lease is collected outside FORGE, so no charges are generated here. Activate FORGE billing to start collecting from the cutover date.</p>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Cutover date<input name="cutoverDate" type="date" required defaultValue={schedule.effective_start_date || lease.start_date} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /><span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">FORGE only collects obligations on or after this date.</span></label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Reconciliation note (optional)<input name="reconciliationNote" placeholder="e.g. Outside balance settled through Oct 31" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
        <button disabled={working} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-black text-white transition hover:bg-emerald-800 disabled:opacity-50 sm:col-span-2">{working ? "Activating…" : "Activate FORGE billing"}</button>
      </form>
    )}
    {billingNotice && <p role="status" className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-base font-black text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100">✓ {billingNotice}</p>}
    {billingError && <p role="status" className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">{billingError}</p>}
    {schedule && lease.status === "cancelled" && (
      <p className="mt-4 text-sm font-bold text-slate-500 dark:text-slate-400">This lease is cancelled — its early-pay window cannot be changed.</p>
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
        <div className="sm:col-span-2"><PaymentFrequencyPicker name="paymentFrequency" defaultValue="monthly" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></div>
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
    {schedule && schedule.status === "active" && lease.status !== "cancelled" && (
      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
        <button type="button" disabled={working} onClick={() => onSetScheduleStatus?.(schedule, "paused")} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Pause schedule</button>
        <p className="text-xs text-slate-500 dark:text-slate-400">Pausing stops new charge generation for this lease only — the portfolio billing switch is untouched.</p>
      </div>
    )}
    {schedule && schedule.status === "paused" && lease.status !== "cancelled" && (
      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
        <button type="button" disabled={working} onClick={() => onSetScheduleStatus?.(schedule, "active")} className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-black text-white transition hover:bg-emerald-800 disabled:opacity-50">Resume schedule</button>
        <p className="text-xs text-slate-500 dark:text-slate-400">This schedule is paused — no new charges generate until it resumes.</p>
      </div>
    )}
    {lease.status === "cancelled" && (
      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
        <button type="button" disabled={working} onClick={() => onRestore?.(lease)} className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-black text-white transition hover:bg-emerald-800 disabled:opacity-50">Restore this lease</button>
        <p className="text-xs text-slate-500 dark:text-slate-400">This lease is cancelled — it cannot be edited. Restore it to draft to work on it again, or add a replacement lease with the button below.</p>
      </div>
    )}
    {lease.status === "active" && onEnd && (
      <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
        <button type="button" disabled={working} onClick={() => setShowEndLease((value) => !value)} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-bold text-red-700 transition hover:border-red-400 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30">{showEndLease ? "Close" : "End this lease"}</button>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Ending stops future charges and lets the unit be archived. Open charges stay on the books — void or refund them separately if needed.</p>
        {showEndLease && (
          <form onSubmit={async (event) => { if (await onEnd(event, lease)) setShowEndLease(false); }} className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40 sm:grid-cols-2">
            <label className="text-sm font-bold text-slate-900 dark:text-white">End date<input name="endDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
            <label className="text-sm font-bold text-slate-900 dark:text-white">Reason<input name="reason" placeholder="Move-out, term ended, mutual agreement…" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
            <label className="text-sm font-bold text-slate-900 dark:text-white sm:col-span-2">Type END to confirm<input name="confirm" required placeholder="END" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
            <button disabled={working} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-red-800 disabled:opacity-50 sm:col-span-2">{working ? "Ending…" : "End this lease"}</button>
          </form>
        )}
      </div>
    )}
  </div>;
}
