"use client";
import { resolveActiveFunction } from "@/components/forge/workspace/ApplicationShell";
import RentalOverviewPanel from "./RentalOverviewPanel"; import RentalSetupPanel from "./RentalSetupPanel"; import RentalTenantPanel from "./RentalTenantPanel"; import RentalLeasePanel from "./RentalLeasePanel"; import RentalPaymentsPanel from "./RentalPaymentsPanel"; import RentalInsurancePanel from "./RentalInsurancePanel"; import RentalMaintenancePanel from "./RentalMaintenancePanel"; import RentalDocumentsPanel from "./RentalDocumentsPanel"; import RentalCommunicationsPanel from "./RentalCommunicationsPanel"; import RentalReconciliationPanel from "./RentalReconciliationPanel"; import RentalReportsPanel from "./RentalReportsPanel"; import RentalDepositsPanel from "./RentalDepositsPanel"; import RentalInspectionsPanel from "./RentalInspectionsPanel"; import RentalLeaseLifecyclePanel from "./RentalLeaseLifecyclePanel"; import RentalLeasePreparationPanel from "./RentalLeasePreparationPanel"; import RentalAutopayPanel from "./RentalAutopayPanel"; import RentalAnimalsPanel from "./RentalAnimalsPanel"; import RentalSupportPanel from "./RentalSupportPanel";

export const RENTAL_NAVIGATION = Object.freeze([
  Object.freeze({ label: "Overview", items: Object.freeze([{ id: "overview", label: "Summary" }]) }),
  Object.freeze({ label: "Portfolio", items: Object.freeze([{ id: "setup", label: "Property & Unit" }, { id: "tenants", label: "Tenants" }, { id: "leases", label: "Leases" }]) }),
  Object.freeze({ label: "Money", items: Object.freeze([{ id: "charges", label: "Rent & Payments" }, { id: "reconciliation", label: "Reconciliation" }, { id: "deposits", label: "Deposits" }, { id: "reports", label: "Reports" }]) }),
  Object.freeze({ label: "Operations", items: Object.freeze([{ id: "maintenance", label: "Maintenance" }, { id: "inspections", label: "Inspections" }, { id: "insurance", label: "Insurance" }, { id: "documents", label: "Documents" }, { id: "communications", label: "Communications" }]) }),
  Object.freeze({ label: "Controls", items: Object.freeze([{ id: "lease-lifecycle", label: "Lease Changes" }, { id: "lease-preparation", label: "Lease Editor" }, { id: "autopay", label: "Autopay" }, { id: "animals", label: "Animals" }, { id: "support", label: "Support" }]) }),
]);
export const RENTAL_FUNCTIONS = Object.freeze(RENTAL_NAVIGATION.flatMap((group) => group.items));

export function buildRentalSurface(id, { onNavigate } = {}) {
  const surfaces = { setup: <RentalSetupPanel />, tenants: <RentalTenantPanel />, leases: <RentalLeasePanel />, charges: <RentalPaymentsPanel />, insurance: <RentalInsurancePanel />, maintenance: <RentalMaintenancePanel />, documents: <RentalDocumentsPanel />, communications: <RentalCommunicationsPanel />, reconciliation: <RentalReconciliationPanel />, reports: <RentalReportsPanel />, deposits: <RentalDepositsPanel />, inspections: <RentalInspectionsPanel />, "lease-lifecycle": <RentalLeaseLifecyclePanel />, "lease-preparation": <RentalLeasePreparationPanel />, autopay: <RentalAutopayPanel />, animals: <RentalAnimalsPanel />, support: <RentalSupportPanel /> };
  return surfaces[id] || <RentalOverviewPanel onNavigate={onNavigate} />;
}

export default function RentalApplicationShell({ activeFunctionId, onFunctionChange }) {
  const activeId = resolveActiveFunction(RENTAL_FUNCTIONS, activeFunctionId);
  return <section data-rental-application-shell data-active-function={activeId} className="min-h-screen bg-slate-100 text-slate-950">
    <header className="border-b border-slate-200 bg-white px-4 py-5 lg:px-8"><div className="mx-auto max-w-[1800px]"><p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700">FORGE Application</p><h1 className="text-3xl font-black tracking-tight">Rental Manager</h1><p className="mt-1 text-sm font-semibold text-slate-600">Tenant, lease, rent, payment, reconciliation, and maintenance operations.</p></div></header>
    <div className="mx-auto grid max-w-[1800px] gap-5 p-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:p-8">
      <label className="lg:hidden"><span className="sr-only">Rental function</span><select value={activeId} onChange={(event) => onFunctionChange?.(event.target.value)} className="w-full rounded-xl border border-slate-300 bg-white p-3 font-bold">{RENTAL_NAVIGATION.map((group) => <optgroup key={group.label} label={group.label}>{group.items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
      <aside className="hidden self-start rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:block"><nav aria-label="Rental Manager functions" className="space-y-4">{RENTAL_NAVIGATION.map((group) => <div key={group.label}><p className="px-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{group.label}</p><div className="mt-1 space-y-1">{group.items.map((item) => <button key={item.id} type="button" aria-current={activeId === item.id ? "page" : undefined} onClick={() => onFunctionChange?.(item.id)} className={`w-full rounded-lg px-3 py-2 text-left text-sm font-bold transition ${activeId === item.id ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}>{item.label}</button>)}</div></div>)}</nav></aside>
      <main data-active-function-surface={activeId} className="min-w-0">{buildRentalSurface(activeId, { onNavigate: onFunctionChange })}</main>
    </div>
  </section>;
}
