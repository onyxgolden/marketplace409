"use client";

// timeZone: "UTC" is required — the date below is constructed with Date.UTC, and formatting it in
// the server's local timezone (e.g. anything behind UTC, like US timezones) silently rolls the
// 1st of the month back to the last day of the previous month, mislabeling every bar.
const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return MONTH_LABEL.format(new Date(Date.UTC(year, month - 1, 1)));
}

// Compact real-data bar chart: no forecast, no comparison percentage, no fabricated trend line —
// just the caller's own recorded monthly totals. Every bar's dollar value is printed directly
// (not hidden behind hover/focus) so the chart is financially interpretable for every user,
// sighted or not, with or without a pointer. Reusable wherever a FORGE workspace has a real
// monthly cents series (Financial FORGE's cash position, for example).
export default function ForgeMonthlyTrendChart({ series = [], formatValue, title = "Collected per month", currentMonthLabel = "This month" }) {
  const format = formatValue || ((cents) => String(cents));
  const values = series.map((point) => Number(point.collectedCents || 0));
  const max = Math.max(1, ...values);
  const hasData = values.some((value) => value > 0);

  return (
    <div data-monthly-trend-chart>
      <h3 className="text-xs font-black uppercase tracking-wide text-slate-600 dark:text-slate-400">{title}</h3>
      {!hasData ? (
        <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">No recorded collections yet for this period.</p>
      ) : (
        <div className="mt-4 flex items-end gap-3" role="group" aria-label={title}>
          {series.map((point, index) => {
            const isCurrent = index === series.length - 1;
            const cents = Number(point.collectedCents || 0);
            const heightPercent = Math.max(4, Math.round((cents / max) * 100));
            const tone = isCurrent ? "text-amber-700 dark:text-amber-400" : "text-slate-500 dark:text-slate-400";
            return (
              <div key={point.month} data-trend-bar={point.month} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex h-24 w-full items-end">
                  <div
                    className={`w-full rounded-t-md transition-[height] motion-reduce:transition-none ${isCurrent ? "bg-amber-500" : "bg-sky-700/70 dark:bg-sky-500/60"}`}
                    style={{ height: `${heightPercent}%` }}
                  />
                </div>
                <span data-trend-bar-value className={`text-[10px] font-black tabular-nums ${isCurrent ? "text-amber-700 dark:text-amber-400" : "text-slate-700 dark:text-slate-300"}`}>
                  {format(cents)}
                </span>
                <span className={`text-[11px] font-bold ${tone}`}>{isCurrent ? currentMonthLabel : monthLabel(point.month)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
