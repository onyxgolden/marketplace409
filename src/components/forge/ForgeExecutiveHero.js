export default function ForgeExecutiveHero({ riskSummary }) {
  return (
    <section className="mb-8 rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-900 to-slate-950 p-6 shadow-2xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.3em] text-amber-600">
            Executive Dashboard
          </p>
          <h1 className="mt-3 text-4xl font-black text-white lg:text-6xl">FORGE</h1>
          <p className="mt-3 max-w-2xl text-slate-300">
            Monitor money, audits, imports, and risk from one mobile-ready
            command center.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-300 bg-white p-4 dark:border-white/15 dark:bg-white/10">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-300">
            Overall Risk
          </div>
          <div className="mt-1 text-3xl font-black uppercase text-amber-600 dark:text-amber-400">
            {riskSummary.severity}
          </div>
          <div className="text-sm text-slate-600 dark:text-slate-300">
            Score {riskSummary.score} · {riskSummary.findingCount} findings
          </div>
        </div>
      </div>
    </section>
  );
}
