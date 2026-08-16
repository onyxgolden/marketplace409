export default function ForgeTrendChart({ riskSummary, riskAssessment }) {
  const indicators = riskAssessment?.trendIndicators ?? [];

  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
      <div className="text-sm uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Trend Chart
      </div>

      <div className="mt-4 rounded-2xl bg-slate-100 dark:bg-slate-800 p-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-sm text-slate-600 dark:text-slate-400">Current Risk Score</div>
            <div className="mt-1 text-3xl font-black text-slate-950 dark:text-white">
              {riskSummary?.score ?? 0}
            </div>
          </div>
          <div className="text-right text-sm font-bold text-slate-700 dark:text-slate-300">
            {riskSummary?.status ?? "Unknown"}
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {(indicators.length ? indicators : ["No adverse trend indicators detected."]).map(
            (indicator, index) => (
              <div key={indicator}>
                <div className="mb-2 flex justify-between gap-4 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <span>{indicator}</span>
                  <span>{index + 1}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-800">
                  <div
                    className="h-2 rounded-full bg-slate-500"
                    style={{ width: `${Math.max(25, 80 - index * 15)}%` }}
                  />
                </div>
              </div>
            ),
          )}
        </div>
      </div>
    </section>
  );
}
