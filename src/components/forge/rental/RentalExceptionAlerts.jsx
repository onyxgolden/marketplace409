"use client";
import { ArrowRight, Building2, CalendarClock, CheckCircle2, CreditCard, Plus, Wallet, Wrench } from "lucide-react";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Fixed horizon for the "Leases expiring soon" box -- matches
// buildRentalDashboardSummary's 90-day expiring-leases window.
const EXPIRING_LEASE_HORIZON_DAYS = 90;

const pluralize = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;

// Pure descriptor list for the four exception boxes. Kept separate from the
// markup so tests can assert the wiring (counts, destinations, filters)
// without mounting.
export function buildExceptionAlerts(summary) {
  const vacancies = Number(summary.vacancies || 0);
  const expiringLeases = Number(summary.expiringLeases || 0);
  const expiringWithin30Days = Number(summary.expiringLeasesWithin30Days || 0);
  const overdueBalanceCents = Number(summary.overdueBalanceCents || 0);
  const openMaintenance = Number(summary.openMaintenance || 0);
  return [
    {
      id: "vacancies",
      label: "Vacant units",
      icon: Building2,
      tone: "sky",
      count: vacancies,
      displayValue: String(vacancies),
      hasAction: vacancies > 0,
      destination: "setup",
      viewFilter: "vacant",
      actionDetail: `${pluralize(vacancies, "unit")} without an active lease`,
      clearDetail: "Every unit has an active lease.",
    },
    {
      id: "expiring-leases",
      label: "Leases expiring soon",
      icon: CalendarClock,
      tone: "amber",
      count: expiringLeases,
      displayValue: String(expiringLeases),
      hasAction: expiringLeases > 0,
      destination: "leases",
      viewFilter: "expiring",
      actionDetail: `${pluralize(expiringWithin30Days, "lease")} due within 30 days · ${EXPIRING_LEASE_HORIZON_DAYS}-day window`,
      clearDetail: `Nothing expiring in the next ${EXPIRING_LEASE_HORIZON_DAYS} days.`,
    },
    {
      id: "rent-overdue",
      label: "Rent overdue",
      icon: Wallet,
      tone: "red",
      count: overdueBalanceCents,
      displayValue: money.format(overdueBalanceCents / 100),
      hasAction: overdueBalanceCents > 0,
      destination: "charges",
      viewFilter: "overdue",
      actionDetail: "Overdue rent-charge balances",
      clearDetail: "No overdue rent.",
    },
    {
      id: "open-work-orders",
      label: "Open work orders",
      icon: Wrench,
      tone: "amber",
      count: openMaintenance,
      displayValue: String(openMaintenance),
      hasAction: openMaintenance > 0,
      destination: "maintenance",
      viewFilter: "open",
      actionDetail: "Open, pending, or in progress",
      clearDetail: "No open requests.",
    },
  ];
}

// Pure descriptor list for conditional quick-access links. A link only renders
// when there is something actionable behind it -- recording a payment needs a
// tenant on file, opening the work-order queue needs an open work order, and
// the add-property shortcut only renders once a portfolio exists (the empty
// portfolio's dedicated onboarding CTA owns that action before then).
export function buildQuickAccessLinks(summary) {
  const links = [];
  // Rendered only when a balance is actually owed: an occupied unit with no
  // open charge would lead to a queue with nothing actionable.
  if (Number(summary.openBalanceCents || 0) > 0) {
    links.push({ id: "record-payment", label: "Record payment", icon: CreditCard, destination: "charges", viewFilter: null });
  }
  if (Number(summary.totalUnits || 0) > 0) {
    links.push({ id: "add-property", label: "Add property", icon: Plus, destination: "setup", viewFilter: null });
  }
  if (Number(summary.openMaintenance || 0) > 0) {
    links.push({ id: "open-work-orders", label: "Open work orders", icon: Wrench, destination: "maintenance", viewFilter: "open" });
  }
  return links;
}

const ACTION_TONES = {
  sky: "border-sky-300 bg-sky-50 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:hover:bg-sky-950/70",
  amber: "border-amber-300 bg-amber-50 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:hover:bg-amber-950/70",
  red: "border-red-300 bg-red-50 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:hover:bg-red-950/70",
};
const ACTION_VALUE_TONES = {
  sky: "text-sky-900 dark:text-sky-200",
  amber: "text-amber-900 dark:text-amber-200",
  red: "text-red-900 dark:text-red-200",
};
const ACTION_ICON_TONES = {
  sky: "text-sky-700 dark:text-sky-400",
  amber: "text-amber-700 dark:text-amber-400",
  red: "text-red-700 dark:text-red-400",
};

function ExceptionBox({ alert, onNavigate }) {
  const Icon = alert.icon;
  if (!alert.hasAction) {
    // All clear: quiet, deliberately not a button or link -- there is no queue
    // behind a zero count, so nothing here may look clickable.
    return (
      <div
        data-exception-box={alert.id}
        data-exception-state="all-clear"
        className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/50"
      >
        <div className="flex items-center gap-2">
          <CheckCircle2 size={18} className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <p className="truncate text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{alert.label}</p>
        </div>
        <p className="mt-3 text-sm font-black text-emerald-700 dark:text-emerald-400">All clear</p>
        <p className="mt-1 text-sm font-semibold text-slate-500 dark:text-slate-400">{alert.clearDetail}</p>
      </div>
    );
  }
  return (
    <button
      type="button"
      data-exception-box={alert.id}
      data-exception-state="action-needed"
      onClick={() => onNavigate?.(alert.destination, null, alert.viewFilter)}
      className={`rounded-2xl border p-5 text-left shadow-sm transition hover:shadow-md motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${ACTION_TONES[alert.tone]}`}
    >
      <div className="flex items-center gap-2">
        <Icon size={18} className={`shrink-0 ${ACTION_ICON_TONES[alert.tone]}`} aria-hidden="true" />
        <p className={`truncate text-xs font-black uppercase tracking-wide ${ACTION_ICON_TONES[alert.tone]}`}>{alert.label}</p>
      </div>
      <p className={`mt-3 text-4xl font-black tabular-nums tracking-tight ${ACTION_VALUE_TONES[alert.tone]}`}>{alert.displayValue}</p>
      <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-400">{alert.actionDetail}</p>
      <p className={`mt-3 inline-flex items-center gap-1 text-sm font-black ${ACTION_ICON_TONES[alert.tone]}`}>
        Review queue <ArrowRight size={14} aria-hidden="true" />
      </p>
    </button>
  );
}

export function RentalExceptionAlerts({ summary, onNavigate }) {
  const alerts = buildExceptionAlerts(summary);
  return (
    <section aria-label="Exceptions needing attention" className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-white">Needs attention</h3>
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Boxes with a count open the filtered queue behind them.</p>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {alerts.map((alert) => <ExceptionBox key={alert.id} alert={alert} onNavigate={onNavigate} />)}
      </div>
    </section>
  );
}

export function RentalQuickAccess({ summary, onNavigate }) {
  const links = buildQuickAccessLinks(summary);
  if (links.length === 0) return null;
  return (
    <nav aria-label="Quick access" className="min-w-0">
      <h3 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Quick access</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <button
              key={link.id}
              type="button"
              data-quick-access={link.id}
              onClick={() => onNavigate?.(link.destination, null, link.viewFilter)}
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            >
              <Icon size={15} aria-hidden="true" className="text-slate-500 dark:text-slate-400" />
              {link.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
