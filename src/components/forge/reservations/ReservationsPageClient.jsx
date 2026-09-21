"use client";
import { useState } from "react";
import { RV_RESERVATIONS_NAV_GROUP, buildRvReservationsSurface } from "@/components/forge/rental/rvReservationsNavigation";

const SURFACE_IDS = RV_RESERVATIONS_NAV_GROUP.items.map((item) => item.id);

// Standalone Reservations workspace: the RV & cabin reservation surfaces lifted out of
// Rental Manager's shell (owner-approved 2026-09-21). The nav group and surface mapping stay
// owned by rvReservationsNavigation.jsx -- this component is only the workspace chrome.
export default function ReservationsPageClient({ initialSurfaceId = null }) {
  const [activeId, setActiveId] = useState(() => (SURFACE_IDS.includes(initialSurfaceId) ? initialSurfaceId : SURFACE_IDS[0]));
  return (
    <section data-reservations-application-shell data-active-surface={activeId} className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-950">
      <header className="border-b border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-4 text-slate-950 dark:text-slate-100 lg:px-8">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">FORGE Application</p>
            <h1 className="text-2xl font-black tracking-tight">Reservations</h1>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1800px] grid-cols-1 gap-5 p-4 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-6 lg:p-8">
        <label className="lg:hidden">
          <span className="sr-only">Reservation function</span>
          <select value={activeId} onChange={(event) => setActiveId(event.target.value)} className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-3 font-bold text-slate-950 dark:text-slate-100">
            {RV_RESERVATIONS_NAV_GROUP.items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <aside className="hidden self-start lg:block">
          <nav aria-label="Reservation functions" className="space-y-0.5">
            {RV_RESERVATIONS_NAV_GROUP.items.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={activeId === item.id ? "page" : undefined}
                onClick={() => setActiveId(item.id)}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm font-bold transition motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                  activeId === item.id
                    ? "bg-slate-950 text-white dark:bg-amber-400 dark:text-slate-950"
                    : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>
        <main data-active-surface-panel={activeId} className="min-w-0">
          {buildRvReservationsSurface(activeId)}
        </main>
      </div>
    </section>
  );
}
