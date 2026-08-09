import RentalPropertyPerformanceCard from "./RentalPropertyPerformanceCard.jsx";
import { forgeTheme } from "@/components/forge/theme";

function PropertyList({
  properties,
}) {
  return (
    <div
      data-property-performance-list
      className="space-y-1"
    >
      <div className="hidden grid-cols-[minmax(12rem,1.5fr)_minmax(7rem,0.7fr)_minmax(8rem,0.8fr)_minmax(8rem,0.8fr)_auto] gap-2 px-4 py-1 text-[10px] font-black uppercase tracking-wide text-slate-500 sm:grid">
        <div>Property</div>
        <div>Activity</div>
        <div>NOI</div>
        <div>Cash flow</div>
        <div className="pr-7 text-right">
          Status
        </div>
      </div>

      {properties.map(
        (property) => (
          <RentalPropertyPerformanceCard
            key={property.propertyId}
            propertyName={
              property.propertyName
            }
            transactionCount={
              property.transactionCount
            }
            income={property.income}
            expenses={
              property.expenses
            }
            accruedOperatingExpenses={
              property
                .accruedOperatingExpenses
            }
            noi={property.noi}
            noiIsNegative={
              property.noiIsNegative
            }
            cashFlow={
              property.cashFlow
            }
            cashFlowIsNegative={
              property.cashFlowIsNegative
            }
          />
        ),
      )}
    </div>
  );
}

export default function RentalPortfolioPerformance({
  loadState,
  portfolio,
  periodOptions = [],
  selectedPeriodKey = "all",
  selectedPeriodLabel = "All time",
  onPeriodChange,
  properties = [],
  categories = [],
  recentTransactions = [],
}) {
  return (
    <section
      data-rental-portfolio-performance
      className={forgeTheme.card}
    >
      <div className={forgeTheme.labelSmall}>
        Repository-Backed Rental Activity
      </div>

      <div className="mt-2 flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <h2 className="text-2xl font-black text-slate-950">
            Rental Portfolio Summary
          </h2>

          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Actual imported cash activity plus verified taxes and insurance
            accrued into the selected reporting period. NOI uses accrued
            property costs while cash flow preserves actual payments.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-52">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-wide text-slate-500">
              Reporting period
            </span>

            <select
              data-financial-period-select
              value={
                selectedPeriodKey
              }
              onChange={(event) =>
                onPeriodChange?.(
                  event.target.value,
                )
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-800"
            >
              {periodOptions.map(
                (option) => (
                  <option
                    key={
                      option.key
                    }
                    value={
                      option.key
                    }
                  >
                    {option.label}
                  </option>
                ),
              )}
            </select>
          </label>

          <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-black uppercase tracking-wide text-emerald-800">
            Repository Backed
          </div>
        </div>
      </div>

      {loadState === "loading" && (
        <div className="mt-6 rounded-2xl bg-slate-100 p-6 text-sm font-bold text-slate-600">
          Loading rental portfolio activity...
        </div>
      )}

      {loadState === "ready" && !portfolio && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <div className="font-black text-slate-900">
            No rental portfolio data is available yet.
          </div>

          <div className="mt-2 text-sm text-slate-600">
            Import a Rentec financial file to populate this summary.
          </div>
        </div>
      )}

      {portfolio && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            {portfolio.metrics.map((metric) => (
              <div
                key={metric.label}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <div className={forgeTheme.labelSmall}>
                  {metric.label}
                </div>

                <div className="mt-2 text-2xl font-black text-slate-950">
                  {metric.value}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className={forgeTheme.labelSmall}>
                  Properties
                </div>

                <h3 className="mt-1 text-xl font-black text-slate-950">
                  Imported Property Performance
                </h3>

                <div className="mt-1 text-xs font-bold text-sky-700">
                  {selectedPeriodLabel}
                </div>
              </div>

              <div className="text-sm font-bold text-slate-500">
                {properties.length}{" "}
                {properties.length === 1
                  ? "property"
                  : "properties"}
              </div>
            </div>

            {properties.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                No property-linked financial events were found.
              </div>
            ) : (
              <div className="mt-4">
                <div className="mb-3 text-xs font-semibold text-slate-500">
                  Select a property to expand and compare imported cash activity with accrued operating costs.
                </div>

                <PropertyList
                  properties={properties}
                />
              </div>
            )}
          </div>

          <div className="mt-8 grid gap-6 xl:grid-cols-2">
            <div>
              <div className={forgeTheme.labelSmall}>
                Categories
              </div>

              <h3 className="mt-1 text-xl font-black text-slate-950">
                Income and Expense Breakdown
              </h3>

              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="p-3">Category</th>
                      <th className="p-3 text-right">Net</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-200">
                    {categories.length === 0 ? (
                      <tr>
                        <td
                          colSpan={2}
                          className="p-5 text-slate-500"
                        >
                          No categorized activity yet.
                        </td>
                      </tr>
                    ) : (
                      categories.map((category) => (
                        <tr key={category.category}>
                          <td className="p-3 font-bold text-slate-800">
                            {category.label}
                          </td>

                          <td
                            className={`p-3 text-right font-black ${
                              category.isNegative
                                ? "text-rose-700"
                                : "text-emerald-700"
                            }`}
                          >
                            {category.value}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className={forgeTheme.labelSmall}>
                Recent Imported Activity
              </div>

              <h3 className="mt-1 text-xl font-black text-slate-950">
                Latest Financial Events
              </h3>

              <div className="mt-4 space-y-3">
                {recentTransactions.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                    No imported financial activity yet.
                  </div>
                ) : (
                  recentTransactions.map((transaction) => (
                    <div
                      key={transaction.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="font-black text-slate-900">
                            {transaction.description}
                          </div>

                          <div className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                            {transaction.eventDate} ·{" "}
                            {transaction.propertyName}
                          </div>
                        </div>

                        <div
                          className={`font-black ${
                            transaction.isIncome
                              ? "text-emerald-700"
                              : "text-rose-700"
                          }`}
                        >
                          {transaction.isIncome ? "+" : "-"}
                          {transaction.amount}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                          {transaction.categoryLabel}
                        </span>

                        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                          {transaction.sourceSystem}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
