// kpis.equity/cash/profit/revenue/expenses and balanceSheetLines amounts are already real dollar
// figures (FinancialPositionReadModelAdapter's centsToDollars() and the aggregation service both
// hand back dollars, never cents) -- no /100 conversion belongs here.
export function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}
