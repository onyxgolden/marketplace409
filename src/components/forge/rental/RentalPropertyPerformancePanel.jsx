"use client";
import { Fragment, useState } from "react";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function moneyValue(cents) {
  return money.format(Number(cents || 0) / 100);
}

const EXPENSE_PERIODS = Object.freeze([
  { id: "monthToDate", label: "Month to date" },
  { id: "yearToDate", label: "Year to date" },
  { id: "allTime", label: "All time" },
]);

const PERIOD_LABELS = Object.freeze({
  monthToDate: "Month to date",
  yearToDate: "Year to date",
  allTime: "All time (since 2014)",
});

// Operating profit is income minus operating expenses; property tax is already
// inside operating expenses, never an additional expense. Capital improvements
// are investment, not operating expenses.
function ExpenseDetail({ property, periodId }) {
  const period = property[periodId];
  const categories = property.expenseCategories[periodId];
  const capitalCategories = property.capitalCategories[periodId];
  return (
    <div className="space-y-3">
      <p className="text-sm font-bold text-slate-950 dark:text-white">
        Expenses by category — {PERIOD_LABELS[periodId]} · total {moneyValue(period.operatingExpensesCents)}
      </p>
      {categories.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">No operating expenses in this period.</p>
      ) : (
        <dl className="space-y-1">
          {categories.map((entry) => (
            <div key={entry.category} className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
              <dt className="min-w-0 break-words font-semibold text-slate-700 dark:text-slate-300">{entry.label}</dt>
              <dd className="shrink-0 font-bold tabular-nums text-slate-950 dark:text-white">{moneyValue(entry.cents)}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
        <p className="text-sm font-bold text-slate-950 dark:text-white">
          Capital improvements (not included in operating profit) · {moneyValue(period.capitalImprovementsCents)}
        </p>
        {capitalCategories.length > 0 && (
          <dl className="mt-2 space-y-1">
            {capitalCategories.map((entry) => (
              <div key={entry.category} className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
                <dt className="min-w-0 break-words font-semibold text-slate-700 dark:text-slate-300">{entry.label}</dt>
                <dd className="shrink-0 font-bold tabular-nums text-slate-950 dark:text-white">{moneyValue(entry.cents)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Property tax paid ({moneyValue(period.propertyTaxCents)}) is included in the operating-expense total above, not added to it.
      </p>
    </div>
  );
}

function PropertySetupLink({ property, onNavigate, children }) {
  return (
    <button
      type="button"
      onClick={() => onNavigate?.("financial-setup", { recordType: "unit", recordId: property.unitId, propertyId: property.propertyId })}
      className="text-sm font-black text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-800 dark:text-sky-400 dark:decoration-sky-800 dark:hover:text-sky-300"
    >
      {children}
    </button>
  );
}

function MetricPair({ label, value }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="min-w-0 text-sm font-semibold text-slate-600 dark:text-slate-400">{label}</dt>
      <dd className="shrink-0 text-sm font-black tabular-nums text-slate-950 dark:text-white">{value}</dd>
    </div>
  );
}

function PropertyCard({ property, expensePeriod, expanded, onToggleDetails, onNavigate }) {
  return (
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-property-performance-row={property.propertyId}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <h3 className="min-w-0 break-words text-base font-black text-slate-950 dark:text-white">{property.label}</h3>
        <PropertySetupLink property={property} onNavigate={onNavigate}>Property setup</PropertySetupLink>
      </div>
      <dl className="mt-4 space-y-2">
        <MetricPair label="Month to date profit" value={moneyValue(property.monthToDate.profitCents)} />
        <MetricPair label="Year to date profit" value={moneyValue(property.yearToDate.profitCents)} />
        <MetricPair label="All time profit (since 2014)" value={moneyValue(property.allTime.profitCents)} />
        <MetricPair label="Expenses (all time)" value={moneyValue(property.allTime.operatingExpensesCents)} />
        {/* A house with no setup row has only known capital improvements —
            never present that partial figure as a complete recorded-cash-
            invested total. The label itself says which one it is. */}
        <MetricPair label={property.hasSetup ? "Recorded cash invested" : "Known capital improvements"} value={moneyValue(property.investmentCents)} />
        <MetricPair label="Property tax paid (all time)" value={moneyValue(property.allTime.propertyTaxCents)} />
      </dl>
      {property.setupIncomplete && (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
          Setup incomplete — down payment and closing costs are not on file for this house, so the invested figure
          is capital improvements only.{" "}
          <PropertySetupLink property={property} onNavigate={onNavigate}>Add the financial setup</PropertySetupLink>
        </p>
      )}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggleDetails}
        className="mt-4 rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        {expanded ? "Hide expenses by category" : "Expenses by category"}
      </button>
      {expanded && (
        <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
          <ExpenseDetail property={property} periodId={expensePeriod} />
        </div>
      )}
    </article>
  );
}

export default function RentalPropertyPerformancePanel({ performance, onNavigate }) {
  const [expensePeriod, setExpensePeriod] = useState("allTime");
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  function toggleDetails(propertyId) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(propertyId)) next.delete(propertyId);
      else next.add(propertyId);
      return next;
    });
  }

  if (!performance) {
    return (
      <section aria-label="Property performance" data-rental-property-performance="unavailable" className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-xl font-black tracking-tight text-slate-950 dark:text-white">Property performance</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Per-property profit is unavailable right now — the summary data has not finished loading the property
          breakdown. It will appear after the next refresh; no figures are shown rather than showing incomplete ones.
        </p>
      </section>
    );
  }

  const { properties, portfolioTotals, unassigned, pre2014, diagnostics } = performance;
  if (properties.length === 0 && unassigned.eventCount === 0) {
    return (
      <section aria-label="Property performance" data-rental-property-performance="empty" className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-xl font-black tracking-tight text-slate-950 dark:text-white">Property performance</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          No properties and no rental activity yet. Once a property is on file, this section shows each house&apos;s
          profit by month, year, and all time, plus expenses, invested cash, and property tax paid.
        </p>
      </section>
    );
  }

  const reconciliation = {
    monthToDate: {
      incomeCents: portfolioTotals.monthToDate.incomeCents + unassigned.monthToDate.incomeCents,
      operatingExpensesCents: portfolioTotals.monthToDate.operatingExpensesCents + unassigned.monthToDate.operatingExpensesCents,
      profitCents: portfolioTotals.monthToDate.profitCents + unassigned.monthToDate.profitCents,
    },
    yearToDate: {
      incomeCents: portfolioTotals.yearToDate.incomeCents + unassigned.yearToDate.incomeCents,
      operatingExpensesCents: portfolioTotals.yearToDate.operatingExpensesCents + unassigned.yearToDate.operatingExpensesCents,
      profitCents: portfolioTotals.yearToDate.profitCents + unassigned.yearToDate.profitCents,
    },
    allTime: {
      incomeCents: portfolioTotals.allTime.incomeCents + unassigned.allTime.incomeCents,
      operatingExpensesCents: portfolioTotals.allTime.operatingExpensesCents + unassigned.allTime.operatingExpensesCents,
      profitCents: portfolioTotals.allTime.profitCents + unassigned.allTime.profitCents,
    },
    investmentCents: portfolioTotals.investmentCents + unassigned.investmentCents,
  };

  return (
    <section aria-label="Property performance" data-rental-property-performance className="min-w-0 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-black tracking-tight text-slate-950 dark:text-white">Property performance</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            Operating profit per house — rent collected minus operating expenses. Capital improvements count as
            invested cash, not as an expense, so they never reduce a house&apos;s profit. All time starts
            in 2014. Property tax paid is included in expenses, not added on top.
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Expenses period">
          <span className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Expenses:</span>
          {EXPENSE_PERIODS.map((period) => (
            <button
              key={period.id}
              type="button"
              aria-pressed={expensePeriod === period.id}
              onClick={() => setExpensePeriod(period.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-black ${expensePeriod === period.id ? "border-sky-700 bg-sky-700 text-white dark:border-sky-500 dark:bg-sky-600" : "border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"}`}
            >
              {period.label}
            </button>
          ))}
        </div>
      </div>

      {/* Desktop and tablet: one row per house. */}
      <div className="mt-6 hidden overflow-x-auto sm:block">
        <table className="w-full min-w-0 border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left dark:border-slate-700">
              <th scope="col" className="py-3 pr-3 text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Property</th>
              <th scope="col" className="py-3 pr-3 text-right text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Month to date</th>
              <th scope="col" className="py-3 pr-3 text-right text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Year to date</th>
              <th scope="col" className="py-3 pr-3 text-right text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">All time (since 2014)</th>
              <th scope="col" className="py-3 pr-3 text-right text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Expenses (all time)</th>
              <th scope="col" className="py-3 pr-3 text-right text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Recorded cash invested</th>
              <th scope="col" className="py-3 text-right text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Property tax paid (all time)</th>
            </tr>
          </thead>
          <tbody>
            {properties.map((property) => {
              const expanded = expandedIds.has(property.propertyId);
              return (
                <Fragment key={property.propertyId}>
                  <tr data-property-performance-row={property.propertyId} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="min-w-0 py-4 pr-3 align-top">
                      <p className="min-w-0 break-words font-black text-slate-950 dark:text-white">{property.label}</p>
                      <p className="mt-1">
                        <PropertySetupLink property={property} onNavigate={onNavigate}>Property setup</PropertySetupLink>
                      </p>
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => toggleDetails(property.propertyId)}
                        className="mt-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        {expanded ? "Hide expenses" : "Expenses by category"}
                      </button>
                    </td>
                    <td className="py-4 pr-3 text-right align-top font-bold tabular-nums text-slate-950 dark:text-white">{moneyValue(property.monthToDate.profitCents)}</td>
                    <td className="py-4 pr-3 text-right align-top font-bold tabular-nums text-slate-950 dark:text-white">{moneyValue(property.yearToDate.profitCents)}</td>
                    <td className="py-4 pr-3 text-right align-top font-bold tabular-nums text-slate-950 dark:text-white">{moneyValue(property.allTime.profitCents)}</td>
                    <td className="py-4 pr-3 text-right align-top font-bold tabular-nums text-slate-950 dark:text-white">{moneyValue(property.allTime.operatingExpensesCents)}</td>
                    <td className="py-4 pr-3 text-right align-top font-bold tabular-nums text-slate-950 dark:text-white">
                      {moneyValue(property.investmentCents)}
                      {property.setupIncomplete && (
                        <span className="mt-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                          Setup incomplete — known capital improvements only.{" "}
                          <PropertySetupLink property={property} onNavigate={onNavigate}>add financial setup</PropertySetupLink>
                        </span>
                      )}
                    </td>
                    <td className="py-4 text-right align-top font-bold tabular-nums text-slate-950 dark:text-white">{moneyValue(property.allTime.propertyTaxCents)}</td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={7} className="border-b border-slate-100 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-800/40">
                        <p className="mb-3 text-sm font-black text-slate-950 dark:text-white">{property.label} — expenses by category</p>
                        <ExpenseDetail property={property} periodId={expensePeriod} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 dark:border-slate-600">
              <th scope="row" className="py-4 pr-3 text-left font-black text-slate-950 dark:text-white">Portfolio total (all houses)</th>
              <td className="py-4 pr-3 text-right font-black tabular-nums text-slate-950 dark:text-white">{moneyValue(portfolioTotals.monthToDate.profitCents)}</td>
              <td className="py-4 pr-3 text-right font-black tabular-nums text-slate-950 dark:text-white">{moneyValue(portfolioTotals.yearToDate.profitCents)}</td>
              <td className="py-4 pr-3 text-right font-black tabular-nums text-slate-950 dark:text-white">{moneyValue(portfolioTotals.allTime.profitCents)}</td>
              <td className="py-4 pr-3 text-right font-black tabular-nums text-slate-950 dark:text-white">{moneyValue(portfolioTotals.allTime.operatingExpensesCents)}</td>
              <td className="py-4 pr-3 text-right font-black tabular-nums text-slate-950 dark:text-white">{moneyValue(portfolioTotals.investmentCents)}</td>
              <td className="py-4 text-right font-black tabular-nums text-slate-950 dark:text-white">{moneyValue(portfolioTotals.allTime.propertyTaxCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Phone: stacked cards, one per house, same figures. */}
      <div className="mt-6 space-y-4 sm:hidden">
        {properties.map((property) => (
          <PropertyCard
            key={property.propertyId}
            property={property}
            expensePeriod={expensePeriod}
            expanded={expandedIds.has(property.propertyId)}
            onToggleDetails={() => toggleDetails(property.propertyId)}
            onNavigate={onNavigate}
          />
        ))}
        <article className="min-w-0 rounded-2xl border-2 border-slate-300 bg-slate-50 p-5 dark:border-slate-600 dark:bg-slate-800/40">
          <h3 className="text-base font-black text-slate-950 dark:text-white">Portfolio total (all houses)</h3>
          <dl className="mt-4 space-y-2">
            <MetricPair label="Month to date profit" value={moneyValue(portfolioTotals.monthToDate.profitCents)} />
            <MetricPair label="Year to date profit" value={moneyValue(portfolioTotals.yearToDate.profitCents)} />
            <MetricPair label="All time profit (since 2014)" value={moneyValue(portfolioTotals.allTime.profitCents)} />
            <MetricPair label="Expenses (all time)" value={moneyValue(portfolioTotals.allTime.operatingExpensesCents)} />
            <MetricPair label="Recorded cash invested" value={moneyValue(portfolioTotals.investmentCents)} />
            <MetricPair label="Property tax paid (all time)" value={moneyValue(portfolioTotals.allTime.propertyTaxCents)} />
          </dl>
        </article>
      </div>

      {/* Reconciliation: everything that could not be matched to a house. Never
          allocated to a property and never hidden — it stays visible here. */}
      <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 dark:border-slate-600 dark:bg-slate-800/40" data-rental-property-performance-unassigned>
        <h3 className="text-base font-black text-slate-950 dark:text-white">Unassigned / unmatched</h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {unassigned.eventCount === 0
            ? "Every rental event is matched to a house."
            : `${unassigned.eventCount} rental event${unassigned.eventCount === 1 ? "" : "s"} could not be matched to a house. These amounts are not included in any property above or in the portfolio total — they are shown here so nothing disappears.`}
        </p>
        {unassigned.eventCount > 0 && (
          <>
            <dl className="mt-4 space-y-2">
              <MetricPair label="Month to date profit" value={moneyValue(unassigned.monthToDate.profitCents)} />
              <MetricPair label="Year to date profit" value={moneyValue(unassigned.yearToDate.profitCents)} />
              <MetricPair label="All time profit (since 2014)" value={moneyValue(unassigned.allTime.profitCents)} />
              <MetricPair label="Expenses (all time)" value={moneyValue(unassigned.allTime.operatingExpensesCents)} />
              <MetricPair label="Capital improvements (all time)" value={moneyValue(unassigned.allTime.capitalImprovementsCents)} />
              <MetricPair label="Property tax paid (all time)" value={moneyValue(unassigned.allTime.propertyTaxCents)} />
            </dl>
            {unassigned.unmatchedSlugs.length > 0 && (
              <p className="mt-3 break-words text-xs text-slate-500 dark:text-slate-400">
                Unmatched property codes: {unassigned.unmatchedSlugs.join(", ")}
              </p>
            )}
            <p className="mt-3 text-sm font-bold text-slate-950 dark:text-white">
              Portfolio reconciliation total (houses + unassigned) — all time profit {moneyValue(reconciliation.allTime.profitCents)},
              expenses {moneyValue(reconciliation.allTime.operatingExpensesCents)},
              invested {moneyValue(reconciliation.investmentCents)}.
            </p>
          </>
        )}
        {(pre2014.eventCount > 0 || diagnostics.ineligibleEventCount > 0) && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {pre2014.eventCount > 0 && (
              <>Before 2014: {pre2014.eventCount} event{pre2014.eventCount === 1 ? "" : "s"} ({moneyValue(pre2014.profitCents)} profit) are kept out of the all-time figures — pre-acquisition records, not portfolio activity. </>
            )}
            {diagnostics.ineligibleEventCount > 0 && (
              <>{diagnostics.ineligibleEventCount} event{diagnostics.ineligibleEventCount === 1 ? "" : "s"} excluded as non-rental, transfer, or otherwise out of scope for this view.</>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
