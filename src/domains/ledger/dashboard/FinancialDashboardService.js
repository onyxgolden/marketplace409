const ACCOUNT_NAMES = {
  "1000": "Cash",
  "1100": "Accounts Receivable",
  "2000": "Debt Owed",
  "4000": "Monthly Revenue",
  "5000": "Monthly Expenses",
};

function cents(value) {
  return Number(value || 0);
}

function lineAmount(report, accountId) {
  return cents(report?._lines?.find((line) => line.label === accountId)?.amount);
}

function buildHealthStatus({ equity, profit, margin, cash }) {
  if (equity < 0 || profit < 0) {
    return {
      label: "Critical",
      detail: "Negative equity or profit requires immediate review.",
    };
  }

  if (margin < 0.15 || cash <= 0) {
    return {
      label: "Warning",
      detail: "Profitability or cash position needs closer monitoring.",
    };
  }

  return {
    label: "Healthy",
    detail: "Profit, margin, cash, and equity are currently positive.",
  };
}

export class FinancialDashboardService {
  buildFromReports(reports) {
    const income = reports?.incomeStatement;
    const balance = reports?.balanceSheet;

    const cash = lineAmount(balance, "1000");
    const receivables = lineAmount(balance, "1100");
    const debt = Math.abs(lineAmount(balance, "2000"));
    const revenue = Math.abs(lineAmount(income, "4000"));
    const expenses = lineAmount(income, "5000");

    const assets = cash + receivables;
    const liabilities = debt;
    const equity = assets - liabilities;
    const profit = revenue - expenses;
    const margin = revenue ? profit / revenue : 0;

    return Object.freeze({
      kpis: Object.freeze({
        cash,
        receivables,
        debt,
        revenue,
        expenses,
        assets,
        liabilities,
        equity,
        profit,
        margin,
      }),
      health: Object.freeze(buildHealthStatus({ equity, profit, margin, cash })),
      balanceSheetLines: Object.freeze(
        (balance?._lines || []).map((line) =>
          Object.freeze({
            accountId: line.label,
            accountName: ACCOUNT_NAMES[line.label] || line.label,
            amount: cents(line.amount),
          }),
        ),
      ),
      metadata: Object.freeze({
        provider: "demo",
        snapshotStatus: "current",
        phase: "7.3",
      }),
    });
  }
}

Object.freeze(FinancialDashboardService);
