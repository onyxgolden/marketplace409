"use client";
import ApplicationShell from "@/components/forge/workspace/ApplicationShell";
import RentalOverviewPanel from "./RentalOverviewPanel";
import RentalSetupPanel from "./RentalSetupPanel";
import RentalTenantPanel from "./RentalTenantPanel";
import RentalLeasePanel from "./RentalLeasePanel";
import RentalPaymentsPanel from "./RentalPaymentsPanel";
import RentalInsurancePanel from "./RentalInsurancePanel";
import RentalMaintenancePanel from "./RentalMaintenancePanel";
import RentalDocumentsPanel from "./RentalDocumentsPanel";
import RentalCommunicationsPanel from "./RentalCommunicationsPanel";
import RentalReconciliationPanel from "./RentalReconciliationPanel";
import RentalReportsPanel from "./RentalReportsPanel";
import RentalDepositsPanel from "./RentalDepositsPanel";
import RentalInspectionsPanel from "./RentalInspectionsPanel";
import RentalLeaseLifecyclePanel from "./RentalLeaseLifecyclePanel";
import RentalLeasePreparationPanel from "./RentalLeasePreparationPanel";

export const RENTAL_FUNCTIONS = Object.freeze([
  Object.freeze({ id: "overview", label: "Launch Overview" }),
  Object.freeze({ id: "setup", label: "Property & Unit" }),
  Object.freeze({ id: "tenants", label: "Tenants" }),
  Object.freeze({ id: "leases", label: "Leases" }),
  Object.freeze({ id: "charges", label: "Rent & Payments" }),
  Object.freeze({ id: "insurance", label: "Insurance" }),
  Object.freeze({ id: "maintenance", label: "Maintenance" }),
  Object.freeze({ id: "documents", label: "Documents" }),
  Object.freeze({ id: "communications", label: "Communications" }),
  Object.freeze({ id: "reconciliation", label: "Reconciliation" }),
  Object.freeze({ id: "reports", label: "Reports" }),
  Object.freeze({ id: "deposits", label: "Deposits" }),
  Object.freeze({ id: "inspections", label: "Inspections" }),
  Object.freeze({ id: "lease-lifecycle", label: "Lease Changes" }),
  Object.freeze({ id: "lease-preparation", label: "Lease Editor" }),
]);
export function buildRentalSurface(id) {
  if (id === "setup") return <RentalSetupPanel />;
  if (id === "tenants") return <RentalTenantPanel />;
  if (id === "leases") return <RentalLeasePanel />;
  if (id === "charges") return <RentalPaymentsPanel />;
  if (id === "insurance") return <RentalInsurancePanel />;
  if (id === "maintenance") return <RentalMaintenancePanel />;
  if (id === "documents") return <RentalDocumentsPanel />;
  if (id === "communications") return <RentalCommunicationsPanel />;
  if (id === "reconciliation") return <RentalReconciliationPanel />;
  if (id === "reports") return <RentalReportsPanel />;
  if (id === "deposits") return <RentalDepositsPanel />;
  if (id === "inspections") return <RentalInspectionsPanel />;
  if (id === "lease-lifecycle") return <RentalLeaseLifecyclePanel />;
  if (id === "lease-preparation") return <RentalLeasePreparationPanel />;
  if (id === "overview") return <RentalOverviewPanel />;
  return <section className="rounded-2xl border border-slate-200 bg-white p-8"><h2 className="text-2xl font-black">{RENTAL_FUNCTIONS.find((item) => item.id === id)?.label}</h2>
    <p className="mt-2 text-slate-600">This function unlocks as the Kent Avenue launch ladder reaches it.</p></section>;
}
export default function RentalApplicationShell({ activeFunctionId, onFunctionChange }) {
  return <ApplicationShell applicationName="Rental Manager"
    applicationDescription="Tenant, lease, rent, payment, reconciliation, and maintenance operations for the first FORGE-managed rental."
    functions={RENTAL_FUNCTIONS} activeFunctionId={activeFunctionId} onFunctionChange={onFunctionChange}
    activeSurface={<div className="space-y-5">{buildRentalSurface(activeFunctionId)}</div>} />;
}
