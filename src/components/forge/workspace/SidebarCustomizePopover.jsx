"use client";
import { RotateCcw, X } from "lucide-react";

// `sections` is an array of { sectionLabel, items } -- pass a null/omitted sectionLabel for a flat,
// ungrouped list (e.g. ApplicationShell's own flat `functions` prop, which has no sub-categories to
// label). Grouped callers (Rental Manager) pass a real sectionLabel per group/sub-category.
// `inline` renders the same controls as a plain full-width block instead of the absolutely
// positioned popover card -- used inside ApplicationShell's mobile "More" bottom sheet.
export default function SidebarCustomizePopover({ sections, sidebarPrefs, onClose, inline = false }) {
  const { hiddenItemIds, saving, error, toggleItem, showAll } = sidebarPrefs;
  return (
    <div
      role="dialog"
      aria-label="Customize sidebar"
      className={
        inline
          ? "w-full rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
          : "absolute left-0 top-full z-20 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      }
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400">Customize sidebar</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close customize sidebar"
          className="rounded p-0.5 text-slate-400 hover:text-slate-950 dark:hover:text-white"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <button
        type="button"
        onClick={showAll}
        disabled={saving || hiddenItemIds.size === 0}
        className="mb-2 flex items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-slate-600 hover:border-slate-300 hover:text-slate-950 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"
      >
        <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
        <span>Show all</span>
      </button>
      {error && <p role="alert" className="mb-2 text-xs font-bold text-red-600 dark:text-red-400">{error}</p>}
      <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
        {sections.map((section) => (
          <div key={section.sectionLabel || "__flat__"}>
            {section.sectionLabel && <p className="mb-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">{section.sectionLabel}</p>}
            {section.items.map((item) => (
              <label key={item.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                <input
                  type="checkbox"
                  checked={!hiddenItemIds.has(item.id)}
                  onChange={() => toggleItem(item.id)}
                  disabled={saving}
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:border-slate-600"
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
