"use client";
import { buildPieSlices, sliceToPath } from "@/domains/budgeting/pieChartGeometry";

// Fixed, saturated palette -- reads clearly on both the light and dark surfaces this panel already
// supports, so slice fills don't need to be theme-token-driven the way surface/text colors are.
const SLICE_COLORS = ["#0ea5e9", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });

export default function BudgetPieChart({ title, entries, emptyHint }) {
  const data = entries.filter((entry) => entry.valueCents > 0).slice(0, SLICE_COLORS.length);
  const slices = buildPieSlices(data).map((slice, index) => ({ ...slice, color: SLICE_COLORS[index % SLICE_COLORS.length] }));
  const cx = 60;
  const cy = 60;
  const r = 56;

  return (
    <div className="rounded-2xl border border-slate-200 p-5 dark:border-slate-700">
      <h3 className="text-sm font-black uppercase tracking-wide text-slate-700 dark:text-slate-300">{title}</h3>
      {slices.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{emptyHint}</p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-5">
          <svg viewBox="0 0 120 120" width="140" height="140" role="img" aria-label={title}>
            {slices.map((slice) => (
              <path key={slice.label} d={sliceToPath(slice, cx, cy, r)} fill={slice.color} stroke="currentColor" strokeWidth="1" className="text-white dark:text-slate-900" />
            ))}
          </svg>
          <ul className="min-w-0 flex-1 space-y-1.5">
            {slices.map((slice) => (
              <li key={slice.label} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-200">{slice.label}</span>
                <span className="shrink-0 font-bold text-slate-950 dark:text-white">{money.format(slice.valueCents / 100)}</span>
                <span className="w-10 shrink-0 text-right text-xs text-slate-500 dark:text-slate-400">{percent.format(slice.fraction)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
