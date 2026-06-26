export type FinancialMetricsSummary = {
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;

  revenue: number;
  expenses: number;
  netIncome: number;

  workingCapital: number;

  currentRatio: number;
  profitMargin: number;
  debtToAssetRatio: number;
  debtToEquityRatio: number;
  returnOnAssets: number;
  returnOnEquity: number;
};
