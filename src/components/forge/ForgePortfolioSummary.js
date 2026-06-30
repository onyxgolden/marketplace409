export default function ForgePortfolioSummary({ summaryItems = [] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6">
      <div className="text-sm uppercase tracking-wide text-slate-500">Portfolio Summary</div>
      <div className="mt-4 grid gap-3">
        {summaryItems.map((item) => (
          <div key={item.label} className="flex justify-between gap-4 rounded-2xl bg-slate-100 p-4">
            <div className="text-sm text-slate-600">{item.label}</div>
            <div className="font-black text-slate-950">{item.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
