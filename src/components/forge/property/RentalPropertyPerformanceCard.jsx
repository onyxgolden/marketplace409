const performanceMetrics = Object.freeze([
  {
    identity: "income",
    label: "Income",
    backgroundClassName: "bg-emerald-50",
    labelClassName: "text-emerald-700",
    valueClassName: "text-emerald-950",
  },
  {
    identity: "expenses",
    label: "Expenses",
    backgroundClassName: "bg-rose-50",
    labelClassName: "text-rose-700",
    valueClassName: "text-rose-950",
  },
  {
    identity: "noi",
    label: "NOI",
    backgroundClassName: "bg-amber-50",
    labelClassName: "text-amber-700",
    valueClassName: "text-amber-950",
  },
  {
    identity: "cashFlow",
    label: "Cash Flow",
    backgroundClassName: "bg-sky-50",
    labelClassName: "text-sky-700",
    valueClassName: "text-sky-950",
  },
]);

export default function RentalPropertyPerformanceCard({
  propertyName,
  transactionCount,
  income,
  expenses,
  noi,
  cashFlow,
}) {
  const values = {
    income,
    expenses,
    noi,
    cashFlow,
  };

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-slate-500">
            Rental Property
          </div>

          <h4 className="mt-1 text-xl font-black text-slate-950">
            {propertyName}
          </h4>
        </div>

        <div className="rounded-full bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">
          {transactionCount} transactions
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {performanceMetrics.map((metric) => (
          <div
            key={metric.identity}
            className={`rounded-2xl p-4 ${metric.backgroundClassName}`}
          >
            <div
              className={`text-xs font-black uppercase tracking-wide ${metric.labelClassName}`}
            >
              {metric.label}
            </div>

            <div
              className={`mt-1 text-lg font-black ${metric.valueClassName}`}
            >
              {values[metric.identity]}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
