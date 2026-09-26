"use client";
import { useRef } from "react";

export function labelRentalRecordContext(context, records, labelKey) {
  const record = (records || []).find((item) => item.id === context?.recordId);
  return { ...context, recordLabel: record?.[labelKey] || context?.recordLabel || "selected record" };
}

export default function RentalRecordActions({ label, actions = [], summaryClassName }) {
  const detailsRef = useRef(null);
  const select = (action) => {
    if (detailsRef.current) detailsRef.current.open = false;
    action.onSelect?.();
  };
  return <details ref={detailsRef} className="relative" data-rental-record-actions>
    <summary className={summaryClassName || "cursor-pointer list-none rounded-xl border border-slate-300 px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"}>{label}</summary>
    <div className="absolute right-0 z-10 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      {actions.map((action) => <button key={action.label} type="button" onClick={() => select(action)} className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-bold transition ${
        action.destructive
          ? "text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
      }`}>{action.label}</button>)}
    </div>
  </details>;
}
