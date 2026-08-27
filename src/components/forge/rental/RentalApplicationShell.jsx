"use client";
import { useEffect, useState } from "react";
import { resolveActiveFunction } from "@/components/forge/workspace/ApplicationShell";
import RentalContextualSurface from "./RentalContextualSurface";
import RentalOverviewPanel from "./RentalOverviewPanel"; import RentalSetupPanel from "./RentalSetupPanel"; import RentalTenantPanel from "./RentalTenantPanel"; import RentalLeasePanel from "./RentalLeasePanel"; import RentalPaymentsPanel from "./RentalPaymentsPanel"; import RentalInsurancePanel from "./RentalInsurancePanel"; import RentalMaintenancePanel from "./RentalMaintenancePanel"; import RentalDocumentsPanel from "./RentalDocumentsPanel"; import RentalCommunicationsPanel from "./RentalCommunicationsPanel"; import RentalReconciliationPanel from "./RentalReconciliationPanel"; import RentalReportsPanel from "./RentalReportsPanel"; import RentalDepositsPanel from "./RentalDepositsPanel"; import RentalInspectionsPanel from "./RentalInspectionsPanel"; import RentalLeaseLifecyclePanel from "./RentalLeaseLifecyclePanel"; import RentalLeasePreparationPanel from "./RentalLeasePreparationPanel"; import RentalAutopayPanel from "./RentalAutopayPanel"; import RentalAnimalsPanel from "./RentalAnimalsPanel"; import RentalSupportPanel from "./RentalSupportPanel";
import RentecMigrationPanel from "./RentecMigrationPanel";
import RentecFileInventoryPanel from "./RentecFileInventoryPanel";
import RentecPaymentImportPanel from "./RentecPaymentImportPanel";
import RentecFinancialHistoryImportPanel from "./RentecFinancialHistoryImportPanel";
import PropertyFinancialSetupPanel from "./PropertyFinancialSetupPanel";
import RentalHelpModal from "./RentalHelpModal";

export const RENTAL_NAVIGATION = Object.freeze([
  Object.freeze({ label: "Overview", items: Object.freeze([{ id: "overview", label: "Summary" }]) }),
  Object.freeze({ label: "Portfolio", items: Object.freeze([{ id: "setup", label: "Property & Unit" }, { id: "tenants", label: "Tenants" }, { id: "leases", label: "Leases" }, { id: "rentec-migration", label: "Rentec Migration" }, { id: "rentec-files", label: "Rentec Files" }]) }),
  Object.freeze({ label: "Money", items: Object.freeze([{ id: "charges", label: "Rent & Payments" }, { id: "reconciliation", label: "Reconciliation" }, { id: "rentec-payment-import", label: "Rentec Payment Import" }, { id: "rentec-financial-history-import", label: "Rentec Financial History Import" }, { id: "financial-setup", label: "Financial Setup" }, { id: "deposits", label: "Deposits" }, { id: "reports", label: "Reports" }]) }),
  Object.freeze({ label: "Operations", items: Object.freeze([{ id: "maintenance", label: "Maintenance" }, { id: "inspections", label: "Inspections" }, { id: "insurance", label: "Insurance" }, { id: "documents", label: "Documents" }, { id: "communications", label: "Communications" }]) }),
  Object.freeze({ label: "Controls", items: Object.freeze([{ id: "lease-lifecycle", label: "Lease Changes" }, { id: "lease-preparation", label: "Lease Editor" }, { id: "autopay", label: "Autopay" }, { id: "animals", label: "Animals" }, { id: "support", label: "Support" }]) }),
]);
export const RENTAL_FUNCTIONS = Object.freeze(RENTAL_NAVIGATION.flatMap((group) => group.items));

export function buildRentalSurface(id, { onNavigate, recordContext = null } = {}) {
  if(recordContext&&["charges","maintenance","inspections","documents","communications"].includes(id))return <RentalContextualSurface surfaceId={id} recordContext={recordContext}/>;
  const surfaces = { setup: <RentalSetupPanel onNavigate={onNavigate} />, tenants: <RentalTenantPanel onNavigate={onNavigate} />, leases: <RentalLeasePanel recordContext={recordContext} />, "rentec-migration": <RentecMigrationPanel />, "rentec-files": <RentecFileInventoryPanel />, charges: <RentalPaymentsPanel recordContext={recordContext} />, insurance: <RentalInsurancePanel />, maintenance: <RentalMaintenancePanel recordContext={recordContext} />, documents: <RentalDocumentsPanel recordContext={recordContext} />, communications: <RentalCommunicationsPanel recordContext={recordContext} />, reconciliation: <RentalReconciliationPanel />, "rentec-payment-import": <RentecPaymentImportPanel onNavigate={onNavigate} />, "rentec-financial-history-import": <RentecFinancialHistoryImportPanel />, reports: <RentalReportsPanel />, "financial-setup": <PropertyFinancialSetupPanel recordContext={recordContext} />, deposits: <RentalDepositsPanel />, inspections: <RentalInspectionsPanel recordContext={recordContext} />, "lease-lifecycle": <RentalLeaseLifecyclePanel />, "lease-preparation": <RentalLeasePreparationPanel />, autopay: <RentalAutopayPanel />, animals: <RentalAnimalsPanel />, support: <RentalSupportPanel /> };
  return surfaces[id] || <RentalOverviewPanel onNavigate={onNavigate} />;
}

export default function RentalApplicationShell({ activeFunctionId, activeRecordContext = null, onFunctionChange }) {
  const activeId = resolveActiveFunction(RENTAL_FUNCTIONS, activeFunctionId);
  const [showHelp, setShowHelp] = useState(false);
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
      <label className="lg:hidden"><span className="sr-only">Rental function</span><select value={activeId} onChange={(event) => onFunctionChange?.(event.target.value)} className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-3 font-bold text-slate-950 dark:text-slate-100">{RENTAL_NAVIGATION.map((group) => <optgroup key={group.label} label={group.label}>{group.items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
      <RentalNavSidebar activeId={activeId} onFunctionChange={onFunctionChange} />
      <main data-active-function-surface={activeId} data-record-context={activeRecordContext?.recordId || undefined} className="min-w-0">{activeRecordContext?<div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950 px-4 py-3" role="status"><p className="text-sm font-bold text-sky-950 dark:text-sky-100">Working with {activeRecordContext.recordType === "tenant" ? "tenant" : "property"}: {activeRecordContext.recordLabel}</p><button type="button" onClick={()=>onFunctionChange?.(activeRecordContext.recordType === "tenant" ? "tenants" : "setup")} className="text-sm font-black text-sky-800 dark:text-sky-300 underline">Back to record</button></div>:null}{buildRentalSurface(activeId, { onNavigate: onFunctionChange, recordContext: activeRecordContext })}</main>
    </div>
    {showHelp && <RentalHelpModal activeFunctionId={activeId} onClose={() => setShowHelp(false)} />}
  </section>;
}

const NAV_COLLAPSE_STORAGE_KEY = "forge-rental-nav-sidebar-collapsed";
// Nav starts quiet: every group collapses by default except the one holding the active
// destination. This only affects initial visual weight — every destination in RENTAL_NAVIGATION
// stays reachable via its group header, and an explicit user toggle is persisted and always wins
// over this default on the next load.
function defaultCollapsedGroups(activeId) {
  return RENTAL_NAVIGATION.filter((group) => !group.items.some((item) => item.id === activeId)).map((group) => group.label);
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
function RentalNavSidebar({ activeId, onFunctionChange }) {
  const [collapsed, setCollapsed] = useState(() => defaultCollapsedGroups(activeId));
  useEffect(() => {
    const stored = loadStoredCollapsedNavGroups();
    if (stored !== null) setCollapsed(stored);
  }, []);
  const toggleGroup = (label) => {
    setCollapsed((current) => {
      const next = current.includes(label) ? current.filter((item) => item !== label) : [...current, label];
      window.localStorage.setItem(NAV_COLLAPSE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };
  return (
    <aside className="hidden self-start lg:block">
      <nav aria-label="Rental Manager functions" className="space-y-3">
        {RENTAL_NAVIGATION.map((group) => {
          const containsActive = group.items.some((item) => item.id === activeId);
          const open = !collapsed.includes(group.label) || containsActive;
          return (
            <div key={group.label}>
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                aria-expanded={open}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 hover:text-slate-950 dark:text-slate-500 dark:hover:text-white"
              >
                <span>{group.label}</span>
                <span aria-hidden="true" className="text-[10px] text-slate-400">{open ? "▾" : "▸"}</span>
              </button>
              {open && (
                <div className="mt-0.5 space-y-0.5">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
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
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
