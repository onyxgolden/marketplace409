export default function ForgeInsights({ insights = [] }) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
      <div className="text-sm uppercase tracking-wide text-slate-500">Insights</div>
      <div className="mt-4 space-y-3">
        {insights.map((insight) => (
          <div key={insight.label} className="rounded-2xl bg-slate-950 p-4">
            <div className="text-sm font-bold text-slate-100">{insight.label}</div>
            <div className="mt-1 text-sm text-slate-400">{insight.detail}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
