"use client";

import { Fragment, useCallback, useState } from "react";
import { ChevronDown } from "lucide-react";
import { forgeTheme } from "@/components/forge/theme";
import { ForgeEmptyState, ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ledgerMoney } from "./formatMoney.js";

function lastThreeCalendarMonths() {
  const now = new Date();
  return [2, 1, 0].map((ago) => {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - ago, 1),
    );
    return date.toISOString().slice(0, 7);
  });
}

async function loadComparison(monthKeys) {
  const response = await fetch(
    `/api/financial/reports?compare=${monthKeys.join(",")}`,
  );
  const payload = await response.json();

  if (!response.ok || payload?.success !== true || !Array.isArray(payload?.data?.periods)) {
    throw new Error(
      payload?.error || "Could not load the month comparison. Try again.",
    );
  }

  return payload.data.periods;
}

function groupLines(period, type) {
  return period.lines.filter((line) => line.type === type);
}

export default function MonthComparisonPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [months, setMonths] = useState(lastThreeCalendarMonths);
  // The comparison that is actually on screen. Month-picker edits only become
  // live data when Compare is pressed -- the picker itself never triggers a fetch.
  const [appliedKeys, setAppliedKeys] = useState(() => months.join(","));
  const [validationError, setValidationError] = useState(null);

  // Stale-while-revalidate keyed by the committed month set: pressing Compare
  // keeps the previous table on screen while the new periods load.
  const { data, error, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    `financial:comparison:${appliedKeys}`,
    () => loadComparison(appliedKeys.split(",")),
    { ttlMs: 60_000 },
  );
  const periods = data ?? null;

  // Changing the month set swaps the cache key, so keep the last visible table
  // on screen while the new periods load -- pressing Compare never blanks the panel.
  const [lastPeriods, setLastPeriods] = useState(null);
  if (periods && periods !== lastPeriods) {
    // Adjusting state during render on a fresh payload: the standard React
    // derived-state pattern, so the previous table stays visible mid-compare.
    setLastPeriods(periods);
  }
  const visible = periods ?? lastPeriods;

  const compare = useCallback((monthKeys) => {
    const keys = monthKeys.filter(Boolean);

    if (keys.length === 0) {
      setValidationError("Pick at least one month to compare.");
      return;
    }

    setValidationError(null);
    setAppliedKeys(keys.join(","));
  }, []);

  const setMonthAt = (index, value) => {
    setMonths((current) =>
      current.map((month, i) => (i === index ? value : month)),
    );
  };

  const revenueAccounts = visible?.[0]
    ? groupLines(visible[0], "revenue")
    : [];
  const expenseAccounts = visible?.[0]
    ? groupLines(visible[0], "expense")
    : [];
  const hasActivity =
    revenueAccounts.length > 0 || expenseAccounts.length > 0;

  const amountFor = (period, accountId) =>
    period.lines.find((line) => line.accountId === accountId)?.amount ?? 0;

  const showError = validationError || (!visible && !isLoading ? error : null);

  return (
    <section
      data-month-comparison
      className={forgeTheme.card}
    >
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
        className="flex w-full items-start justify-between gap-3 rounded-xl text-left"
      >
        <span className="min-w-0">
          <span className={forgeTheme.labelSmall}>
            Multi-period reporting
          </span>

          <h2 className="mt-2 text-2xl font-black text-slate-950 dark:text-slate-50">
            Compare months
          </h2>
        </span>

        <ChevronDown
          size={20}
          aria-hidden="true"
          className={`mt-1 shrink-0 text-slate-500 transition-transform dark:text-slate-400 ${collapsed ? "-rotate-90" : ""}`}
        />
      </button>

      {!collapsed && (
        <>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            Month-over-month profit and loss, straight from the ledger.
          </p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            {months.map((month, index) => (
              <label
                key={index}
                className="flex flex-col gap-1"
              >
                <span className={forgeTheme.labelSmall}>
                  Month {index + 1}
                </span>

                <input
                  type="month"
                  value={month}
                  onChange={(event) => setMonthAt(index, event.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </label>
            ))}

            <button
              type="button"
              onClick={() => compare(months)}
              disabled={isLoading || isRefreshing}
              className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50"
            >
              {isLoading || isRefreshing ? "Comparing…" : "Compare"}
            </button>
          </div>

          <div className="mt-5">
            {!visible && isLoading && <ForgeLoadingState label="Loading the comparison…" />}

            {showError && !visible ? (
              <ForgeErrorState
                title="Could not load the month comparison."
                detail={showError}
                onRetry={refresh}
              />
            ) : null}

            {visible && error && (
              <p role="status" className={`${forgeTheme.textSmall} mt-2`}>
                Could not refresh — showing the last saved comparison.
              </p>
            )}

            {visible && (isRefreshing || !periods) && (
              <p role="status" className={`${forgeTheme.textSmall} mt-2`}>
                Updating…
              </p>
            )}

            {visible && !hasActivity && (
              <ForgeEmptyState
                headline="No revenue or expense activity in the selected months"
                guidance="Pick different months or check that your ledger has imported activity for them."
              />
            )}

            {visible && hasActivity && (
              <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                <table className="w-full border-collapse text-left">
                  <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                    <tr>
                      <th className="p-4">Account</th>

                      {visible.map((period) => (
                        <th
                          key={period.period.key}
                          className="p-4 text-right"
                        >
                          {period.period.label}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody className="text-sm">
                    {[
                      { title: "Revenue", rows: revenueAccounts },
                      { title: "Expenses", rows: expenseAccounts },
                    ].map(({ title, rows }) =>
                      rows.length > 0 && (
                        <Fragment key={`${title}-group`}>
                          <tr className="bg-slate-50 dark:bg-slate-800/40">
                            <td
                              colSpan={visible.length + 1}
                              className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
                            >
                              {title}
                            </td>
                          </tr>

                          {rows.map((row) => (
                            <tr
                              key={row.accountId}
                              className="border-t border-slate-100 dark:border-slate-800"
                            >
                              <td className="p-4 text-slate-700 dark:text-slate-300">
                                {row.name}
                              </td>

                              {visible.map((period) => (
                                <td
                                  key={period.period.key}
                                  className="p-4 text-right tabular-nums text-slate-900 dark:text-slate-100"
                                >
                                  {ledgerMoney(amountFor(period, row.accountId))}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </Fragment>
                      ),
                    )}

                    {[
                      {
                        label: "Total revenue",
                        value: (period) => period.totals.revenue,
                      },
                      {
                        label: "Total expenses",
                        value: (period) => period.totals.expenses,
                      },
                      {
                        label: "Net",
                        value: (period) => period.totals.netIncome,
                        strong: true,
                      },
                    ].map(({ label, value, strong }) => (
                      <tr
                        key={label}
                        className={`border-t-2 border-slate-200 dark:border-slate-700 ${strong ? "bg-slate-50 dark:bg-slate-800/40" : ""}`}
                      >
                        <td
                          className={`p-4 ${strong ? "font-black text-slate-950 dark:text-white" : "font-bold text-slate-700 dark:text-slate-300"}`}
                        >
                          {label}
                        </td>

                        {visible.map((period) => {
                          const amount = value(period);
                          const isNegative = Number(amount) < 0;

                          return (
                            <td
                              key={period.period.key}
                              className={`p-4 text-right tabular-nums ${strong ? "font-black" : "font-bold"} ${isNegative ? "text-red-600 dark:text-red-400" : "text-slate-950 dark:text-white"}`}
                            >
                              {ledgerMoney(amount)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
