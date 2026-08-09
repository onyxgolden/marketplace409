function transactionLabel(
  transactionCount,
) {
  const count =
    Number(
      transactionCount || 0,
    );

  return `${count.toLocaleString()} ${
    count === 1
      ? "transaction"
      : "transactions"
  }`;
}

function Metric({
  label,
  value,
  negative = false,
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">
        {label}
      </div>

      <div
        className={`mt-1 text-base font-black ${
          negative
            ? "text-rose-700"
            : "text-slate-950"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

export default function RentalPropertyPerformanceCard({
  propertyName,
  transactionCount,
  income,
  expenses,
  accruedOperatingExpenses =
    "$0.00",
  noi,
  cashFlow,
  noiIsNegative = false,
  cashFlowIsNegative = false,
}) {
  const requiresAttention =
    noiIsNegative ||
    cashFlowIsNegative;

  return (
    <details
      data-property-performance-card
      data-property-performance-item
      data-performance-status={
        requiresAttention
          ? "negative"
          : "positive"
      }
      className={`group overflow-hidden rounded-2xl border bg-white ${
        requiresAttention
          ? "border-rose-300"
          : "border-slate-200"
      }`}
    >
      <summary className="grid cursor-pointer list-none items-center gap-2 px-4 py-2.5 transition hover:bg-slate-50 sm:grid-cols-[minmax(12rem,1.5fr)_minmax(7rem,0.7fr)_minmax(8rem,0.8fr)_minmax(8rem,0.8fr)_auto]">
        <div className="min-w-0 truncate font-black text-slate-950">
          {propertyName}
        </div>

        <div className="text-sm font-bold text-slate-600">
          <span className="mr-2 text-[10px] font-black uppercase tracking-wide text-slate-500 sm:hidden">
            Activity
          </span>

          {transactionLabel(
            transactionCount,
          )}
        </div>

        <div>
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-500 sm:hidden">
            NOI
          </div>

          <div
            className={`font-black ${
              noiIsNegative
                ? "text-rose-700"
                : "text-slate-950"
            }`}
          >
            {noi}
          </div>
        </div>

        <div>
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-500 sm:hidden">
            Cash flow
          </div>

          <div
            className={`font-black ${
              cashFlowIsNegative
                ? "text-rose-700"
                : "text-slate-950"
            }`}
          >
            {cashFlow}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${
              requiresAttention
                ? "bg-rose-100 text-rose-800"
                : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {requiresAttention
              ? "Review"
              : "Current"}
          </span>

          <span
            aria-hidden="true"
            className="text-base font-black text-slate-400 transition group-open:rotate-180"
          >
            ⌄
          </span>
        </div>
      </summary>

      <div
        data-property-performance-details
        className="border-t border-slate-200 bg-slate-50/60 p-3"
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Income"
            value={income}
          />

          <Metric
            label="Expenses"
            value={expenses}
          />

          <Metric
            label="Accrued property costs"
            value={
              accruedOperatingExpenses
            }
          />

          <Metric
            label="Imported activity"
            value={transactionLabel(
              transactionCount,
            )}
          />
        </div>

        <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">
          Imported expenses represent actual cash payments.
          Accrued property costs recognize verified taxes and
          insurance in NOI for the selected reporting period.
        </p>
      </div>
    </details>
  );
}
