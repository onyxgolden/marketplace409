"use client";
import { useEffect, useState } from "react";
import { buildRentalDashboardSummary } from "@/application/rental/buildRentalDashboardSummary";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const EXCEPTIONS = [
  ["vacancies", "Vacancies", "setup"], ["expiringLeases", "Leases expiring in 90 days", "lease-lifecycle"],
  ["overdueBalanceCents", "Overdue rent", "charges", true], ["openMaintenance", "Open maintenance", "maintenance"],
  ["awaitingSettlement", "Awaiting settlement", "reconciliation"], ["missingInsurance", "Missing insurance", "insurance"],
  ["openSupportCases", "Open support cases", "support"],
];

export default function RentalOverviewPanel({ onNavigate, initialData = null, initialReport = null }) {
  const [summary, setSummary] = useState(() => initialData ? buildRentalDashboardSummary(initialData, initialReport) : null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (initialData) return;
    Promise.all([fetch("/api/rental"), fetch("/api/rental/reports")]).then(async ([rentalResponse, reportResponse]) => {
      const rentalBody = await rentalResponse.json(); const reportBody = await reportResponse.json();
      if (!rentalResponse.ok) throw new Error(rentalBody.error || "Rental summary could not be loaded.");
      if (!reportResponse.ok) throw new Error(reportBody.error || "Rental report could not be loaded.");
      setSummary(buildRentalDashboardSummary(rentalBody, reportBody.report));
    }).catch((reason) => setError(reason.message));
  }, [initialData]);
  return <section className="space-y-5" data-rental-overview>
    <div><p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700">Rental operations</p><h2 className="mt-1 text-3xl font-black">Summary</h2>
      <p className="mt-2 text-slate-600">Start with what needs attention, then move into the supporting record.</p></div>
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p> : !summary ? <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-500">Loading rental summary…</p> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{EXCEPTIONS.map(([key, label, destination, currency]) => { const value = summary[key]; const attention = Number(value) > 0; return <button key={key} type="button" onClick={() => onNavigate?.(destination)}
        className={`rounded-2xl border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md ${attention ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}><span className="text-xs font-black uppercase tracking-wide text-slate-600">{label}</span>
        <strong className={`mt-2 block text-3xl ${attention ? "text-amber-800" : "text-slate-950"}`}>{currency ? money.format(value / 100) : value}</strong><span className="mt-2 block text-xs font-bold text-sky-700">Open details →</span></button>; })}</div>
      <div className="grid gap-4 lg:grid-cols-3"><Metric label="Occupancy" value={`${summary.occupiedUnits} of ${summary.totalUnits} units`} /><Metric label="Monthly scheduled" value={money.format(summary.monthlyScheduledCents / 100)} /><Metric label="Collected" value={money.format(summary.collectedCents / 100)} /></div>
    </>}
  </section>;
}
function Metric({ label, value }) { return <div className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white"><p className="text-xs font-black uppercase tracking-wide text-slate-300">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></div>; }
