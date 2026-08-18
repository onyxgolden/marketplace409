"use client";
import { HELP_SECTIONS, HELP_SHORTCUTS } from "./schedulingHelpContent";

export default function SchedulingHelpModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose} data-scheduling-help>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 text-slate-950 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-amber-700">Help</p>
            <h2 className="mt-1 text-xl font-black">Gantt Chart guide</h2>
            <p className="mt-1 text-sm text-slate-500">This grows as new features ship -- check back for updates.</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100">Close</button>
        </div>

        <div className="mt-5">
          <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">Keyboard shortcuts</h3>
          <dl className="mt-2 space-y-1.5">
            {HELP_SHORTCUTS.map((item) => (
              <div key={item.label} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                <dt className="shrink-0 rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-800 sm:w-52">{item.label}</dt>
                <dd className="text-sm text-slate-600">{item.description}</dd>
              </div>
            ))}
          </dl>
        </div>

        {HELP_SECTIONS.map((section) => (
          <div key={section.title} className="mt-5">
            <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">{section.title}</h3>
            <dl className="mt-2 space-y-1.5">
              {section.items.map((item) => (
                <div key={item.label} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                  <dt className="shrink-0 text-xs font-bold text-slate-800 sm:w-52">{item.label}</dt>
                  <dd className="text-sm text-slate-600">{item.description}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
