"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Building2, AlertTriangle, RefreshCcw, DoorOpen, CalendarClock, Wrench, ShieldCheck,
  PauseCircle, PlayCircle, Home,
} from "lucide-react";
import { buildRentalDashboardSummary } from "@/application/rental/buildRentalDashboardSummary";
import { buildRentalFinancialPerformance } from "@/application/rental/buildRentalFinancialPerformance";
import ForgeMetricTile from "@/components/forge/ForgeMetricTile";
import ForgeNeedsAttentionQueue from "@/components/forge/ForgeNeedsAttentionQueue";
import ForgeComparisonBarChart from "@/components/forge/ForgeComparisonBarChart";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const PERIOD_OPTIONS = Object.freeze([
  { type: "sixMonths", label: "6 Months" },
  { type: "ytd", label: "YTD" },
  { type: "year", label: "Year" },
  { type: "allTime", label: "All time" },
]);

function PortfolioPerformanceSection({ financialEvents }) {
  const [periodType, setPeriodType] = useState("sixMonths");
  const [selectedYear, setSelectedYear] = useState(null);

  const availableYears = useMemo(
    () => buildRentalFinancialPerformance(financialEvents, { period: { type: "sixMonths" } }).availableYears,
    [financialEvents],
  );
  const today = new Date();
  const effectiveYear = selectedYear ?? availableYears.at(-1) ?? today.getUTCFullYear();

  const performance = useMemo(() => buildRentalFinancialPerformance(financialEvents, {
    period: periodType === "year" ? { type: "year", year: effectiveYear } : { type: periodType },
  }), [financialEvents, periodType, effectiveYear]);

  const currentKey = performance.granularity === "yearly"
    ? String(today.getUTCFullYear())
    : today.toISOString().slice(0, 7);

  return (
    <section aria-labelledby="rental-performance-heading" className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 id="rental-performance-heading" className="text-lg font-black text-slate-950 dark:text-white">Portfolio performance</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Rent collected vs. rental operating expenses — cash basis (recorded when money moved, not when billed or earned).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Select time period">
          {PERIOD_OPTIONS.map((option) => (
            <button key={option.type} type="button" data-period-option={option.type}
              aria-pressed={periodType === option.type} onClick={() => setPeriodType(option.type)}
              className={`rounded-full px-3 py-1.5 text-xs font-black transition motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                periodType === option.type
                  ? goldControlClassName
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              {option.label}
            </button>
          ))}
          {periodType === "year" && (
            <label className="text-xs font-bold text-slate-600 dark:text-slate-400">
              <span className="sr-only">Select year</span>
              <select value={effectiveYear} onChange={(event) => setSelectedYear(Number(event.target.value))}
                disabled={availableYears.length === 0}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-white">
                {availableYears.length === 0
                  ? <option value={effectiveYear}>{effectiveYear}</option>
                  : availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </label>
          )}
        </div>
      </div>

      <div data-performance-summary className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950/30">
          <p className="text-xs font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Collected</p>
          <p className="mt-1 text-xl font-black tabular-nums text-emerald-900 dark:text-emerald-200">{money.format(performance.totals.collectedCents / 100)}</p>
        </div>
        <div className="rounded-xl bg-amber-50 p-4 dark:bg-amber-950/30">
          <p className="text-xs font-black uppercase tracking-wide text-amber-700 dark:text-amber-400">Expenses</p>
          <p className="mt-1 text-xl font-black tabular-nums text-amber-900 dark:text-amber-200">{money.format(performance.totals.expensesCents / 100)}</p>
        </div>
        <div className="rounded-xl bg-cyan-50 p-4 dark:bg-cyan-950/30">
          <p className="text-xs font-black uppercase tracking-wide text-cyan-700 dark:text-cyan-400">Net</p>
          <p className="mt-1 text-xl font-black tabular-nums text-cyan-900 dark:text-cyan-200">
            {performance.totals.netCents < 0 ? `-${money.format(Math.abs(performance.totals.netCents) / 100)}` : money.format(performance.totals.netCents / 100)}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <ForgeComparisonBarChart
          title="Collected per period" series={performance.series.map((point) => Object.freeze({ key: point.key, primaryCents: point.collectedCents, secondaryCents: point.expensesCents }))}
          primaryLabel="Rent collected" secondaryLabel="Rental operating expenses" netLabel="Net cash flow"
          formatValue={(cents) => money.format(cents / 100)} currentKey={currentKey}
        />
      </div>

      <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
        Includes rent recorded in Rentec before FORGE began collecting, alongside FORGE-processed payments — this total can differ from "Collected this month" above, which reflects FORGE-processed payments only.
      </p>
    </section>
  );
}

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

function HeroHeader({ summary, occupancyPercent, onNavigate }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-center lg:justify-between lg:p-8">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Rental operations</p>
          <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Summary</h2>
          <p className="mt-2 max-w-xl text-sm text-slate-600 dark:text-slate-400">Start with what needs attention, then move into the supporting record.</p>
          <div className="mt-4 flex items-center gap-3">
            <PortfolioStrip units={summary.portfolioUnits} />
            <span className="text-sm font-bold text-slate-600 dark:text-slate-400">
              {summary.totalUnits} unit{summary.totalUnits === 1 ? "" : "s"} · {occupancyPercent}% occupied
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <BillingStatusChip billingEnabled={summary.billingEnabled} onNavigate={onNavigate} />
          <div className="rounded-2xl bg-slate-950 px-6 py-4 text-white dark:bg-slate-800">
            <p className="text-xs font-black uppercase tracking-wide text-slate-300">Collected this month</p>
            <p className="mt-1 text-3xl font-black tabular-nums">{money.format(summary.collectedThisMonthCents / 100)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyPortfolioState({ onNavigate }) {
  return (
    <section className="space-y-6" data-rental-overview data-rental-overview-empty>
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Rental operations</p>
        <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Summary</h2>
      </div>
      <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-slate-300 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-900">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400" aria-hidden="true">
          <Building2 size={26} strokeWidth={2.25} />
        </span>
        <div>
          <h3 className="text-lg font-black text-slate-950 dark:text-white">Add your first property to get started</h3>
          <p className="mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
            Once a property and unit are on file, this summary will surface occupancy, rent collection, and what needs your attention.
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
    Promise.all([fetch("/api/rental"), fetch("/api/rental/reports")]).then(async ([rentalResponse, reportResponse]) => {
      const rentalBody = await rentalResponse.json(); const reportBody = await reportResponse.json();
      if (!rentalResponse.ok) throw new Error(rentalBody.error || "Rental summary could not be loaded.");
      if (!reportResponse.ok) throw new Error(reportBody.error || "Rental report could not be loaded.");
      setSummary(buildRentalDashboardSummary(rentalBody, reportBody.report));
    }).catch((reason) => setError(reason.message));
  }, [initialData]);

  if (error) return <p role="alert" className="rounded-2xl bg-red-50 p-4 text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>;
  if (!summary) return (
    <section className="space-y-5" data-rental-overview>
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Rental operations</p>
        <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Summary</h2>
      </div>
      <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">Loading rental summary…</p>
    </section>
  );
  if (summary.totalUnits === 0) return <EmptyPortfolioState onNavigate={onNavigate} />;

  const occupancyPercent = summary.totalUnits > 0 ? Math.round((summary.occupiedUnits / summary.totalUnits) * 100) : 0;

  const kpis = [
    {
      metricKey: "occupancy", icon: Building2, label: "Portfolio occupancy", value: `${occupancyPercent}%`,
      detail: `${summary.occupiedUnits} of ${summary.totalUnits} units occupied`,
      tone: summary.vacancies > 0 ? "neutral" : "success", destination: "setup",
    },
    {
      metricKey: "overdue-forge", icon: AlertTriangle, label: "FORGE-collectible overdue", value: money.format(summary.overdueBalanceCents / 100),
      detail: summary.overdueBalanceCents > 0 ? "Collectible now on FORGE-activated leases." : "Nothing overdue on FORGE-collected leases.",
      tone: summary.overdueBalanceCents > 0 ? "attention" : "success", destination: "charges",
    },
    {
      metricKey: "externally-managed", icon: RefreshCcw, label: "Externally managed — reconciliation required", value: money.format(summary.externallyManagedCents / 100),
      detail: summary.externallyManagedCents > 0
        ? `${summary.externallyManagedChargeCount} charge${summary.externallyManagedChargeCount === 1 ? "" : "s"} still authoritative in Rentec.`
        : "No externally managed balance on file.",
      tone: summary.externallyManagedCents > 0 ? "attention" : "neutral", destination: "rentec-payment-import",
    },
    {
      metricKey: "vacancies", icon: DoorOpen, label: "Vacancies", value: String(summary.vacancies),
      detail: summary.vacancies > 0 ? "Ready to list or show." : "Fully leased.",
      tone: summary.vacancies > 0 ? "attention" : "success", destination: "setup",
    },
    {
      metricKey: "lease-expirations", icon: CalendarClock, label: "Lease expirations (90 days)", value: String(summary.expiringLeases),
      detail: summary.expiringLeases > 0
        ? `${summary.expiringLeasesWithin30Days} of ${summary.expiringLeases} due within 30 days.`
        : "Nothing expiring in the next 90 days.",
      tone: summary.expiringLeases > 0 ? "attention" : "neutral", destination: "lease-lifecycle",
    },
    {
      metricKey: "maintenance", icon: Wrench, label: "Open maintenance", value: String(summary.openMaintenance),
      detail: summary.openMaintenance > 0 ? "Requests in progress." : "No open requests.",
      tone: summary.openMaintenance > 0 ? "attention" : "success", destination: "maintenance",
    },
    {
      metricKey: "readiness", icon: ShieldCheck, label: "Readiness gaps", value: String(summary.readinessIssueCount),
      detail: "Insurance, deposits, and move-in inspections.",
      tone: summary.readinessIssueCount > 0 ? "attention" : "success", destination: "insurance",
    },
  ];

  return (
    <section className="space-y-6" data-rental-overview>
      <HeroHeader summary={summary} occupancyPercent={occupancyPercent} onNavigate={onNavigate} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => <ForgeMetricTile key={kpi.metricKey} onNavigate={onNavigate} {...kpi} />)}
      </div>

      <section aria-labelledby="rental-needs-attention-heading" className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h3 id="rental-needs-attention-heading" className="text-lg font-black text-slate-950 dark:text-white">Needs attention</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Ordered by urgency — start at the top.</p>
        <div className="mt-4">
          <ForgeNeedsAttentionQueue items={summary.needsAttention} onNavigate={onNavigate} />
        </div>
      </section>

      <PortfolioPerformanceSection financialEvents={summary.financialEvents} />
    </section>
  );
}
