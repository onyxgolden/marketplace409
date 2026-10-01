"use client";

// Owners section home (Rentec-parity R8). Rentec groups the shell under
// Properties / Tenants / Banking / Owners / Reports / Settings, and the owner
// accounting surface needs a home before R9 (owner statements + disbursement)
// builds on it. This panel is deliberately thin: no owner data plumbing is
// invented here -- [data-owner-statements-mount] below is the reserved mount
// point where R9 plugs the statement/disbursement screens in.
export default function RentalOwnersHomePanel({ onNavigate }) {
  return (
    <section data-rental-owners-home className="space-y-6">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900 lg:p-8">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Owner accounting</p>
        <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Owners</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
          The owner side of the books: running balances due to each owner through the month,
          disbursements, and owner contributions. Property-level financial treatment lives
          under Properties; everything owed to or from an owner lives here.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => onNavigate?.("financial-setup")}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Property financial setup
          </button>
          <button
            type="button"
            onClick={() => onNavigate?.("reports")}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Reports
          </button>
        </div>
      </div>

      {/* R9 mount point: owner statements, disbursement workflow, and owner
          contributions render here. Nothing is fabricated ahead of that slice. */}
      <div
        data-owner-statements-mount
        className="rounded-3xl border border-dashed border-slate-300 bg-white/60 p-8 text-center dark:border-slate-700 dark:bg-slate-900/60"
      >
        <h3 className="text-lg font-black text-slate-950 dark:text-white">Owner statements</h3>
        <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600 dark:text-slate-400">
          Monthly owner statements, the disbursement workflow, and owner contributions
          land here next. Until then, owner money is tracked through the bank ledger
          and property reports.
        </p>
      </div>
    </section>
  );
}
