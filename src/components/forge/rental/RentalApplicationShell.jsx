"use client";
import { useEffect, useMemo, useState } from "react";
import { RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { resolveActiveFunction } from "@/components/forge/workspace/ApplicationShell";
import RentalContextualSurface from "./RentalContextualSurface";
import RentalOverviewPanel from "./RentalOverviewPanel"; import RentalSetupPanel from "./RentalSetupPanel"; import RentalTenantPanel from "./RentalTenantPanel"; import RentalLeasePanel from "./RentalLeasePanel"; import RentalPaymentsPanel from "./RentalPaymentsPanel"; import RentalInsurancePanel from "./RentalInsurancePanel"; import RentalMaintenancePanel from "./RentalMaintenancePanel"; import RentalDocumentsPanel from "./RentalDocumentsPanel"; import RentalCommunicationsPanel from "./RentalCommunicationsPanel"; import RentalReconciliationPanel from "./RentalReconciliationPanel"; import RentalReportsPanel from "./RentalReportsPanel"; import RentalDepositsPanel from "./RentalDepositsPanel"; import RentalInspectionsPanel from "./RentalInspectionsPanel"; import RentalLeaseLifecyclePanel from "./RentalLeaseLifecyclePanel"; import RentalLeasePreparationPanel from "./RentalLeasePreparationPanel"; import RentalAutopayPanel from "./RentalAutopayPanel"; import RentalAnimalsPanel from "./RentalAnimalsPanel"; import RentalSupportPanel from "./RentalSupportPanel";
import PrivateFinancingAccountsPanel from "./PrivateFinancingAccountsPanel";
import RentecMigrationPanel from "./RentecMigrationPanel";
import RentecFileInventoryPanel from "./RentecFileInventoryPanel";
import RentecPaymentImportPanel from "./RentecPaymentImportPanel";
import RentecFinancialHistoryImportPanel from "./RentecFinancialHistoryImportPanel";
import PropertyFinancialSetupPanel from "./PropertyFinancialSetupPanel";
import RentalHelpModal from "./RentalHelpModal";
import RentalTodaysPrioritiesPanel from "./guided-workflow/RentalTodaysPrioritiesPanel";
import RentalFirstTenantReadinessPanel from "./guided-workflow/RentalFirstTenantReadinessPanel";
import RentalLeaseRenewalPanel from "./guided-workflow/RentalLeaseRenewalPanel";
import { RV_RESERVATIONS_NAV_GROUP, buildRvReservationsSurface } from "./rvReservationsNavigation";
import { PORTFOLIO_SUB_CATEGORIES } from "./portfolioSubCategories";

export const RENTAL_NAVIGATION = Object.freeze([
  Object.freeze({ label: "Overview", items: Object.freeze([{ id: "overview", label: "Summary" }, { id: "guide", label: "Today's Priorities" }, { id: "readiness", label: "Prepare a Tenant" }, { id: "renewal", label: "Renew a Lease" }]) }),
  Object.freeze({ label: "Portfolio", subCategories: PORTFOLIO_SUB_CATEGORIES }),
  RV_RESERVATIONS_NAV_GROUP,
  Object.freeze({ label: "Money", items: Object.freeze([{ id: "charges", label: "Rent & Payments" }, { id: "reconciliation", label: "Reconciliation" }, { id: "rentec-payment-import", label: "Rentec Payment Import" }, { id: "rentec-financial-history-import", label: "Rentec Financial History Import" }, { id: "financial-setup", label: "Financial Setup" }, { id: "deposits", label: "Deposits" }, { id: "reports", label: "Reports" }, { id: "private-financing", label: "Private Financing" }]) }),
  Object.freeze({ label: "Operations", items: Object.freeze([{ id: "maintenance", label: "Maintenance" }, { id: "inspections", label: "Inspections" }, { id: "insurance", label: "Insurance" }, { id: "documents", label: "Documents" }, { id: "communications", label: "Communications" }]) }),
  Object.freeze({ label: "Controls", items: Object.freeze([{ id: "lease-lifecycle", label: "Lease Changes" }, { id: "lease-preparation", label: "Lease Editor" }, { id: "autopay", label: "Autopay" }, { id: "animals", label: "Animals" }, { id: "support", label: "Support" }, { id: "rentec-migration", label: "Rentec Migration" }, { id: "rentec-files", label: "Rentec Files" }]) }),
]);
function itemsForGroup(group) {
  return group.items ?? group.subCategories.flatMap((subCategory) => subCategory.items);
}
export const RENTAL_FUNCTIONS = Object.freeze(RENTAL_NAVIGATION.flatMap(itemsForGroup));

// Every item that may be hidden via the sidebar's Customize control, grouped by the section label
// shown in that checklist -- everything except Overview, which every user needs as a landing view
// and is therefore never offered as hideable in the first place.
const SIDEBAR_KEY = "rental-manager";
export const HIDEABLE_SIDEBAR_SECTIONS = Object.freeze(
  RENTAL_NAVIGATION
    .filter((group) => group.label !== "Overview")
    .map((group) => group.subCategories
      ? group.subCategories
          .filter((subCategory) => subCategory.items.length > 0)
          .map((subCategory) => Object.freeze({ sectionLabel: `${group.label} — ${subCategory.label}`, items: subCategory.items }))
      : [Object.freeze({ sectionLabel: group.label, items: group.items })])
    .flat(),
);

// Server-persisted per-user, per-sidebar hide/show state (see
// src/app/api/preferences/sidebar/[sidebarKey]/route.js and the user_sidebar_preferences table) --
// follows the same optimistic-update-with-rollback pattern as WorkspaceHubGrid's favorite-star
// toggle, just for a Set of ids instead of a single value.
function useSidebarHiddenItems(sidebarKey) {
  const [hiddenItemIds, setHiddenItemIds] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/preferences/sidebar/${sidebarKey}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("load failed"))))
      .then((data) => { if (!cancelled) setHiddenItemIds(new Set(data.hiddenItemIds || [])); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sidebarKey]);

  async function persist(nextHiddenItemIds) {
    const previous = hiddenItemIds;
    setHiddenItemIds(nextHiddenItemIds);
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/preferences/sidebar/${sidebarKey}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hiddenItemIds: [...nextHiddenItemIds] }),
      });
      if (!response.ok) {
        setHiddenItemIds(previous);
        setError("Unable to save your sidebar preferences. Please try again.");
      }
    } catch {
      setHiddenItemIds(previous);
      setError("Unable to save your sidebar preferences. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function toggleItem(id) {
    const next = new Set(hiddenItemIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    persist(next);
  }
  function showAll() {
    persist(new Set());
  }

  return { hiddenItemIds, saving, error, toggleItem, showAll };
}

// Overview is never filterable, even defensively against a corrupted/stale hidden-ids value --
// every user needs a landing view regardless of what's stored server-side.
function isItemHidden(group, itemId, hiddenItemIds) {
  return group.label !== "Overview" && hiddenItemIds.has(itemId);
}

export function buildRentalSurface(id, { onNavigate, recordContext = null } = {}) {
  if(recordContext&&["charges","maintenance","inspections","documents","communications"].includes(id))return <RentalContextualSurface surfaceId={id} recordContext={recordContext}/>;
  const rvSurface = buildRvReservationsSurface(id);
  if (rvSurface) return rvSurface;
  const surfaces = { guide: <RentalTodaysPrioritiesPanel onNavigate={onNavigate} />, readiness: <RentalFirstTenantReadinessPanel onNavigate={onNavigate} />, renewal: <RentalLeaseRenewalPanel onNavigate={onNavigate} />, setup: <RentalSetupPanel onNavigate={onNavigate} />, tenants: <RentalTenantPanel onNavigate={onNavigate} recordContext={recordContext} />, leases: <RentalLeasePanel recordContext={recordContext} />, "rentec-migration": <RentecMigrationPanel />, "rentec-files": <RentecFileInventoryPanel />, charges: <RentalPaymentsPanel recordContext={recordContext} />, insurance: <RentalInsurancePanel />, maintenance: <RentalMaintenancePanel recordContext={recordContext} />, documents: <RentalDocumentsPanel recordContext={recordContext} />, communications: <RentalCommunicationsPanel recordContext={recordContext} />, reconciliation: <RentalReconciliationPanel />, "rentec-payment-import": <RentecPaymentImportPanel onNavigate={onNavigate} />, "rentec-financial-history-import": <RentecFinancialHistoryImportPanel />, reports: <RentalReportsPanel />, "financial-setup": <PropertyFinancialSetupPanel recordContext={recordContext} />, deposits: <RentalDepositsPanel />, inspections: <RentalInspectionsPanel recordContext={recordContext} />, "lease-lifecycle": <RentalLeaseLifecyclePanel />, "lease-preparation": <RentalLeasePreparationPanel />, autopay: <RentalAutopayPanel />, animals: <RentalAnimalsPanel />, support: <RentalSupportPanel />, "private-financing": <PrivateFinancingAccountsPanel /> };
  return surfaces[id] || <RentalOverviewPanel onNavigate={onNavigate} />;
}

export default function RentalApplicationShell({ activeFunctionId, activeRecordContext = null, onFunctionChange }) {
  const activeId = resolveActiveFunction(RENTAL_FUNCTIONS, activeFunctionId);
  const [showHelp, setShowHelp] = useState(false);
  const sidebarPrefs = useSidebarHiddenItems(SIDEBAR_KEY);
  activeRecordContext = activeRecordContext ? { ...activeRecordContext, recordLabel: activeRecordContext.recordLabel || (activeRecordContext.recordType === "tenant" ? "selected tenant" : activeRecordContext.propertyId || "selected property") } : null;
  return <section data-rental-application-shell data-active-function={activeId} className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-950">
    <header className="border-b border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-4 text-slate-950 dark:text-slate-100 lg:px-8">
      <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">FORGE Application</p>
          <h1 className="text-2xl font-black tracking-tight">Rental Manager</h1>
        </div>
        <button
          type="button"
          onClick={() => setShowHelp(true)}
          title="Rental Manager workflows and button guide"
          aria-haspopup="dialog"
          className="flex shrink-0 items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-sm font-black hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:border-slate-600 dark:hover:bg-slate-800"
        >
          <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-950 text-xs text-white dark:bg-amber-400 dark:text-slate-950">?</span>
          <span>Help</span>
        </button>
      </div>
    </header>
    <div className="mx-auto grid max-w-[1800px] grid-cols-1 gap-5 p-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-6 lg:p-8">
      <label className="lg:hidden"><span className="sr-only">Rental function</span><select value={activeId} onChange={(event) => onFunctionChange?.(event.target.value)} className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-3 font-bold text-slate-950 dark:text-slate-100">{RENTAL_NAVIGATION.flatMap((group) => group.subCategories ? group.subCategories.map((subCategory) => ({ key: `${group.label}::${subCategory.label}`, label: `${group.label} — ${subCategory.label}`, items: subCategory.items.filter((item) => !isItemHidden(group, item.id, sidebarPrefs.hiddenItemIds)) })).filter((entry) => entry.items.length > 0) : [{ key: group.label, label: group.label, items: group.items.filter((item) => !isItemHidden(group, item.id, sidebarPrefs.hiddenItemIds)) }].filter((entry) => entry.items.length > 0)).map((entry) => <optgroup key={entry.key} label={entry.label}>{entry.items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
      <RentalNavSidebar activeId={activeId} onFunctionChange={onFunctionChange} sidebarPrefs={sidebarPrefs} />
      <main data-active-function-surface={activeId} data-record-context={activeRecordContext?.recordId || undefined} className="min-w-0">{activeRecordContext?<div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950 px-4 py-3" role="status"><p className="text-sm font-bold text-sky-950 dark:text-sky-100">Working with {activeRecordContext.recordType === "tenant" ? "tenant" : "property"}: {activeRecordContext.recordLabel}</p><button type="button" onClick={()=>onFunctionChange?.(activeRecordContext.recordType === "tenant" ? "tenants" : "setup")} className="text-sm font-black text-sky-800 dark:text-sky-300 underline">Back to record</button></div>:null}{buildRentalSurface(activeId, { onNavigate: onFunctionChange, recordContext: activeRecordContext })}</main>
    </div>
    {showHelp && <RentalHelpModal activeFunctionId={activeId} onClose={() => setShowHelp(false)} />}
  </section>;
}

const NAV_COLLAPSE_STORAGE_KEY = "forge-rental-nav-sidebar-collapsed";
// A sub-category's collapse key is namespaced under its parent group label so it can never collide
// with a top-level group of the same name.
function subCategoryKey(group, subCategory) {
  return `${group.label}::${subCategory.label}`;
}
// Nav starts quiet: every group (and every sub-category within a group that has them) collapses by
// default except the one holding the active destination. This only affects initial visual weight —
// every destination in RENTAL_NAVIGATION stays reachable via its group/sub-category header, and an
// explicit user toggle is persisted and always wins over this default on the next load.
function defaultCollapsedGroups(activeId) {
  const collapsed = [];
  for (const group of RENTAL_NAVIGATION) {
    if (group.subCategories) {
      for (const subCategory of group.subCategories) {
        if (!subCategory.items.some((item) => item.id === activeId)) collapsed.push(subCategoryKey(group, subCategory));
      }
      if (!itemsForGroup(group).some((item) => item.id === activeId)) collapsed.push(group.label);
    } else if (!group.items.some((item) => item.id === activeId)) {
      collapsed.push(group.label);
    }
  }
  return collapsed;
}
function loadStoredCollapsedNavGroups() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(NAV_COLLAPSE_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function NavFunctionButton({ item, activeId, onFunctionChange }) {
  return (
    <button
      type="button"
      aria-current={activeId === item.id ? "page" : undefined}
      onClick={() => onFunctionChange?.(item.id)}
      className={`w-full rounded-lg px-3 py-1.5 text-left text-sm font-bold transition motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
        activeId === item.id
          ? "bg-slate-950 text-white dark:bg-amber-400 dark:text-slate-950"
          : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
      }`}
    >
      {item.label}
    </button>
  );
}
function NavGroupToggle({ label, open, onToggle, className }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={className}
    >
      <span>{label}</span>
      <span aria-hidden="true" className="text-[10px] text-slate-400">{open ? "▾" : "▸"}</span>
    </button>
  );
}
function visibleItems(group, items, hiddenItemIds) {
  return items.filter((item) => !isItemHidden(group, item.id, hiddenItemIds));
}

function RentalNavSidebar({ activeId, onFunctionChange, sidebarPrefs }) {
  const [collapsed, setCollapsed] = useState(() => loadStoredCollapsedNavGroups() ?? defaultCollapsedGroups(activeId));
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const { hiddenItemIds } = sidebarPrefs;
  const toggleKey = (key) => {
    setCollapsed((current) => {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
      window.localStorage.setItem(NAV_COLLAPSE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };
  return (
    <aside className="hidden self-start lg:block">
      <div className="relative mb-2">
        <button
          type="button"
          onClick={() => setCustomizeOpen((current) => !current)}
          aria-haspopup="dialog"
          aria-expanded={customizeOpen}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-slate-500 hover:border-slate-300 hover:text-slate-950 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-white"
        >
          <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
          <span>Customize</span>
        </button>
        {customizeOpen && <SidebarCustomizePopover sidebarPrefs={sidebarPrefs} onClose={() => setCustomizeOpen(false)} />}
      </div>
      <nav aria-label="Rental Manager functions" className="space-y-3">
        {RENTAL_NAVIGATION.map((group) => {
          if (!group.subCategories) {
            const items = visibleItems(group, group.items, hiddenItemIds);
            if (group.items.length > 0 && items.length === 0) return null;
            const containsActive = items.some((item) => item.id === activeId);
            const open = !collapsed.includes(group.label) || containsActive;
            return (
              <div key={group.label}>
                <NavGroupToggle
                  label={group.label}
                  open={open}
                  onToggle={() => toggleKey(group.label)}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 hover:text-slate-950 dark:text-slate-500 dark:hover:text-white"
                />
                {open && (
                  <div className="mt-0.5 space-y-0.5">
                    {items.map((item) => (
                      <NavFunctionButton key={item.id} item={item} activeId={activeId} onFunctionChange={onFunctionChange} />
                    ))}
                  </div>
                )}
              </div>
            );
          }
          const visibleSubCategories = group.subCategories
            .map((subCategory) => ({ subCategory, items: visibleItems(group, subCategory.items, hiddenItemIds) }))
            .filter(({ subCategory, items }) => subCategory.items.length === 0 || items.length > 0);
          if (visibleSubCategories.length === 0) return null;
          const containsActive = visibleSubCategories.some(({ items }) => items.some((item) => item.id === activeId));
          const open = !collapsed.includes(group.label) || containsActive;
          return (
            <div key={group.label}>
              <NavGroupToggle
                label={group.label}
                open={open}
                onToggle={() => toggleKey(group.label)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 hover:text-slate-950 dark:text-slate-500 dark:hover:text-white"
              />
              {open && (
                <div className="mt-0.5 space-y-0.5">
                  {visibleSubCategories.map(({ subCategory, items }) => {
                    const key = subCategoryKey(group, subCategory);
                    const subContainsActive = items.some((item) => item.id === activeId);
                    const subOpen = !collapsed.includes(key) || subContainsActive;
                    return (
                      <div key={key} className="pl-2">
                        <NavGroupToggle
                          label={subCategory.label}
                          open={subOpen}
                          onToggle={() => toggleKey(key)}
                          className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400 hover:text-slate-950 dark:text-slate-500 dark:hover:text-white"
                        />
                        {subOpen && (
                          <div className="mt-0.5 space-y-0.5">
                            {subCategory.items.length === 0 ? (
                              <p className="px-3 py-1 text-xs italic text-slate-400 dark:text-slate-500">No {subCategory.label.toLowerCase()} tools yet</p>
                            ) : (
                              items.map((item) => (
                                <NavFunctionButton key={item.id} item={item} activeId={activeId} onFunctionChange={onFunctionChange} />
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function SidebarCustomizePopover({ sidebarPrefs, onClose }) {
  const { hiddenItemIds, saving, error, toggleItem, showAll } = sidebarPrefs;
  return (
    <div
      role="dialog"
      aria-label="Customize sidebar"
      className="absolute left-0 top-full z-20 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">Customize sidebar</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close customize sidebar"
          className="rounded p-0.5 text-slate-400 hover:text-slate-950 dark:hover:text-white"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <button
        type="button"
        onClick={showAll}
        disabled={saving || hiddenItemIds.size === 0}
        className="mb-2 flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 hover:border-slate-300 hover:text-slate-950 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"
      >
        <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
        <span>Show all</span>
      </button>
      {error && <p role="alert" className="mb-2 text-xs font-bold text-red-600 dark:text-red-400">{error}</p>}
      <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
        {HIDEABLE_SIDEBAR_SECTIONS.map((section) => (
          <div key={section.sectionLabel}>
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">{section.sectionLabel}</p>
            {section.items.map((item) => (
              <label key={item.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                <input
                  type="checkbox"
                  checked={!hiddenItemIds.has(item.id)}
                  onChange={() => toggleItem(item.id)}
                  disabled={saving}
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:border-slate-600"
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
