export default function ForgeInsights({ insights = [], variant = "default" }) {
  const embedded = variant === "embedded";

  return (
    <section
      className={
        embedded ? "" : "rounded-3xl border border-slate-200 bg-white p-6"
      }
    >
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">
        Insights
      </div>

      <div className="mt-4 space-y-3">
        {insights.map((insight) => (
          <div
            key={insight.label}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="text-sm font-bold text-slate-950">
              {insight.label}
            </div>
            <div className="mt-1 text-sm leading-6 text-slate-600">
              {insight.detail}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
