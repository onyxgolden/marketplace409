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

export const RENTAL_FUNCTIONS = Object.freeze([
  Object.freeze({ id: "overview", label: "Launch Overview" }),
  Object.freeze({ id: "setup", label: "Property & Unit" }),
  Object.freeze({ id: "tenants", label: "Tenants" }),
  Object.freeze({ id: "leases", label: "Leases" }),
  Object.freeze({ id: "charges", label: "Rent & Payments" }),
  Object.freeze({ id: "insurance", label: "Insurance" }),
  Object.freeze({ id: "maintenance", label: "Maintenance" }),
  Object.freeze({ id: "documents", label: "Documents" }),
]);
export function buildRentalSurface(id) {
  if (id === "setup") return <RentalSetupPanel />;
  if (id === "tenants") return <RentalTenantPanel />;
  if (id === "leases") return <RentalLeasePanel />;
  if (id === "charges") return <RentalPaymentsPanel />;
  if (id === "insurance") return <RentalInsurancePanel />;
  if (id === "maintenance") return <RentalMaintenancePanel />;
  if (id === "documents") return <RentalDocumentsPanel />;
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
