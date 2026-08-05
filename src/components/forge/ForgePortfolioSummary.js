export default function ForgePortfolioSummary({
  summaryItems = [],
  variant = "default",
}) {
  const embedded = variant === "embedded";

  return (
    <section
      className={
        embedded ? "" : "rounded-3xl border border-slate-200 bg-white p-6"
      }
    >
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">
        Portfolio Summary
      </div>

      <div className="mt-4 grid gap-3">
        {summaryItems.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="text-sm text-slate-600">{item.label}</div>
            <div className="font-black text-slate-950">{item.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
