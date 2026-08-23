"use client";

// A larger, icon-led KPI tile for FORGE workspace summaries — a richer sibling to
// ForgeDashboardCard for surfaces that need tone (attention/success/paused), an icon, and a
// clear click-through destination or an explicit "informational" label. Built for the Rental
// Manager Summary redesign; safe to reuse from Financial FORGE or other workspace summaries.
const TONE_STYLES = {
  neutral: {
    tile: "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900",
    icon: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    value: "text-slate-950 dark:text-white",
  },
  attention: {
    tile: "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30",
    icon: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300",
    value: "text-amber-900 dark:text-amber-200",
  },
  success: {
    tile: "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30",
    icon: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300",
    value: "text-emerald-900 dark:text-emerald-200",
  },
};

export default function ForgeMetricTile({
  icon: Icon, label, value, detail, tone = "neutral", onNavigate, destination, informational = false, metricKey,
}) {
  const styles = TONE_STYLES[tone] || TONE_STYLES.neutral;
  const interactive = Boolean(onNavigate && destination) && !informational;
  const Wrapper = interactive ? "button" : "div";

  return (
    <Wrapper
      type={interactive ? "button" : undefined}
      onClick={interactive ? () => onNavigate(destination) : undefined}
      data-metric-tile={metricKey || destination || label}
      data-metric-tone={tone}
      className={`group flex w-full flex-col rounded-2xl border p-5 text-left shadow-sm transition motion-reduce:transition-none ${styles.tile} ${
        interactive ? "hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0 focus-visible:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        {Icon ? (
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${styles.icon}`} aria-hidden="true">
            <Icon size={18} strokeWidth={2.25} />
          </span>
        ) : null}
        {informational ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            Informational
          </span>
        ) : null}
      </div>
      <span className="mt-3 text-xs font-black uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</span>
      <strong className={`mt-1 text-3xl font-black tracking-tight ${styles.value}`}>{value}</strong>
      {detail ? <span className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">{detail}</span> : null}
      {interactive ? (
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-black text-sky-700 dark:text-sky-400">
          View details
          <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none">→</span>
        </span>
      ) : null}
    </Wrapper>
  );
}
