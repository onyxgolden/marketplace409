import { buildFinancialForgePerformance } from "@/application/financial/buildFinancialForgePerformance";

// The "Monthly Profit" KPI card previously showed kpis.profit straight from the read-models API,
// which is an all-time total with no period scoping anywhere in its pipeline -- there was no bug in
// a specific number, the card was simply never wired to a real month. This computes a genuine
// current-calendar-month figure client-side, reusing the same period-bucketing
// (buildFinancialForgePerformance) already built and tested for the Financial activity panel below
// it, rather than adding new aggregation logic. "Current month" is UTC's current month (Date's own
// toISOString() is always UTC regardless of the browser's local timezone setting) -- the same
// convention every other period/date computation in this codebase already uses (see
// ForgeMonthlyTrendChart.jsx, buildRentalFinancialPerformance.js), since no per-owner reporting
// timezone is configured anywhere in the app.
//
// Deliberately scoped to income/expense activity only (not the NOI affects_noi subset the backend
// kpis.profit uses) to match what the card's own "Revenue X · Expenses Y" detail line has always
// promised: profit as revenue minus expenses for the period shown, not a different, narrower figure
// under the same label.
//
// Returns plain dollar amounts (not cents) -- callers must not divide by 100 again.
export function getCurrentMonthProfitKpi(transactions = [], { scope = "business", today } = {}) {
  const performance = buildFinancialForgePerformance(transactions, {
    scope,
    today,
    period: { type: "sixMonths" },
  });

  const currentMonth = performance.series.at(-1) || { key: null, incomeCents: 0, expensesCents: 0, netCents: 0 };

  return Object.freeze({
    monthKey: currentMonth.key,
    revenueDollars: currentMonth.incomeCents / 100,
    expensesDollars: currentMonth.expensesCents / 100,
    profitDollars: currentMonth.netCents / 100,
  });
}
