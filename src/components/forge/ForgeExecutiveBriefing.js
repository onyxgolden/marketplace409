export default function ForgeExecutiveBriefing({
  executiveBriefing,
  riskAssessment,
  variant = "default",
  showOverview = true,
  showOutlook = true,
  showRecommendations = true,
}) {
  const embedded = variant === "embedded";
  const panelClass = embedded
    ? "rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-5"
    : "rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6";
  const briefingSpanClass = showRecommendations
    ? "xl:col-span-2"
    : "xl:col-span-3";

  return (
    <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className={`${panelClass} ${briefingSpanClass}`}>
        <div className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Executive Briefing
        </div>
        <h2 className="mt-2 text-xl font-black text-slate-950 dark:text-white">
          {executiveBriefing.headline}
        </h2>
        {showOverview && (
          <p className="mt-3 text-sm leading-6 text-slate-700 dark:text-slate-300">
            {executiveBriefing.overview}
          </p>
        )}
        {showOutlook && (
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
            {executiveBriefing.outlook}
          </p>
        )}
      </div>

      {showRecommendations && (
        <div className={panelClass}>
          <div className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Recommended Actions
          </div>
          <ul className="mt-3 space-y-3 text-sm text-slate-700 dark:text-slate-300">
            {(riskAssessment.recommendations.length
              ? riskAssessment.recommendations
              : ["Continue routine monitoring."]
            ).map((item) => (
              <li key={item} className="rounded-xl bg-white dark:bg-slate-900 p-3">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
