export default function ForgeExecutiveCopilot({
  executiveBriefing,
  riskAssessment,
  showOutlook = true,
}) {
  const recommendations = riskAssessment?.recommendations ?? [];

  return (
    <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
      <div className="text-sm uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Executive Copilot
      </div>

      {showOutlook && (
        <div className="mt-4 rounded-2xl bg-slate-100 dark:bg-slate-800 p-4">
          <div className="text-sm font-bold text-slate-950 dark:text-white">Outlook</div>
          <div className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {executiveBriefing?.outlook ?? "No executive outlook available."}
          </div>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {(recommendations.length ? recommendations : ["Continue routine monitoring."]).map(
          (recommendation) => (
            <div
              key={recommendation}
              className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-4 text-sm text-slate-700 dark:text-slate-300"
            >
              {recommendation}
            </div>
          ),
        )}
      </div>
    </section>
  );
}
