"use client";

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
// Every date derivation here is UTC-in/UTC-out — no local Date object round-trips — the exact
// class of bug that previously mislabeled ForgeMonthlyTrendChart's bars on servers west of UTC.
function pointLabel(key) {
  if (key.length === 4) return key;
  const [year, month] = key.split("-").map(Number);
  return MONTH_LABEL.format(new Date(Date.UTC(year, month - 1, 1)));
}

// Two-series grouped bar comparison (e.g. collected vs. expenses) with a net figure per period.
// Every value is printed directly — never hidden behind hover-only tooltips — so the chart is
// financially interpretable and keyboard/screen-reader accessible with no interaction required.
// Domain-agnostic: reusable anywhere a FORGE workspace needs to compare two real cents series
// over the same periods (Financial FORGE's own income/expense view, for example).
export default function ForgeComparisonBarChart({
  title = "Comparison", series = [], primaryLabel = "Primary", secondaryLabel = "Secondary", netLabel = "Net",
  primaryColorClass = "bg-emerald-600 dark:bg-emerald-500", secondaryColorClass = "bg-amber-500 dark:bg-amber-400",
  formatValue, currentKey = null,
}) {
  const format = formatValue || ((cents) => String(cents));
  const max = Math.max(1, ...series.flatMap((point) => [point.primaryCents, point.secondaryCents].map((v) => Math.abs(Number(v || 0)))));
  const hasData = series.some((point) => point.primaryCents !== 0 || point.secondaryCents !== 0);

  return (
    <div data-comparison-chart>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-black uppercase tracking-wide text-slate-600 dark:text-slate-400">{title}</h3>
        <ul className="flex items-center gap-4" aria-label="Legend">
          <li className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-400">
            <span className={`h-2.5 w-2.5 rounded-sm ${primaryColorClass}`} aria-hidden="true" />{primaryLabel}
          </li>
          <li className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-400">
            <span className={`h-2.5 w-2.5 rounded-sm ${secondaryColorClass}`} aria-hidden="true" />{secondaryLabel}
          </li>
        </ul>
      </div>
      {!hasData ? (
        <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">No recorded activity yet for this period.</p>
      ) : (
        <div className="mt-4 flex items-end gap-4 overflow-x-auto pb-1" role="group" aria-label={title}>
          {series.map((point) => {
            const isCurrent = currentKey != null && point.key === currentKey;
            const primaryHeight = Math.max(3, Math.round((Math.abs(point.primaryCents) / max) * 100));
            const secondaryHeight = Math.max(3, Math.round((Math.abs(point.secondaryCents) / max) * 100));
            const net = point.primaryCents - point.secondaryCents;
            return (
              <div key={point.key} data-comparison-point={point.key} className="flex min-w-[64px] flex-1 flex-col items-center gap-1.5">
                <div className="flex h-24 w-full items-end justify-center gap-1">
                  <div className="flex h-full w-full flex-col items-center justify-end">
                    <span data-comparison-value="primary" className="text-[10px] font-black tabular-nums text-emerald-700 dark:text-emerald-400">{format(point.primaryCents)}</span>
                    <div title={`${primaryLabel}: ${format(point.primaryCents)}`} className={`mt-1 w-full max-w-[18px] rounded-t-sm transition-[height] motion-reduce:transition-none ${primaryColorClass}`} style={{ height: `${primaryHeight}%` }} />
                  </div>
                  <div className="flex h-full w-full flex-col items-center justify-end">
                    <span data-comparison-value="secondary" className="text-[10px] font-black tabular-nums text-amber-700 dark:text-amber-400">{format(point.secondaryCents)}</span>
                    <div title={`${secondaryLabel}: ${format(point.secondaryCents)}`} className={`mt-1 w-full max-w-[18px] rounded-t-sm transition-[height] motion-reduce:transition-none ${secondaryColorClass}`} style={{ height: `${secondaryHeight}%` }} />
                  </div>
                </div>
                <span className={`text-[11px] font-bold ${isCurrent ? "text-sky-700 dark:text-sky-400" : "text-slate-500 dark:text-slate-400"}`}>{pointLabel(point.key)}</span>
                <span
                  data-comparison-net
                  className={`rounded-full px-2 py-0.5 text-[10px] font-black tabular-nums ${net >= 0 ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"}`}
                  title={`${netLabel}: ${format(net)}`}
                >
                  {net < 0 ? `-${format(Math.abs(net))}` : format(net)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
