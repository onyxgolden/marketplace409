export default function ForgeInsights({ insights = [], variant = "default" }) {
  const embedded = variant === "embedded";

  return (
    <section
      className={
        embedded ? "" : "rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6"
      }
    >
      <div className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Insights
      </div>

      <div className="mt-4 space-y-3">
        {insights.map((insight) => (
          <div
            key={insight.label}
            className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4"
          >
            <div className="text-sm font-bold text-slate-950 dark:text-white">
              {insight.label}
            </div>
            <div className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
              {insight.detail}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
