const primaryMetrics = Object.freeze([
  {
    identity: "noi",
    label: "Net Operating Income",
    shortLabel: "NOI",
    treatment:
      "border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50",
    labelClassName: "text-amber-700",
    valueClassName: "text-amber-950",
  },
  {
    identity: "cashFlow",
    label: "Cash Flow",
    shortLabel: "Cash Flow",
    treatment:
      "border-sky-200 bg-gradient-to-br from-sky-50 to-cyan-50",
    labelClassName: "text-sky-700",
    valueClassName: "text-sky-950",
  },
]);

const activityMetrics = Object.freeze([
  {
    identity: "income",
    label: "Income",
    indicatorClassName: "bg-emerald-500",
    valueClassName: "text-emerald-800",
  },
  {
    identity: "expenses",
    label: "Expenses",
    indicatorClassName: "bg-rose-500",
    valueClassName: "text-rose-800",
  },
]);

function transactionLabel(transactionCount) {
  const count = Number(transactionCount || 0);

  return `${count.toLocaleString()} ${
    count === 1 ? "transaction" : "transactions"
  }`;
}

export default function RentalPropertyPerformanceCard({
  propertyName,
  transactionCount,
  income,
  expenses,
  noi,
  cashFlow,
  noiIsNegative = false,
  cashFlowIsNegative = false,
}) {
  const values = {
    income,
    expenses,
    noi,
    cashFlow,
  };

  const negativeMetrics = {
    noi: noiIsNegative,
    cashFlow: cashFlowIsNegative,
  };

  return (
    <article
      data-property-performance-card
      className="group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_50px_-32px_rgba(15,23,42,0.65)] transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_24px_60px_-30px_rgba(15,23,42,0.72)]"
    >
      <header className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-5 text-white">
        <div
          aria-hidden="true"
          className="absolute -right-10 -top-14 h-36 w-36 rounded-full border border-white/10 bg-white/5"
        />

        <div
          aria-hidden="true"
          className="absolute -bottom-20 right-14 h-32 w-32 rounded-full border border-emerald-300/10"
        />

        <div className="relative flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
              Rental Property
            </div>

            <h4 className="mt-3 truncate text-xl font-black tracking-tight text-white">
              {propertyName}
            </h4>
          </div>

          <div className="shrink-0 rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-right backdrop-blur">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-300">
              Activity
            </div>

            <div className="mt-0.5 text-xs font-black text-white">
              {transactionLabel(transactionCount)}
            </div>
          </div>
        </div>
      </header>

      <div className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
              Operating Performance
            </div>

            <div className="mt-1 text-sm font-semibold text-slate-600">
              Repository-backed imported activity
            </div>
          </div>

          <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-700">
            Imported
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {primaryMetrics.map((metric) => {
            const isNegative =
              negativeMetrics[metric.identity];

            return (
              <section
                key={metric.identity}
                data-performance-status={
                  isNegative ? "negative" : "positive"
                }
                className={`rounded-2xl border p-4 ${
                  isNegative
                    ? "border-rose-200 bg-gradient-to-br from-rose-50 to-red-50"
                    : metric.treatment
                }`}
              >
                <div
                  className={`text-[11px] font-black uppercase tracking-wider ${
                    isNegative
                      ? "text-rose-700"
                      : metric.labelClassName
                  }`}
                >
                  <span className="sm:hidden">
                    {metric.shortLabel}
                  </span>

                  <span className="hidden sm:inline">
                    {metric.label}
                  </span>
                </div>

                <div
                  className={`mt-2 text-2xl font-black tracking-tight ${
                    isNegative
                      ? "text-rose-950"
                      : metric.valueClassName
                  }`}
                >
                  {values[metric.identity]}
                </div>
              </section>
            );
          })}
        </div>

        <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          {activityMetrics.map((metric, index) => (
            <div
              key={metric.identity}
              className={`p-4 ${
                index > 0 ? "border-l border-slate-200" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${metric.indicatorClassName}`}
                />

                <div className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                  {metric.label}
                </div>
              </div>

              <div
                className={`mt-2 text-lg font-black ${metric.valueClassName}`}
              >
                {values[metric.identity]}
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
