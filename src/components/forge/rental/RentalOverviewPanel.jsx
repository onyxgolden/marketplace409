"use client";
import { useEffect, useState } from "react";
import {
  Building2, AlertTriangle, CalendarClock, Wrench, Wallet,
  PauseCircle, PlayCircle, Home,
} from "lucide-react";
import { buildRentalDashboardSummary } from "@/application/rental/buildRentalDashboardSummary";
import { getRentalSummaryPayload } from "./rentalSummaryClient";
import RentalTodaysPrioritiesPanel from "./guided-workflow/RentalTodaysPrioritiesPanel";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
// Fixed horizon for the "Expiring leases" card -- matches buildRentalDashboardSummary's window.
const EXPIRING_LEASE_HORIZON_DAYS = 90;
// Statuses buildRentalDashboardSummary counts as open maintenance.
const OPEN_MAINTENANCE_STATUSES_LABEL = "Open, pending, submitted, assigned, or in progress";

function BillingStatusChip({ billingEnabled, onNavigate }) {
  const Icon = billingEnabled ? PlayCircle : PauseCircle;
  const tone = billingEnabled
    ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30"
    : "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30";
  const iconTone = billingEnabled ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400";
  const labelTone = billingEnabled ? "text-emerald-700 dark:text-emerald-400" : "text-amber-800 dark:text-amber-400";
  const valueTone = billingEnabled ? "text-emerald-950 dark:text-emerald-100" : "text-amber-950 dark:text-amber-100";
  return (
    <button type="button" onClick={() => onNavigate?.("charges")} data-billing-status={billingEnabled ? "active" : "paused"}
      className={`flex items-center gap-3 rounded-2xl border px-5 py-4 text-left transition hover:shadow-md motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${tone}`}>
      <Icon size={22} className={iconTone} aria-hidden="true" />
      <span>
        <span className={`block text-xs font-black uppercase tracking-wide ${labelTone}`}>Online billing</span>
        <span className={`block text-lg font-black ${valueTone}`}>{billingEnabled ? "Active" : "Paused"}</span>
      </span>
    </button>
  );
}

function PortfolioStrip({ units }) {
  if (units.length === 0) return null;
  return (
    <div className="flex items-center -space-x-2" aria-hidden="true">
      {units.map((unit) => (
        <span key={unit.id} title={unit.label}
          className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white text-[10px] font-black text-white shadow-sm dark:border-slate-900 ${unit.occupied ? "bg-sky-700" : "bg-slate-400"}`}>
          {unit.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={unit.photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Home size={14} strokeWidth={2.5} />
          )}
        </span>
      ))}
    </div>
  );
}

function DashboardCard({ icon: Icon, label, value, detail, destination, onNavigate, tone }) {
  const tones = {
    neutral: "border-slate-200 dark:border-slate-700",
    success: "border-emerald-200 dark:border-emerald-900/60",
    attention: "border-amber-200 dark:border-amber-900/60",
  };
  return (
    <button
      type="button"
      onClick={() => onNavigate?.(destination)}
      data-dashboard-card={label}
      className={`min-w-0 rounded-3xl border bg-white p-6 text-left shadow-sm transition hover:shadow-md motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:bg-slate-900 ${tones[tone] || tones.neutral}`}
    >
      <div className="flex items-center gap-2">
        <Icon size={18} className="shrink-0 text-slate-400 dark:text-slate-500" aria-hidden="true" />
        <p className="truncate text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      </div>
      <p className="mt-3 text-4xl font-black tabular-nums tracking-tight text-slate-950 dark:text-white">{value}</p>
      <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-400">{detail}</p>
    </button>
  );
}

function EmptyPortfolioState({ onNavigate }) {
  return (
    <section className="space-y-6" data-rental-overview data-rental-overview-empty>
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Rental operations</p>
        <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Dashboard</h2>
      </div>
      <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-900">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400" aria-hidden="true">
          <Building2 size={26} strokeWidth={2.25} />
        </span>
        <div>
          <h3 className="text-lg font-black text-slate-950 dark:text-white">Add your first property to get started</h3>
          <p className="mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
            Once a property and unit are on file, this dashboard will surface rent collection, balances, occupancy, and what needs your attention.
          </p>
        </div>
        <button type="button" onClick={() => onNavigate?.("setup")}
          className="mt-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">
          Add a property
        </button>
      </div>
    </section>
  );
}

export default function RentalOverviewPanel({ onNavigate, initialData = null, initialReport = null }) {
  const [summary, setSummary] = useState(() => (initialData ? buildRentalDashboardSummary(initialData, initialReport) : null));
  const [error, setError] = useState("");
  useEffect(() => {
    if (initialData) return;
    // Shared with Today's Priorities: one deduped network pair, retried on network blips.
    // Reports stays fatal here, exactly as before -- an unavailable report throws.
    getRentalSummaryPayload().then(({ rentalBody, reports }) => {
      if (!reports.available) throw new Error(reports.error || "Rental report could not be loaded.");
      setSummary(buildRentalDashboardSummary(rentalBody, reports.report));
    }).catch((reason) => setError(reason.message));
  }, [initialData]);

  if (error) return <p role="alert" className="rounded-2xl bg-red-50 p-4 text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>;
  if (!summary) return (
    <section className="space-y-5" data-rental-overview>
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Rental operations</p>
        <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Dashboard</h2>
      </div>
      <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">Loading rental summary…</p>
    </section>
  );
  if (summary.totalUnits === 0) return <EmptyPortfolioState onNavigate={onNavigate} />;

  const occupancyPercent = summary.totalUnits > 0 ? Math.round((summary.occupiedUnits / summary.totalUnits) * 100) : 0;
  const collectedPeriodLabel = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });

  const cards = [
    {
      icon: Wallet, label: "Rent collected", destination: "charges", tone: "success",
      value: money.format(summary.collectedThisMonthCents / 100),
      detail: `${collectedPeriodLabel} — succeeded payments, net of refunds`,
    },
    {
      icon: AlertTriangle, label: "Outstanding balances", destination: "charges",
      tone: summary.openBalanceCents > 0 ? "attention" : "success",
      value: money.format(summary.openBalanceCents / 100),
      detail: summary.overdueBalanceCents > 0
        ? `Open rent-charge balances · ${money.format(summary.overdueBalanceCents / 100)} overdue`
        : "Open rent-charge balances · nothing overdue",
    },
    {
      icon: Building2, label: "Occupancy", destination: "setup",
      tone: summary.vacancies > 0 ? "neutral" : "success",
      value: `${occupancyPercent}%`,
      detail: `${summary.occupiedUnits} of ${summary.totalUnits} unit${summary.totalUnits === 1 ? "" : "s"} leased`,
    },
    {
      icon: Wrench, label: "Open maintenance", destination: "maintenance",
      tone: summary.openMaintenance > 0 ? "attention" : "success",
      value: String(summary.openMaintenance),
      detail: summary.openMaintenance > 0 ? OPEN_MAINTENANCE_STATUSES_LABEL : "No open requests",
    },
    {
      icon: CalendarClock, label: "Expiring leases", destination: "lease-lifecycle",
      tone: summary.expiringLeases > 0 ? "attention" : "neutral",
      value: String(summary.expiringLeases),
      detail: summary.expiringLeases > 0
        ? `${summary.expiringLeasesWithin30Days} due within 30 days · ${EXPIRING_LEASE_HORIZON_DAYS}-day window`
        : `Nothing expiring in the next ${EXPIRING_LEASE_HORIZON_DAYS} days`,
    },
  ];

  return (
    <section className="space-y-6" data-rental-overview>
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-center lg:justify-between lg:p-8">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Rental operations</p>
            <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Dashboard</h2>
            <p className="mt-2 max-w-xl text-sm text-slate-600 dark:text-slate-400">Five numbers that describe the portfolio right now — every figure comes from your rental records.</p>
            <div className="mt-4 flex items-center gap-3">
              <PortfolioStrip units={summary.portfolioUnits} />
              <span className="text-sm font-bold text-slate-600 dark:text-slate-400">
                {summary.totalUnits} unit{summary.totalUnits === 1 ? "" : "s"} · {occupancyPercent}% occupied
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <BillingStatusChip billingEnabled={summary.billingEnabled} onNavigate={onNavigate} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => <DashboardCard key={card.label} onNavigate={onNavigate} {...card} />)}
      </div>

      <section aria-label="Today's priorities" className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <RentalTodaysPrioritiesPanel onNavigate={onNavigate} />
      </section>
    </section>
  );
}
