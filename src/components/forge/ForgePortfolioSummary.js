export default function ForgePortfolioSummary({ summaryItems = [] }) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
      <div className="text-sm uppercase tracking-wide text-slate-500">Portfolio Summary</div>
      <div className="mt-4 grid gap-3">
        {summaryItems.map((item) => (
          <div key={item.label} className="flex justify-between gap-4 rounded-2xl bg-slate-950 p-4">
            <div className="text-sm text-slate-400">{item.label}</div>
            <div className="font-black text-white">{item.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
