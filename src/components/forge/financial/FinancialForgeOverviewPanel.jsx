"use client";
import { Fragment, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { buildFinancialForgePerformance } from "@/application/financial/buildFinancialForgePerformance";
import { groupExpenseCategory, groupOrderIndex } from "@/application/financial/expenseCategoryGroups";
import ForgeCategoryDonutChart from "@/components/forge/ForgeCategoryDonutChart";
import ForgeComparisonBarChart from "@/components/forge/ForgeComparisonBarChart";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const PERIOD_OPTIONS = Object.freeze([
  { type: "sixMonths", label: "6 Months" },
  { type: "ytd", label: "YTD" },
  { type: "year", label: "Year" },
  { type: "allTime", label: "All time" },
]);

const DONUT_PERIOD_OPTIONS = Object.freeze([
  { type: "month", label: "This Month" },
  { type: "sixMonths", label: "6 Months" },
  { type: "allTime", label: "All Time" },
]);

const SCOPE_OPTIONS = Object.freeze([
  { scope: "business", label: "Business" },
  { scope: "personal", label: "Personal" },
]);

function displayCategory(category) {
  return String(category || "uncategorized")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value) {
  if (!value) return null;
  const parts = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!parts) return value;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))));
}

export default function FinancialForgeOverviewPanel({ loadState, transactions = [], accounts = [] }) {
  const [scope, setScope] = useState("business");
  const [periodType, setPeriodType] = useState("sixMonths");
  const [donutPeriodType, setDonutPeriodType] = useState("sixMonths");
  const [collapsedCategoryGroups, setCollapsedCategoryGroups] = useState(() => new Set());

  function toggleCategoryGroup(key) {
    setCollapsedCategoryGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  const [selectedYear, setSelectedYear] = useState(null);

  const accountsById = useMemo(
    () => Object.fromEntries(accounts.map((account) => [account.id, account.name])),
    [accounts],
  );

  const today = new Date();

  const scopedAvailableYears = useMemo(
    () => buildFinancialForgePerformance(transactions, { scope, period: { type: "sixMonths" }, accountsById }).availableYears,
    [transactions, scope, accountsById],
  );
  const effectiveYear = selectedYear ?? scopedAvailableYears.at(-1) ?? today.getUTCFullYear();

  const performance = buildFinancialForgePerformance(transactions, {
    scope,
    accountsById,
    period: periodType === "year" ? { type: "year", year: effectiveYear } : { type: periodType },
  });

  const categoryGroups = useMemo(() => {
    const groups = new Map();
    for (const category of performance.categories) {
      const group = groupExpenseCategory(category.category);
      if (!groups.has(group.key)) groups.set(group.key, { key: group.key, label: group.label, items: [] });
      groups.get(group.key).items.push(category);
    }
    return [...groups.values()].sort((left, right) => groupOrderIndex(left.key) - groupOrderIndex(right.key));
  }, [performance.categories]);

  const currentMonthKey = today.toISOString().slice(0, 7);

  // The category donuts get their own period control (This Month / 6 Months / All Time),
  // independent of the bar-chart-and-table period selector above. "This Month" isn't one of
  // buildFinancialForgePerformance's own period types, so it's approximated by pre-filtering the
  // input events to the current UTC month, then asking for "allTime" over that narrowed set --
  // the same category-bucketing logic, just fed a smaller slice of history.
  const donutPerformance = (() => {
    if (donutPeriodType === "month") {
      const monthTransactions = transactions.filter((event) => String(event.eventDate || "").slice(0, 7) === currentMonthKey);
      return buildFinancialForgePerformance(monthTransactions, { scope, accountsById, period: { type: "allTime" } });
    }
    return buildFinancialForgePerformance(transactions, { scope, accountsById, period: { type: donutPeriodType } });
  })();

  const incomeSlices = useMemo(() => donutPerformance.categories
    .filter((category) => category.incomeCents > 0)
    .map((category) => ({ key: category.category, label: displayCategory(category.category), valueCents: category.incomeCents }))
    .sort((left, right) => right.valueCents - left.valueCents),
  [donutPerformance.categories]);

  const expenseSlices = useMemo(() => {
    const groups = new Map();
    for (const category of donutPerformance.categories) {
      if (category.expensesCents <= 0) continue;
      const group = groupExpenseCategory(category.category);
      if (!groups.has(group.key)) groups.set(group.key, { key: group.key, label: group.label, valueCents: 0 });
      groups.get(group.key).valueCents += category.expensesCents;
    }
    return [...groups.values()].sort((left, right) => right.valueCents - left.valueCents);
  }, [donutPerformance.categories]);

  const currentKey = performance.granularity === "yearly"
    ? String(today.getUTCFullYear())
    : currentMonthKey;

  if (loadState === "loading") {
    return (
      <section data-financial-forge-overview className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <p className="text-sm font-bold text-slate-500 dark:text-slate-400">Loading Financial FORGE activity…</p>
      </section>
    );
  }

  return (
    <section data-financial-forge-overview className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-black text-slate-950 dark:text-white">Financial activity</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Imported cash activity — cash basis (recorded when money moved).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Select business or personal">
          {SCOPE_OPTIONS.map((option) => (
            <button
              key={option.scope}
              type="button"
              data-scope-option={option.scope}
              aria-pressed={scope === option.scope}
              onClick={() => setScope(option.scope)}
              className={`rounded-full px-4 py-1.5 text-xs font-black transition motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
                scope === option.scope
                  ? goldControlClassName
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div data-financial-forge-coverage className="mt-3 rounded-xl bg-slate-50 px-4 py-2 text-xs font-bold text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
        {performance.coverage.earliest && performance.coverage.latest
          ? `Imported ${scope} transaction history covers ${formatDate(performance.coverage.earliest)} through ${formatDate(performance.coverage.latest)}.`
          : `No imported ${scope} transaction history yet.`}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2" role="group" aria-label="Select category chart period">
        {DONUT_PERIOD_OPTIONS.map((option) => (
          <button
            key={option.type}
            type="button"
            data-donut-period-option={option.type}
            aria-pressed={donutPeriodType === option.type}
            onClick={() => setDonutPeriodType(option.type)}
            className={`rounded-full px-3 py-1.5 text-xs font-black transition motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
              donutPeriodType === option.type
                ? goldControlClassName
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div data-financial-forge-summary className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <ForgeCategoryDonutChart
            title="Income by category"
            slices={incomeSlices}
            formatValue={(cents) => money.format(cents / 100)}
            emptyLabel="No income recorded in this period."
          />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <ForgeCategoryDonutChart
            title="Expenses by category"
            slices={expenseSlices}
            formatValue={(cents) => money.format(cents / 100)}
            emptyLabel="No expenses recorded in this period."
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950/30">
          <p className="text-xs font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Income (selected period)</p>
          <p className="mt-1 text-xl font-black tabular-nums text-emerald-900 dark:text-emerald-200">{money.format(performance.totals.incomeCents / 100)}</p>
        </div>
        <div className="rounded-xl bg-amber-50 p-4 dark:bg-amber-950/30">
          <p className="text-xs font-black uppercase tracking-wide text-amber-700 dark:text-amber-400">Expenses (selected period)</p>
          <p className="mt-1 text-xl font-black tabular-nums text-amber-900 dark:text-amber-200">{money.format(performance.totals.expensesCents / 100)}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2" role="group" aria-label="Select time period">
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option.type}
            type="button"
            data-period-option={option.type}
            aria-pressed={periodType === option.type}
            onClick={() => setPeriodType(option.type)}
            className={`rounded-full px-3 py-1.5 text-xs font-black transition motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
              periodType === option.type
                ? goldControlClassName
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            {option.label}
          </button>
        ))}
        {periodType === "year" && (
          <label className="text-xs font-bold text-slate-600 dark:text-slate-400">
            <span className="sr-only">Select year</span>
            <select
              value={effectiveYear}
              onChange={(event) => setSelectedYear(Number(event.target.value))}
              disabled={scopedAvailableYears.length === 0}
              className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            >
              {scopedAvailableYears.length === 0
                ? <option value={effectiveYear}>{effectiveYear}</option>
                : scopedAvailableYears.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="mt-5">
        <ForgeComparisonBarChart
          title={`${scope === "business" ? "Business" : "Personal"} income vs. expenses`}
          series={performance.series.map((point) => Object.freeze({ key: point.key, primaryCents: point.incomeCents, secondaryCents: point.expensesCents }))}
          primaryLabel="Income" secondaryLabel="Expenses" netLabel="Net cash flow"
          formatValue={(cents) => money.format(cents / 100)} currentKey={currentKey}
        />
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        <div>
          <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Expense categories</h4>
          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="p-3">Category</th>
                  <th className="p-3 text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {categoryGroups.length === 0 ? (
                  <tr><td colSpan={2} className="p-5 text-slate-500 dark:text-slate-400">No categorized activity in this period.</td></tr>
                ) : (
                  categoryGroups.map((group) => {
                    const groupNetCents = group.items.reduce((sum, item) => sum + item.netCents, 0);
                    const collapsed = collapsedCategoryGroups.has(group.key);
                    return (
                      <Fragment key={group.key}>
                        <tr data-category-group={group.key}>
                          <td colSpan={2} className="p-0">
                            <button
                              type="button" onClick={() => toggleCategoryGroup(group.key)} aria-expanded={!collapsed}
                              className="flex w-full items-center justify-between gap-3 bg-slate-50 px-3 py-2 text-left dark:bg-slate-800/40"
                            >
                              <span className="flex items-center gap-2">
                                <ChevronDown size={14} className={`text-slate-500 transition-transform dark:text-slate-400 ${collapsed ? "-rotate-90" : ""}`} />
                                <span className="text-sm font-black text-slate-800 dark:text-slate-200">{group.label}</span>
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">({group.items.length})</span>
                              </span>
                              <span className={`text-sm font-black tabular-nums ${groupNetCents < 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                                {groupNetCents < 0 ? `-${money.format(Math.abs(groupNetCents) / 100)}` : money.format(groupNetCents / 100)}
                              </span>
                            </button>
                          </td>
                        </tr>
                        {!collapsed && group.items.map((category) => (
                          <tr key={category.category}>
                            <td className="p-3 pl-8 font-bold text-slate-800 dark:text-slate-200">{displayCategory(category.category)}</td>
                            <td className={`p-3 text-right font-black tabular-nums ${category.netCents < 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                              {category.netCents < 0 ? `-${money.format(Math.abs(category.netCents) / 100)}` : money.format(category.netCents / 100)}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Imported activity by account</h4>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Net of imported transactions for this period — not a live bank balance.
          </p>
          <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="p-3">Account</th>
                  <th className="p-3 text-right">Transactions</th>
                  <th className="p-3 text-right">Net imported</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {performance.accounts.length === 0 ? (
                  <tr><td colSpan={3} className="p-5 text-slate-500 dark:text-slate-400">No account activity in this period.</td></tr>
                ) : (
                  performance.accounts.map((account) => (
                    <tr key={account.accountId}>
                      <td className="p-3 font-bold text-slate-800 dark:text-slate-200">{account.accountName}</td>
                      <td className="p-3 text-right tabular-nums text-slate-600 dark:text-slate-400">{account.transactionCount.toLocaleString()}</td>
                      <td className={`p-3 text-right font-black tabular-nums ${account.netCents < 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                        {account.netCents < 0 ? `-${money.format(Math.abs(account.netCents) / 100)}` : money.format(account.netCents / 100)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
