"use client";
import { X } from "lucide-react";

// Shared "you arrived here through a filtered deep-link" banner. Every panel
// that supports an initialViewFilter renders this while the filter is active
// so the narrowed list never reads as the whole dataset -- one click clears it
// back to the full queue.
export default function RentalViewFilterBanner({ filterLabel, onClear }) {
  if (!filterLabel) return null;
  return (
    <div
      data-view-filter-banner
      role="status"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 dark:border-sky-800 dark:bg-sky-950/40"
    >
      <p className="text-sm font-bold text-sky-950 dark:text-sky-100">
        <span className="font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">Filtered view: </span>
        <span data-view-filter-label>{filterLabel}</span>
      </p>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center gap-1 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-sm font-black text-sky-800 transition hover:bg-sky-100 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:border-sky-700 dark:bg-slate-900 dark:text-sky-200 dark:hover:bg-slate-800"
      >
        <X size={14} aria-hidden="true" />
        Show all
      </button>
    </div>
  );
}
