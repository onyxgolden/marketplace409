export default function ForgeExecutiveHero({ riskSummary }) {
  return (
    <section className="mb-8 rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-6 shadow-2xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.3em] text-red-400">
            Executive Dashboard
          </p>
          <h1 className="mt-3 text-4xl font-black lg:text-6xl">FORGE</h1>
          <p className="mt-3 max-w-2xl text-slate-400">
            Monitor money, audits, imports, and risk from one mobile-ready
            command center.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Overall Risk
          </div>
          <div className="mt-1 text-3xl font-black uppercase text-red-400">
            {riskSummary.severity}
          </div>
          <div className="text-sm text-slate-400">
            Score {riskSummary.score} · {riskSummary.findingCount} findings
          </div>
        </div>
      </div>
    </section>
  );
}
