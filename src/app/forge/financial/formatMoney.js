// kpis.equity/cash/profit/revenue/expenses and balanceSheetLines amounts are already real dollar
// figures (FinancialPositionReadModelAdapter's centsToDollars() and the aggregation service both
// hand back dollars, never cents) -- no /100 conversion belongs here. Formatted with cents so the
// same figure reads identically on the KPI cards, the sidebar/portfolio/debt surfaces, and
// everywhere else the shared formatter is used.
export function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

// The ledger brain (answerLedgerQuery) and comparative reports (buildComparativeIncomeStatements)
// hand back integer ledger cents -- they must cross this boundary before money(). Rendering their
// amounts through money() directly inflates every figure 100x.
export function centsToDollars(cents) {
  return Number(cents || 0) / 100;
}

// money() composed with the ledger boundary: one call for ask-the-books answers and
// comparative report amounts.
export function ledgerMoney(cents) {
  return money(centsToDollars(cents));
}
