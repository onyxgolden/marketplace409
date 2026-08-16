export default function ForgePortfolioSummary({
  summaryItems = [],
  variant = "default",
}) {
  const embedded = variant === "embedded";

  return (
    <section
      className={
        embedded ? "" : "rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6"
      }
    >
      <div className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Portfolio Summary
      </div>

      <div className="mt-4 grid gap-3">
        {summaryItems.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4"
          >
            <div className="text-sm text-slate-600 dark:text-slate-400">{item.label}</div>
            <div className="font-black text-slate-950 dark:text-white">{item.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
